/**
 * [INPUT]: Depends on Electron app/window events, auxiliary windows, private IPC, shared shortcut bindings, background-scoped screen observation/focus, lock events, and bounded task snapshots.
 * [OUTPUT]: Provides real-notch-only auxiliary window lifecycle with shared screen observation, guarded manual opening, scoped shortcuts, persistent idle/active menu-bar access with CSS-owned compact corners, an anchored native menu, the workflow step marker labels in the panel's language (loaded on demand, TASK-28), an expanded list created on first expand or strip hover and destroyed after a minute idle, Mission Control exclusion from creation, and privacy hiding.
 * [POS]: Presence panel owner outside the product WindowRegistry and full product preload.
 */

import { app, BrowserWindow, globalShortcut, ipcMain, powerMonitor } from "electron";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { PANEL_CHANNEL, type TaskActivitySnapshot, type TaskPanelIntent, type TaskPanelSnapshot, type EffectivePresence } from "../../../../shared/ipc/agent/presence-ipc";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { WorkflowRoleName } from "@ai-chat/cloud-protocol/contracts/workflow/recipe";
import { rendererMatches } from "../../window/security/frame-guard";
import type { PresenceScreenSource } from "./screen-monitor";
import { panelGeometry, type NativeScreen } from "./geometry";
import { resolvePanelBinding, type PanelBinding } from "../../../../shared/shortcuts/bindings";
import { PanelShortcut } from "./shortcut";

/* The expanded list costs a whole renderer; it exists only between the first expand (or a hover over the strip) and a
   minute after it last collapsed (C-11). The two strip windows stay for the Presence lifetime. */
const LIST_IDLE_MS = 60_000;
const LIST = 2;

