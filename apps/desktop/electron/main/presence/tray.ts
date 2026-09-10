/**
 * [INPUT]: Depends on Electron Tray/Menu, product logo assets, localized activity/update snapshots, window content size, and quit/open actions.
 * [OUTPUT]: Provides an adaptive monochrome macOS logo or full-color system tray and shared native menu anchored below the persistent top strip in content coordinates, including open, quit, and update actions.
 * [POS]: Presence native menu adapter; the service chooses the top strip or this fallback tray as the recovery entry.
 */

import { Menu, nativeImage, Tray, type BrowserWindow } from "electron";
import { join } from "node:path";
import type { AppLocale } from "../../../shared/i18n/locale";
import { translate } from "../../../shared/i18n/runtime";
import type { EffectivePresence, TaskActivitySnapshot } from "../../../shared/presence-ipc";
import type { UpdateSnapshot } from "../../../shared/update-ipc";
export class PresenceTray {
  private tray: Tray | null = null;
  constructor(private readonly ports: { resources: string; locale(): AppLocale;
    activities(): TaskActivitySnapshot; quitting(): boolean; update(): UpdateSnapshot;
    open(): void; pending(): void; failed(): void; quit(): void; install(candidateId: string): void }) {}
  available() { return Boolean(this.tray && !this.tray.isDestroyed()); }
  async enable(): Promise<EffectivePresence> {
    if (this.available()) return { status: "enabled", reason: null };
    try {
      const isMac = process.platform === "darwin";
      const icon = nativeImage.createFromPath(join(this.ports.resources, "presence", isMac ? "trayTemplate.png" : "trayIcon.png"));
      if (icon.isEmpty()) throw new Error("TRAY_ICON_MISSING");
      icon.setTemplateImage(isMac);
      this.tray = new Tray(icon); this.refresh();
      if (!this.available()) throw new Error("TRAY_UNAVAILABLE");
      return { status: "enabled", reason: null };
    } catch { this.disable(); return { status: "failed", reason: "tray-unavailable" }; }
  }
  popup(window: BrowserWindow) {
    const [, height] = window.getContentSize();
    // Menu.popup uses window content coordinates; adding the screen origin offsets the menu twice.
    this.menu(false).popup({ window, x: 8, y: height });
  }
  private menu(includeTasks: boolean) {
    const t = (key: string, tasks?: number) => translate(this.ports.locale(), `settings.presence.${key}`, tasks === undefined ? {} : { tasks });
    const activity = this.ports.activities(); const update = this.ports.update();
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: t("open"), click: this.ports.open },
    ];
    if (includeTasks) {
      template.push({ type: "separator" },
        { label: t("tasks"), enabled: false },
        { label: t("running", activity.running), enabled: false },
        { label: t("waiting", activity.waiting), enabled: false });
      for (const phase of ["finishing", "recovery"] as const) {
        const count = activity.tasks.filter((task) => task.phase === phase).length;
        if (count) template.push({ label: `${t(phase)} ${count}`, enabled: false });
      }
      if (activity.waiting) template.push({ label: t("viewPending"), click: this.ports.pending });
    }
    if (update.phase === "ready" && update.candidateId) template.push({ type: "separator" }, { label: t("restart"), click: () => this.ports.install(update.candidateId!) });
    if (update.phase === "installing") template.push({ label: translate(this.ports.locale(), "settings.about.installing"), enabled: false });
    template.push({ type: "separator" }, { label: t(this.ports.quitting() ? "quitting" : "quit"), enabled: !this.ports.quitting(), click: this.ports.quit });
    return Menu.buildFromTemplate(template);
  }
  refresh() {
    if (!this.available()) return;
    try {
      const activity = this.ports.activities();
      const t = (key: string, tasks: number) => translate(this.ports.locale(), `settings.presence.${key}`, { tasks });
      this.tray!.setToolTip(`Bottega · ${t("running", activity.running)} · ${t("waiting", activity.waiting)}`);
      this.tray!.setContextMenu(this.menu(true));
    } catch { this.ports.failed(); this.disable(); }
  }
  disable() { this.tray?.destroy(); this.tray = null; }
}
