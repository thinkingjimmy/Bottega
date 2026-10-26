/**
 * [INPUT]: Depends on Electron Tray/Menu, product logo assets, localized activity/update snapshots, and quit/open actions.
 * [OUTPUT]: Provides an adaptive monochrome macOS logo or full-color system tray and a native menu, including open, quit, update, and the optional Bottega Dock submenu.
 * [POS]: Presence native menu adapter; native icon visibility is independent of background residence.
 */

import { Menu, nativeImage, Tray } from "electron";
import { join } from "node:path";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { translate } from "../../../shared/i18n/runtime";
import type { EffectivePresence, TaskActivitySnapshot } from "../../../shared/ipc/agent/presence-ipc";
import type { UpdateSnapshot } from "../../../shared/ipc/settings/update-ipc";
export class PresenceTray {
  private tray: Tray | null = null;
  constructor(private readonly ports: { resources: string; locale(): AppLocale;
    activities(): TaskActivitySnapshot; quitting(): boolean; update(): UpdateSnapshot;
    open(): void; pending(): void; failed(): void; quit(): void; install(candidateId: string): void;
    /** Bottega Dock's submenu; absent while the Dock is unsupported or off. */
    dock?(): Electron.MenuItemConstructorOptions | null }) {}
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
  private menu() {
    const t = (key: string, tasks?: number) => translate(this.ports.locale(), `settings.presence.${key}`, tasks === undefined ? {} : { tasks });
    const activity = this.ports.activities(); const update = this.ports.update();
    const template: Electron.MenuItemConstructorOptions[] = [
      { label: t("open"), click: this.ports.open },
    ];
    template.push({ type: "separator" },
      { label: t("tasks"), enabled: false },
      { label: t("running", activity.running), enabled: false },
      { label: t("waiting", activity.waiting), enabled: false });
    for (const phase of ["finishing", "recovery"] as const) {
      const count = activity.tasks.filter((task) => task.phase === phase).length;
      if (count) template.push({ label: `${t(phase)} ${count}`, enabled: false });
    }
    if (activity.waiting) template.push({ label: t("viewPending"), click: this.ports.pending });
    if (update.phase === "ready" && update.candidateId) template.push({ type: "separator" }, { label: t("restart"), click: () => this.ports.install(update.candidateId!) });
    if (update.phase === "installing") template.push({ label: translate(this.ports.locale(), "settings.updates.installing"), enabled: false });
    const dock = this.ports.dock?.();
    if (dock) template.push({ type: "separator" }, dock);
    template.push({ type: "separator" }, { label: t(this.ports.quitting() ? "quitting" : "quit"), enabled: !this.ports.quitting(), click: this.ports.quit });
    return Menu.buildFromTemplate(template);
  }
  refresh() {
    if (!this.available()) return;
    try {
      const activity = this.ports.activities();
      const t = (key: string, tasks: number) => translate(this.ports.locale(), `settings.presence.${key}`, { tasks });
      this.tray!.setToolTip(`Bottega · ${t("running", activity.running)} · ${t("waiting", activity.waiting)}`);
      this.tray!.setContextMenu(this.menu());
    } catch { this.ports.failed(); this.disable(); }
  }
  disable() { this.tray?.destroy(); this.tray = null; }
}