export class TaskPanelController {
  private windows: (BrowserWindow | null)[] = [];
  private url = "";
  private list: Promise<BrowserWindow> | null = null;
  private listIdle: ReturnType<typeof setTimeout> | null = null;
  private creating = false;
  private screens: readonly NativeScreen[] = [];
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
  constructor(private readonly ports: { mainDirectory: string; screens: PresenceScreenSource; rendererUrl?: string;
    locale(): AppLocale; action(intent: TaskPanelIntent): Promise<void>; menu?(window: BrowserWindow): void; failed(): void;
    binding?(): PanelBinding; mainFocused?(): boolean; changed?(): void;
    /** The workflow step marker per role in a language (TASK-28); loaded only while a workflow step is listed. */
    workflowLabels?(locale: AppLocale): Promise<Readonly<Record<WorkflowRoleName, string>>> }) {}
  private labels: { locale: AppLocale; value: Readonly<Record<WorkflowRoleName, string>> } | null = null;
  private labelsLoading: AppLocale | null = null;
  /* The panel shows no marker until main has the labels for its language, then renders again; never an English fallback. */
  private workflowLabels(locale: AppLocale) {
    if (this.labels?.locale === locale) return this.labels.value;
    if (!this.ports.workflowLabels || this.labelsLoading === locale || !this.snapshotValue.tasks.some(task => task.workflow)) return undefined;
    this.labelsLoading = locale;
    void this.ports.workflowLabels(locale).then(value => {
      if (this.ports.locale() !== locale) return;
      this.labels = { locale, value }; this.render();
    }).catch(cause => console.warn("[presence] workflow labels failed", cause))
      .finally(() => { if (this.labelsLoading === locale) this.labelsLoading = null; });
    return undefined;
  }
  available() { return this.healthy && Boolean(panelGeometry(this.screens)); }
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
        const capture = this.ports.screens.rememberFocus().finally(() => { if (this.focusCapture === capture) this.focusCapture = null; });
        this.focusCapture = capture;
      }
      const list = this.ensureList();
      await Promise.all([this.focusCapture, list]);
      if (expansion !== this.expansion || !this.canPresent()) return;
      this.expanded = true; this.render(); (await list).focus();
    } finally { if (expansion === this.expansion) this.expanding = false; }
  }
  async toggle() {
    if (this.expanded || this.expanding) this.collapse(true);
    else await this.open();
  }
  private cancelExpansion() { this.expansion++; this.expanding = false; this.expanded = false; this.scheduleListIdle(); }
  /** Creates the expanded list once and reuses it until it has idled; a hover prewarm and a real expand share one creation. */
  private ensureList(): Promise<BrowserWindow> {
    if (this.listIdle) { clearTimeout(this.listIdle); this.listIdle = null; }
    if (this.list) return this.list;
    const lifecycle = this.lifecycle, window = this.createWindow(LIST);
    const loading = window.loadURL(this.url).then(() => {
      if (lifecycle !== this.lifecycle || window.isDestroyed()) throw new Error("PANEL_START_CANCELLED");
      this.render(); return window;
    });
    this.list = loading;
    void loading.catch(() => { if (this.list === loading) { this.list = null; this.destroyList(); } });
    return loading;
  }
  private scheduleListIdle() {
    if (this.listIdle) clearTimeout(this.listIdle);
    this.listIdle = null;
    if (!this.list || this.expanded || this.expanding) return;
    this.listIdle = setTimeout(() => { this.listIdle = null; if (!this.expanded && !this.expanding) this.destroyList(); }, LIST_IDLE_MS);
    this.listIdle.unref?.();
  }
  private destroyList() {
    const window = this.windows[LIST]; this.windows[LIST] = null; this.list = null;
    if (window && !window.isDestroyed()) window.destroy();
  }
  private createWindow(i: number) {
    const url = this.url;
    // AppKit otherwise constrains frameless windows below the menu bar, outside the notch safe areas.
    // Auxiliary surfaces must never become separate thumbnails in Mission Control.
    // Native rounding would clip the compact strip's square top edge before its CSS corner shape.
    this.creating = true;
    let window: BrowserWindow;
    try {
      window = new BrowserWindow({ show: false, frame: false, transparent: true, resizable: false, skipTaskbar: true, enableLargerThanScreen: true,
      type: "panel", hiddenInMissionControl: true, roundedCorners: i === LIST, hasShadow: i === LIST, alwaysOnTop: true, focusable: i === LIST, minimizable: false, maximizable: false,
      webPreferences: { preload: join(this.ports.mainDirectory, "../preload/task-panel.js"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
    } finally { this.creating = false; }
    this.windows[i] = window;
    window.setAlwaysOnTop(true, i === LIST ? "floating" : "status");
    // Keep the Dock process type while joining ordinary desktop Spaces.
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false, skipTransformProcessType: true });
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    window.webContents.on("will-navigate", (event, target) => { if (target !== url) event.preventDefault(); });
    window.webContents.on("render-process-gone", () => { this.disable(); this.ports.failed(); });
    window.on("blur", () => { if (i === LIST && this.expanded) this.collapse(false); });
    return window;
  }
  update(value: TaskActivitySnapshot) { this.snapshotValue = value; this.render(); }
  async enable(): Promise<EffectivePresence> {
    if (this.healthy) { this.refreshShortcut(true); return this.effective(); }
    this.disable();
    const lifecycle = this.lifecycle;
    const updateScreens = () => {
      const screens = this.ports.screens.screens();
      const geometry = panelGeometry(screens);
      const identity = JSON.stringify(geometry);
      if (this.geometryId !== identity) this.cancelExpansion();
      this.geometryId = identity; this.screens = screens; this.render();
    };
    updateScreens();
    this.cleanup.push(this.ports.screens.onChanged(updateScreens));
    if (!panelGeometry(this.screens)) { this.disable(); return { status: "failed", reason: "screen-unavailable" }; }
    const entry = join(this.ports.mainDirectory, "../renderer/task-panel.html");
    const url = this.ports.rendererUrl ? `${this.ports.rendererUrl.replace(/\/$/, "")}/task-panel.html` : pathToFileURL(entry).href;
    this.url = url;
    try {
    this.windows = [this.createWindow(0), this.createWindow(1), null];
    const trusted = (event: Electron.IpcMainInvokeEvent) => {
      const index = this.windows.findIndex((window) => window && !window.isDestroyed() && window.webContents === event.sender);
      if (index < 0 || !rendererMatches(event.senderFrame, url) || event.senderFrame !== event.sender.mainFrame) throw new Error("TASK_PANEL_UNTRUSTED");
      return index;
    };
    ipcMain.handle(PANEL_CHANNEL.snapshot, (event) => this.view(trusted(event)));
    ipcMain.handle(PANEL_CHANNEL.intent, async (event, raw: unknown) => {
      trusted(event);
      const intent = raw as TaskPanelIntent;
      if (!intent || typeof intent !== "object" || !["expand", "collapse", "menu", "open-main", "open-settings", "open-task", "prewarm"].includes(intent.kind)) throw new Error("TASK_PANEL_INTENT_INVALID");
      if (intent.kind === "prewarm") { if (this.canPresent() && !this.expanded) { void this.ensureList().catch(() => {}); this.scheduleListIdle(); } return; }
      if (intent.kind === "menu") {
        if (this.canPresent() && this.windows[0]) { this.collapse(false); this.ports.menu?.(this.windows[0]); }
        return;
      }
      if (intent.kind === "expand") { await this.open(); return; }
      if (intent.kind === "collapse") { this.collapse(true); return; }
      await this.ports.action(intent); this.collapse(false);
    });
    this.cleanup.push(() => { ipcMain.removeHandler(PANEL_CHANNEL.snapshot); ipcMain.removeHandler(PANEL_CHANNEL.intent); });
    this.locked = powerMonitor.getSystemIdleState(1) === "locked";
    const hide = () => { this.locked = true; this.cancelExpansion(); this.render(); };
    const restore = () => { this.locked = false; this.cancelExpansion(); this.ports.screens.command("refresh"); this.render(); };
    powerMonitor.on("lock-screen", hide); powerMonitor.on("suspend", hide); powerMonitor.on("user-did-resign-active", hide);
    powerMonitor.on("unlock-screen", restore); powerMonitor.on("resume", restore); powerMonitor.on("user-did-become-active", restore);
    this.cleanup.push(() => {
      powerMonitor.removeListener("lock-screen", hide); powerMonitor.removeListener("suspend", hide); powerMonitor.removeListener("user-did-resign-active", hide);
      powerMonitor.removeListener("unlock-screen", restore); powerMonitor.removeListener("resume", restore); powerMonitor.removeListener("user-did-become-active", restore);
    });
    const refreshShortcut = () => { setImmediate(() => { if (lifecycle === this.lifecycle) this.refreshShortcut(); }); };
    app.on("browser-window-focus", refreshShortcut); app.on("browser-window-blur", refreshShortcut);
    this.cleanup.push(() => { app.removeListener("browser-window-focus", refreshShortcut); app.removeListener("browser-window-blur", refreshShortcut); });
    const refreshScreen = () => this.ports.screens.command("refresh");
    const watchFullscreen = (_event: unknown, window: BrowserWindow) => {
      // A panel window announces itself from inside its constructor, before it is in the list.
      if (this.creating || this.windows.includes(window)) return;
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
    await Promise.all(this.windows.flatMap((window) => window ? [window.loadURL(url)] : []));
    if (lifecycle !== this.lifecycle) throw new Error("PANEL_START_CANCELLED");
    this.healthy = true; this.render();
    return this.effective();
    } catch { this.disable(); return { status: "failed", reason: "panel-unavailable" }; }
  }
  private view(index: number): TaskPanelSnapshot {
    const geometry = panelGeometry(this.screens);
    const activity = this.locked || geometry?.hidden ? { ...this.snapshotValue, tasks: [] } : this.snapshotValue;
    const locale = this.ports.locale(), workflowLabels = this.workflowLabels(locale);
    return { activity, expanded: index === 2 && this.expanded, panelOpen: this.expanded, segment: index === 1 ? "right" : geometry?.collapsed.length === 2 ? "left" : "full", locale,
      ...(workflowLabels ? { workflowLabels } : {}) };
  }
  private collapse(restoreFocus: boolean) { const wasExpanded = this.expanded; this.cancelExpansion(); this.render(); if (restoreFocus && wasExpanded) this.ports.screens.command("restore-focus"); }
  private render() {
    this.refreshShortcut();
    const geometry = panelGeometry(this.screens);
    const visible = Boolean(this.healthy && geometry && !geometry.hidden && !this.locked);
    if (!visible && this.expanded) this.expanded = false;
    this.windows.forEach((window, index) => {
      if (!window || window.isDestroyed()) return;
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
    this.cleanup.splice(0).forEach((stop) => stop());
    if (this.listIdle) clearTimeout(this.listIdle);
    this.listIdle = null; this.list = null;
    const windows = this.windows.splice(0); for (const window of windows) if (window && !window.isDestroyed()) window.destroy();
  }
}
