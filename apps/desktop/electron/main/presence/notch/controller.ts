/**
 * [INPUT]: Depends on Electron app/window events, auxiliary windows, private IPC, shared shortcut bindings, native geometry/focus, lock events, and bounded task snapshots.
 * [OUTPUT]: Provides independent auxiliary window lifecycle, guarded manual opening, scoped shortcuts, persistent idle/active menu-bar access with CSS-owned compact corners, an anchored native menu, an expanded list, Mission Control exclusion from creation, and privacy hiding.
 * [POS]: Presence panel owner outside the product WindowRegistry and full product preload.
 */

import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { PANEL_CHANNEL, type TaskActivitySnapshot, type TaskPanelIntent, type TaskPanelSnapshot, type EffectivePresence } from "../../../../shared/presence-ipc";
import type { AppLocale } from "../../../../shared/i18n/locale";
import { rendererMatches } from "../../frame-guard";
import { NativeScreenBridge } from "./native-bridge";
import { panelGeometry, type NativeScreen } from "./geometry";
import { resolvePanelBinding, type PanelBinding } from "../../../../shared/shortcuts/bindings";
import { PanelShortcut } from "./shortcut";

export class TaskPanelController {
  private windows: BrowserWindow[] = [];
  private native: NativeScreenBridge | null = null;
  private screens: NativeScreen[] = [];
  private expanded = false;
  private expanding = false;
  private expansion = 0;
  private focusCapture: Promise<void> | null = null;
  private readonly shortcut = new PanelShortcut(globalShortcut, () => { void this.toggle().catch((cause) => console.warn("[presence] panel shortcut failed", cause)); });
  private locked = false;
  private healthy = false;
  private geometryId = "";
  private lifecycle = 0;
  private snapshotValue: TaskActivitySnapshot = { version: 1, revision: 0, tasks: [], total: 0, running: 0, waiting: 0, overflow: 0, result: null };
  private readonly cleanup: Array<() => void> = [];
  constructor(private readonly ports: { mainDirectory: string; resourcesPath: string; nativePath?: string; rendererUrl?: string;
    locale(): AppLocale; action(intent: TaskPanelIntent): Promise<void>; menu?(window: BrowserWindow): void; failed(): void;
    binding?(): PanelBinding; mainFocused?(): boolean; changed?(): void }) {}
  available() { return this.healthy; }
  effective(): EffectivePresence { return { status: this.healthy ? "enabled" : "disabled", reason: this.shortcut.unavailable ? "shortcut-unavailable" : null }; }
  refreshShortcut(retry = false) {
    const eligible = this.canPresent() && !this.ports.mainFocused?.();
    if (this.shortcut.update(this.ports.binding?.() ?? resolvePanelBinding({}), eligible, retry)) this.ports.changed?.();
  }
  private canPresent() { const geometry = panelGeometry(this.screens); return this.healthy && !this.locked && Boolean(geometry && !geometry.hidden); }
  async open() {
    if (this.expanded || this.expanding || !this.canPresent()) return;
    const expansion = ++this.expansion;
    this.expanding = true;
    try {
      if (!this.focusCapture) {
        const capture = this.native!.rememberFocus().finally(() => { if (this.focusCapture === capture) this.focusCapture = null; });
        this.focusCapture = capture;
      }
      await this.focusCapture;
      if (expansion !== this.expansion || !this.canPresent()) return;
      this.expanded = true; this.render(); this.windows[2]?.focus();
    } finally { if (expansion === this.expansion) this.expanding = false; }
  }
  async toggle() {
    if (this.expanded || this.expanding) this.collapse(true);
    else await this.open();
  }
  private cancelExpansion() { this.expansion++; this.expanding = false; this.expanded = false; }
  update(value: TaskActivitySnapshot) { this.snapshotValue = value; this.render(); }
  async enable(): Promise<EffectivePresence> {
    if (this.healthy) { this.refreshShortcut(true); return this.effective(); }
    this.disable();
    const lifecycle = this.lifecycle;
    this.native = new NativeScreenBridge(this.ports.nativePath ?? join(this.ports.resourcesPath, "presence/bin/screen-bridge"), (screens) => {
      const geometry = panelGeometry(screens);
      const identity = JSON.stringify(geometry);
      if (this.geometryId !== identity) this.cancelExpansion();
      this.geometryId = identity; this.screens = screens; this.render();
    }, () => { this.disable(); this.ports.failed(); });
    try { await this.native.start(); } catch { this.disable(); return { status: "failed", reason: "native-unavailable" }; }
    if (!panelGeometry(this.screens)) { this.disable(); return { status: "failed", reason: "screen-unavailable" }; }
    const entry = join(this.ports.mainDirectory, "../renderer/task-panel.html");
    const url = this.ports.rendererUrl ? `${this.ports.rendererUrl.replace(/\/$/, "")}/task-panel.html` : pathToFileURL(entry).href;
    try {
    for (let i = 0; i < 3; i += 1) {
      // AppKit otherwise constrains frameless windows below the menu bar, outside the notch safe areas.
      // Auxiliary surfaces must never become separate thumbnails in Mission Control.
      // Native rounding would clip the compact strip's square top edge before its CSS corner shape.
      const window = new BrowserWindow({ show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, enableLargerThanScreen: true,
        type: "panel", hiddenInMissionControl: true, roundedCorners: i === 2, hasShadow: i === 2, alwaysOnTop: true, focusable: i === 2, minimizable: false, maximizable: false,
        webPreferences: { preload: join(this.ports.mainDirectory, "../preload/task-panel.js"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
      this.windows.push(window);
      window.setAlwaysOnTop(true, i === 2 ? "floating" : "status");
      // Keep the Dock process type while joining ordinary desktop Spaces.
      window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
      window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      window.webContents.on("will-navigate", (event, target) => { if (target !== url) event.preventDefault(); });
      window.webContents.on("render-process-gone", () => { this.disable(); this.ports.failed(); });
      window.on("blur", () => { if (i === 2 && this.expanded) this.collapse(false); });
    }
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      const index = this.windows.findIndex((window) => !window.isDestroyed() && window.webContents === event.sender);
      if (index < 0 || !rendererMatches(event.senderFrame, url) || event.senderFrame !== event.sender.mainFrame) throw new Error("TASK_PANEL_UNTRUSTED");
      return index;
    };
    ipcMain.handle(PANEL_CHANNEL.snapshot, (event) => this.view(trusted(event)));
    ipcMain.handle(PANEL_CHANNEL.intent, async (event, raw: unknown) => {
      trusted(event);
      const intent = raw as TaskPanelIntent;
      if (!intent || typeof intent !== "object" || !["expand", "collapse", "menu", "open-main", "open-settings", "open-task"].includes(intent.kind)) throw new Error("TASK_PANEL_INTENT_INVALID");
      if (intent.kind === "menu") {
        if (this.canPresent()) { this.collapse(false); this.ports.menu?.(this.windows[0]!); }
        return;
      }
      if (intent.kind === "expand") { await this.open(); return; }
      if (intent.kind === "collapse") { this.collapse(true); return; }
      await this.ports.action(intent); this.collapse(false);
    });
    this.cleanup.push(() => { ipcMain.removeHandler(PANEL_CHANNEL.snapshot); ipcMain.removeHandler(PANEL_CHANNEL.intent); });
    this.locked = powerMonitor.getSystemIdleState(1) === "locked";
    const hide = () => { this.locked = true; this.cancelExpansion(); this.render(); };
    const restore = () => { this.locked = false; this.cancelExpansion(); this.native?.command("refresh"); this.render(); };
    powerMonitor.on("lock-screen", hide); powerMonitor.on("suspend", hide); powerMonitor.on("user-did-resign-active", hide);
    powerMonitor.on("unlock-screen", restore); powerMonitor.on("resume", restore); powerMonitor.on("user-did-become-active", restore);
    this.cleanup.push(() => {
      powerMonitor.removeListener("lock-screen", hide); powerMonitor.removeListener("suspend", hide); powerMonitor.removeListener("user-did-resign-active", hide);
      powerMonitor.removeListener("unlock-screen", restore); powerMonitor.removeListener("resume", restore); powerMonitor.removeListener("user-did-become-active", restore);
    });
    const refreshShortcut = () => { setImmediate(() => { if (lifecycle === this.lifecycle) this.refreshShortcut(); }); };
    app.on("browser-window-focus", refreshShortcut); app.on("browser-window-blur", refreshShortcut);
    this.cleanup.push(() => { app.removeListener("browser-window-focus", refreshShortcut); app.removeListener("browser-window-blur", refreshShortcut); });
    const refreshScreen = () => this.native?.command("refresh");
    const watchFullscreen = (_event: unknown, window: BrowserWindow) => {
      if (this.windows.includes(window)) return;
      window.on("enter-full-screen", refreshScreen); window.on("leave-full-screen", refreshScreen);
    };
    for (const window of BrowserWindow.getAllWindows()) watchFullscreen(null, window);
    app.on("browser-window-created", watchFullscreen);
    this.cleanup.push(() => {
      app.removeListener("browser-window-created", watchFullscreen);
      for (const window of BrowserWindow.getAllWindows()) {
        window.removeListener("enter-full-screen", refreshScreen); window.removeListener("leave-full-screen", refreshScreen);
      }
    });
    await Promise.all(this.windows.map((window) => window.loadURL(url)));
    if (lifecycle !== this.lifecycle) throw new Error("PANEL_START_CANCELLED");
    this.healthy = true; this.render();
    return this.effective();
    } catch { this.disable(); return { status: "failed", reason: "panel-unavailable" }; }
  }
  private view(index: number): TaskPanelSnapshot {
    const geometry = panelGeometry(this.screens);
    const activity = this.locked || geometry?.hidden ? { ...this.snapshotValue, tasks: [] } : this.snapshotValue;
    return { activity, expanded: index === 2 && this.expanded, panelOpen: this.expanded, segment: index === 1 ? "right" : geometry?.collapsed.length === 2 ? "left" : "full", locale: this.ports.locale() };
  }
  private collapse(restoreFocus: boolean) { const wasExpanded = this.expanded; this.cancelExpansion(); this.render(); if (restoreFocus && wasExpanded) this.native?.command("restore-focus"); }
  private render() {
    this.refreshShortcut();
    const geometry = panelGeometry(this.screens);
    const visible = Boolean(this.healthy && geometry && !geometry.hidden && !this.locked);
    if (!visible && this.expanded) this.expanded = false;
    this.windows.forEach((window, index) => {
      if (window.isDestroyed()) return;
      window.webContents.send(PANEL_CHANNEL.changed, this.view(index));
      const proposed = index === 2 ? geometry?.expanded : geometry?.collapsed[index];
      const rowCount = this.snapshotValue.tasks.length;
      // Reserve the header, footer, borders, and list insets so six full rows fit.
      const height = rowCount ? 110 + 56 * Math.min(rowCount, 6) + (this.snapshotValue.overflow > 0 ? 24 : 0) : 260;
      const bounds = index === 2 && proposed ? { ...proposed, height: Math.min(proposed.height, height) } : proposed;
      if (!visible || !bounds || (index === 2 && !this.expanded)) { window.hide(); return; }
      window.setBounds({ x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) });
      window.showInactive();
    });
  }
  disable() {
    this.lifecycle++;
    this.healthy = false; this.cancelExpansion(); this.focusCapture = null; this.shortcut.close();
    this.cleanup.splice(0).forEach((stop) => stop()); this.native?.close(); this.native = null;
    const windows = this.windows.splice(0); for (const window of windows) if (!window.isDestroyed()) window.destroy();
  }
}
