/**
 * [INPUT]: Depends on Electron screen/power/shortcut/menu/shell, the Dock stores, native bridge adapters, entries, Usage adapter, replacement controller, window surfaces/geometry/panel lifecycle, projections, and caller ports (Bottega Apps, main-window destinations, tray refresh, background retention).
 * [OUTPUT]: Provides DockService: the single main-owned Dock runtime — enable/start/stop, actual mode, bar reveal/hover (the margin under the strip still counts)/lock/display handling, the revealed bar's native glass, lazy panel orchestration, bar/panel/settings snapshots with coalesced publication, consumer demand per visible surface, keyboard entry, temporary hide, and the replacement admission facts.
 * [POS]: system-dock orchestrator; intents live in intents.ts and Settings flows in setup.ts, both acting through this service. It is the only writer of DockConfigStore's working layout and DockLocalStore.
 */

import { BrowserWindow, globalShortcut, powerMonitor, screen, systemPreferences } from "electron";
import { homedir, release } from "node:os";
import { join } from "node:path";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type { DockBarItem, DockBarSnapshot, DockSettingsSnapshot, DockSyncStatus, PanelSnapshot } from "../../../shared/system-dock/ipc";
import { orderedItems, UNINITIALIZED_LAYOUT, type DockItem, type DockWidget } from "../../../shared/system-dock/layout";
import { DEFAULT_DOCK_LOCAL_STATE, DOCK_CONSENT_VERSION, type DockMode } from "../../../shared/system-dock/local-state";
import type { DockPlatform } from "./capability";
import { machServiceFor } from "./capability";
import { DownloadsEntry } from "./entries/downloads";
import { TrashEntry } from "./entries/trash";
import { NativeApps } from "./native/apps";
import { DockNativeBridge } from "./native/bridge";
import { entryLabel, isDockEmpty, maskFace, metricItems, projectPinned, projectRunning, type BottegaAppFact, type NativeResolution } from "./projection";
import { ReplacementController, type ReplacementAdmission } from "./replacement/controller";
import { RecoveryFiles } from "./replacement/journal";
import { createRegistration, type LoginItemApi } from "./replacement/registration";
import type { DockConfigStore } from "./store/config-store";
import type { DockLocalStore } from "./store/local-store";
import { buildPanel, panelDemand } from "./panel-snapshot";
import { DockUsage, type HistoryPort, type LimitsPort } from "./widgets/usage";
import { inBarGap, placeBar, placePanel, type BarPlacement, type DisplayFact } from "./window/geometry";
import { PanelLifecycle, type OpenRequest } from "./window/panel";
import { createDockSurface, DockIpc, dockEntryUrl, type DockRole } from "./window/surface";

export type BottegaAppsPort = { list(): { id: string; label: string; ready: boolean }[]; fact(appId: string | null): BottegaAppFact; open(appId: string): Promise<void> };
export type SyncHandle = { status(): DockSyncStatus; onChanged(listener: () => void): () => void; resolveConflict(choice: import("../../../shared/system-dock/ipc").ConflictChoice): Promise<unknown>; wake(): void };
export type DockServicePorts = {
  platform: DockPlatform;
  mainDirectory: string;
  local: DockLocalStore;
  config: DockConfigStore;
  locale(): AppLocale;
  installation: string;
  profile: string;
  appPath: string;
  ownBundleId: string | null;
  limits: LimitsPort | null;
  history: HistoryPort | null;
  apps: BottegaAppsPort;
  destination(target: { kind: "dock" } | { kind: "usage"; agent: AgentBackendId | null }): Promise<void>;
  loginItems: LoginItemApi | null;
  refreshMenu(): void;
  ensureBackground(): Promise<void>;
  menus: { item(service: DockService, itemId: string | null): Electron.Menu | null };
};
const LAYOUT_INTENTS = new Set(["add", "add-app-file", "remove", "undo", "move", "pin-running", "widget-apply"]);
type Runtime = { started: boolean; temporarilyHidden: boolean; hover: { bar: boolean; panel: boolean }; revealed: boolean; locked: boolean;
  busy: string | null; placement: BarPlacement | null; bar: BrowserWindow | null; barUrl: string; revision: number; shortcut: string | null;
  cleanup: (() => void)[] };

export class DockService {
  readonly native: DockNativeBridge | null;
  readonly apps: NativeApps | null;
  readonly downloads: DownloadsEntry;
  readonly trash: TrashEntry | null;
  readonly usage: DockUsage;
  readonly replacement: ReplacementController | null;
  readonly panel: PanelLifecycle;
  readonly files = new RecoveryFiles();
  readonly resolution = new Map<string, NativeResolution>();
  readonly drafts = new Map<string, DockWidget>();
  /** The applied Widget each draft started from; Apply compares against it so a newer remote edit is never overwritten silently. */
  readonly draftBases = new Map<string, string>();
  readonly staleDrafts = new Set<string>();
  undo: { token: import("../../../shared/system-dock/placement").UndoToken; label: string } | null = null;
  search = "";
  sync: SyncHandle | null = null;
  private ipc: DockIpc | null = null;
  private readonly settingsListeners = new Set<(snapshot: DockSettingsSnapshot) => void>();
  private readonly runtime: Runtime = { started: false, temporarilyHidden: false, hover: { bar: false, panel: false }, revealed: false, locked: false, busy: null,
    placement: null, bar: null, barUrl: "", revision: 0, shortcut: null, cleanup: [] };
  private publishQueued = false;
  /** Stores load after the first frame; nothing may read them (Usage pushes, IPC, menus) before that. */
  private ready = false;
  private layoutQueue: Promise<void> = Promise.resolve();
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private accessibility: DockSettingsSnapshot["accessibility"] = "unsupported";
  private previousFrontmost: number | null = null;
  private highlighted: string | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly ports: DockServicePorts) {
    const supported = ports.platform.capability.supported;
    this.native = supported ? new DockNativeBridge(ports.platform.paths.bridge, (code) => console.warn("[system-dock] native helper stopped", code)) : null;
    this.apps = this.native ? new NativeApps(this.native, ports.ownBundleId) : null;
    this.trash = this.native ? new TrashEntry(this.native, () => this.schedule()) : null;
    this.downloads = new DownloadsEntry({ openPath: (path) => import("electron").then(({ shell }) => shell.openPath(path)) }, () => this.schedule());
    this.usage = new DockUsage(ports.limits, ports.history, () => this.schedule());
    const serviceName = ports.platform.serviceName;
    this.replacement = this.native ? new ReplacementController({ native: this.native, files: this.files,
      registration: createRegistration(ports.platform.capability.replacement ? ports.loginItems : null, serviceName),
      machService: serviceName ? machServiceFor(serviceName) : null,
      owner: { installation: ports.installation, profile: ports.profile, appPath: ports.appPath, consentVersion: DOCK_CONSENT_VERSION },
      admission: () => this.admission(), alive: async (owner) => {
        if (!this.native) return true;
        try { const info = await this.native.request({ op: "process-info", pid: owner.pid }); return info.alive && (info.startedAt === null || info.startedAt === owner.startedAt); }
        catch { return true; }
      }, changed: () => { this.schedule(); this.ports.refreshMenu(); } }) : null;
    this.panel = new PanelLifecycle({
      create: () => this.createPanel(),
      place: (anchor) => this.placePanel(anchor),
      stillValid: (request) => !this.runtime.locked && this.runtime.started && (request.view.kind !== "detail" || this.layoutItem(request.view.itemId) !== undefined),
      presented: (request) => { this.onPanelPresented(request); },
      busy: (anchor) => { this.runtime.busy = anchor; this.schedule(); },
      failed: (cause) => console.warn("[system-dock] panel failed", cause),
    });
  }
  /* ============================================================ lifecycle */
  async initialize() {
    await Promise.all([this.ports.local.initialize(), this.ports.config.initialize()]);
    this.ready = true;
    // An old takeover is restored even when the feature is now off or gated (5.6, INV-05).
    if (this.replacement && await this.files.exists()) await this.replacement.recoverPrevious();
    // Local preferences change what the Dock shows too (e.g. hiding the running area can leave it empty).
    this.ports.local.onChanged(() => { this.schedule(); this.ports.refreshMenu(); this.checkEmpty(); });
    this.ports.config.onChanged(() => { this.pruneDrafts(); void this.resolveAll(); this.schedule(); this.checkEmpty(); });
    if (this.ports.local.get().enabled && this.ports.platform.capability.supported) await this.start();
    this.publish();
  }
  get capability() { return this.ports.platform.capability; }
  get revision() { return this.runtime.revision; }
  /** Darwin 24 = macOS 15: translucency is not part of the supported look there (5.6). */
  private barMaterial: "hud" | null = null;
  readonly solidBackground = Number.parseInt(release().split(".")[0] ?? "0", 10) === 24;
  /** A running item pinned by drag keeps answering to its temporary ID for the drop's follow-up move. */
  readonly aliases = new Map<string, string>();
  get started() { return this.runtime.started; }
  get initialized() { return this.ready; }
  get temporarilyHidden() { return this.runtime.temporarilyHidden; }
  actualMode(): DockMode | null {
    if (!this.runtime.started) return null;
    const state = this.ports.local.get();
    return state.preferredMode === "replace" && state.replacementEnabled && this.capability.replacement ? "replace" : "coexist";
  }
  async start() {
    if (this.runtime.started || !this.capability.supported) return;
    this.runtime.started = true;
    this.runtime.locked = powerMonitor.getSystemIdleState(1) === "locked";
    this.ipc = new DockIpc({ snapshot: (role) => role === "bar" ? this.barSnapshot() : this.panelSnapshot(),
      intent: (role, intent) => {
        const run = () => import("./intents").then(({ handleIntent }) => handleIntent(this, role, intent));
        // Layout edits apply in arrival order (a drag's pin-then-move); hover and launches never wait behind them.
        if (!LAYOUT_INTENTS.has(intent.kind)) return run();
        const next = this.layoutQueue.then(run, run);
        this.layoutQueue = next.catch(() => undefined);
        return next;
      },
      icons: (_role, keys) => this.apps?.iconData(keys) ?? Promise.resolve({}) });
    await this.apps?.start();
    const stopApps = this.apps?.onChanged(() => { this.schedule(); this.checkEmpty(); });
    const displays = () => { this.panel.destroy(); this.schedule(); };
    const lock = () => { this.runtime.locked = true; this.panel.destroy(); this.schedule(); };
    const unlock = () => { this.runtime.locked = false; this.schedule(); };
    screen.on("display-added", displays); screen.on("display-removed", displays); screen.on("display-metrics-changed", displays);
    powerMonitor.on("lock-screen", lock); powerMonitor.on("suspend", lock); powerMonitor.on("unlock-screen", unlock); powerMonitor.on("resume", unlock);
    this.runtime.cleanup.push(() => {
      stopApps?.();
      screen.removeListener("display-added", displays); screen.removeListener("display-removed", displays); screen.removeListener("display-metrics-changed", displays);
      powerMonitor.removeListener("lock-screen", lock); powerMonitor.removeListener("suspend", lock); powerMonitor.removeListener("unlock-screen", unlock); powerMonitor.removeListener("resume", unlock);
    });
    this.refreshAccessibility();
    await this.resolveAll();
    await this.createBar();
    this.bindShortcut();
    this.publish();
    if (this.actualMode() === "replace" && !this.runtime.temporarilyHidden) await this.replacement?.prepare();
    this.ports.refreshMenu();
  }
  /** `quit`/`hide` end this takeover only; `disable` also clears registration after restoring (INV-02). */
  async stop(kind: "quit" | "disable") {
    if (kind === "disable") await this.replacement?.unregister();
    else await this.replacement?.release();
    if (!this.runtime.started) return;
    this.runtime.started = false;
    this.panel.destroy();
    this.usage.setVisible("dock-bar", []); this.usage.setVisible("dock-panel", []);
    this.trash?.demand("bar", false); this.trash?.demand("panel", false);
    this.downloads.setVisible(false);
    if (this.runtime.shortcut) { globalShortcut.unregister(this.runtime.shortcut); this.runtime.shortcut = null; }
    this.runtime.cleanup.splice(0).forEach((stop) => stop());
    if (this.revealTimer) clearTimeout(this.revealTimer);
    const bar = this.runtime.bar; this.runtime.bar = null; this.ipc?.bind("bar", null);
    if (bar && !bar.isDestroyed()) bar.destroy();
    this.ipc?.close(); this.ipc = null;
    this.ports.refreshMenu(); this.publish();
  }
  /** Temporary hide restores the system Dock and keeps intent and registration (event table 3.1). */
  async setTemporarilyHidden(hidden: boolean) {
    if (this.runtime.temporarilyHidden === hidden) return;
    this.runtime.temporarilyHidden = hidden;
    if (hidden) { this.panel.close(); await this.replacement?.release(); }
    this.schedule(); this.ports.refreshMenu();
    if (!hidden && this.actualMode() === "replace") await this.replacement?.prepare();
  }
  /** Quit, step one: every system side effect is undone while the rest of the app is still alive. */
  async restoreForQuit() {
    await this.stop("quit").catch((cause) => console.warn("[system-dock] stop failed", cause));
    await this.replacement?.close().catch(() => undefined);
    this.usage.close(); this.trash?.close(); this.downloads.close(); this.apps?.close(); this.native?.close();
  }
  /** Quit, step two: stores close only after the cloud runtime released its sync handle. */
  async close() {
    await this.restoreForQuit();
    this.ready = false;
    await Promise.all([this.ports.local.close(), this.ports.config.close()]).catch(() => undefined);
  }
  /* ============================================================ replacement admission (INV-01/07/10) */
  admission(): ReplacementAdmission {
    const state = this.ports.local.get();
    if (!this.capability.replacement) return { ok: false, reason: "unsupported" };
    if (!state.enabled || !state.replacementEnabled || state.consentVersion !== DOCK_CONSENT_VERSION || this.runtime.temporarilyHidden || !this.runtime.started)
      return { ok: false, reason: "unsupported" };
    if (this.isEmpty()) return { ok: false, reason: "empty-layout" };
    if (!this.runtime.bar || this.runtime.bar.isDestroyed() || !this.runtime.placement || this.runtime.placement.hidden) return { ok: false, reason: "entry-unreachable" };
    return { ok: true };
  }
  /**
   * Whenever what the Dock can show changes (layout, local preferences, running Apps), an empty Dock or a lost entry
   * pauses an active takeover; resuming is the user's call (INV-07/10). Intent changes (disable, coexistence, hide)
   * run their own restore flows and are not paused here.
   */
  checkEmpty() {
    if (!this.replacement || this.replacement.status().phase !== "active") return;
    const admission = this.admission();
    if (!admission.ok && (admission.reason === "empty-layout" || admission.reason === "entry-unreachable")) void this.replacement.suspend(admission.reason);
  }
  /** The panel's Usage consumer follows what it shows: the draft while editing, the applied Widget otherwise. */
  refreshPanelDemand() {
    const current = this.panel.current();
    this.usage.setVisible("dock-panel", panelDemand(current.state === "visible" ? current.request?.view ?? null : null, (id) => this.layoutItem(id), this.drafts));
  }
  /* ============================================================ windows */
  private async createBar() {
    const url = dockEntryUrl(this.ports.mainDirectory, "bar");
    const window = createDockSurface({ mainDirectory: this.ports.mainDirectory, role: "bar", url, focusable: false, onGone: () => this.barGone() });
    this.runtime.bar = window; this.runtime.barUrl = url; this.barMaterial = null;
    this.ipc?.bind("bar", window, url);
    this.applyLevel(window);
    await window.loadURL(url).catch((cause) => console.warn("[system-dock] bar load failed", cause));
  }
  private applyLevel(window: BrowserWindow) {
    // Above the system Dock only while replacing; coexistence stays below it so the system Dock wins (INV-10, E1).
    window.setAlwaysOnTop(true, this.actualMode() === "replace" ? "pop-up-menu" : "floating");
  }
  private barGone() {
    void this.replacement?.suspend("renderer-failed");
    const bar = this.runtime.bar; this.runtime.bar = null;
    if (bar && !bar.isDestroyed()) bar.destroy();
    if (this.runtime.started) setTimeout(() => { if (this.runtime.started && !this.runtime.bar) void this.createBar().then(() => this.publish()); }, 1_000);
  }
  private async createPanel() {
    const url = dockEntryUrl(this.ports.mainDirectory, "panel");
    const window = createDockSurface({ mainDirectory: this.ports.mainDirectory, role: "panel", url, focusable: true, onGone: () => { this.ipc?.bind("panel", null); this.panel.destroy(); } });
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.on("blur", () => { const current = this.panel.current(); if (current.state === "visible" && current.request?.focus) this.panel.close(); });
    window.on("closed", () => this.ipc?.bind("panel", null));
    this.ipc?.bind("panel", window, url);
    await window.loadURL(url);
    return window;
  }
  private placePanel(anchor: string | null) {
    const placement = this.runtime.placement;
    if (!placement) return null;
    const { pinned, running } = this.visibleItems();
    const visible = [...pinned, ...running];
    const index = anchor ? visible.findIndex((item) => item.id === anchor) : -1;
    return placePanel(placement, metricItems(visible), pinned.length, index >= 0 ? index : null, this.ports.local.get().scale);
  }
  private onPanelPresented(request: OpenRequest | null) {
    const view = request?.view ?? null;
    const detail = view?.kind === "detail" ? this.layoutItem(view.itemId) : undefined;
    this.downloads.setVisible(detail?.kind === "system" && detail.entry === "system.downloads");
    this.trash?.demand("panel", detail?.kind === "system" && detail.entry === "system.trash");
    if (detail?.kind === "system" && detail.entry === "system.trash") void this.trash?.preflight(false);
    this.usage.setVisible("dock-panel", panelDemand(view, (id) => this.layoutItem(id), this.drafts));
    if (!request && this.search) this.search = "";
    this.schedule();
  }
  hover(role: DockRole, inside: boolean) {
    this.runtime.hover[role] = inside;
    const any = this.runtime.hover.bar || this.runtime.hover.panel;
    if (this.revealTimer) { clearTimeout(this.revealTimer); this.revealTimer = null; }
    if (any && !this.runtime.revealed) {
      this.panel.prewarm();
      this.revealTimer = setTimeout(() => { this.revealTimer = null; this.runtime.revealed = true; this.schedule(); }, 200);
    } else if (!any) {
      const collapse = () => {
        this.revealTimer = null;
        // The pointer resting in the margin under the strip is still "on the bar"; poll until it really leaves.
        const placement = this.runtime.placement;
        if (placement && inBarGap(placement, screen.getCursorScreenPoint(), this.ports.local.get().scale)) { this.revealTimer = setTimeout(collapse, 250); return; }
        const current = this.panel.current();
        if (current.state === "visible" && !current.request?.focus) this.panel.close();
        if (this.panel.current().state !== "visible") { this.runtime.revealed = false; this.schedule(); }
      };
      this.revealTimer = setTimeout(collapse, 600);
    }
  }
  reveal(value: boolean) { this.runtime.revealed = value; this.schedule(); }
  barWindow() { const bar = this.runtime.bar; return bar && !bar.isDestroyed() ? bar : undefined; }
  /** Focused views remember the app that had focus so Escape can hand it back (INV-09). */
  async openPanel(request: OpenRequest) {
    if (request.focus && this.panel.current().state !== "visible") this.previousFrontmost = this.apps?.frontmostPid() ?? null;
    await this.panel.open(request);
  }
  closePanel(restoreFocus: boolean) {
    const current = this.panel.current();
    const give = restoreFocus && current.state === "visible" && current.focused ? this.previousFrontmost : null;
    this.previousFrontmost = null;
    this.panel.close();
    if (give && this.native) void this.native.request({ op: "activate-pid", pid: give }).catch(() => undefined);
  }
  highlight(itemId: string | null) {
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.highlighted = itemId;
    if (itemId) this.highlightTimer = setTimeout(() => { this.highlighted = null; this.highlightTimer = null; this.schedule(); }, 1_600);
    this.runtime.revealed = true;
    this.schedule();
  }
  /* ============================================================ facts */
  layoutItem(itemId: string): DockItem | undefined { return this.ports.config.layout().items.find((item) => item.id === itemId); }
  private pruneDrafts() { for (const itemId of [...this.drafts.keys()]) if (!this.layoutItem(itemId)) this.dropDraft(itemId); }
  dropDraft(itemId: string) { this.drafts.delete(itemId); this.draftBases.delete(itemId); this.staleDrafts.delete(itemId); }
  async resolveAll() {
    if (!this.apps) return;
    const state = this.ports.local.get();
    await Promise.all(this.ports.config.layout().items.map(async (item) => {
      if (item.kind !== "native-app") return;
      const binding = state.nativeBindings[item.id];
      const value = binding ? await this.apps!.resolve({ path: binding.path }) ?? (item.bundleIdentifier ? await this.apps!.resolve({ bundleIdentifier: item.bundleIdentifier }) : null)
        : item.bundleIdentifier ? await this.apps!.resolve({ bundleIdentifier: item.bundleIdentifier }) : null;
      this.resolution.set(item.id, value ? { path: value.path, bundleIdentifier: value.bundleIdentifier, name: value.name } : null);
    }));
    this.schedule();
  }
  private facts() {
    const state = this.ports.local.get();
    const locale = this.ports.locale();
    const mode = this.actualMode() ?? state.preferredMode;
    return {
      resolution: (item: DockItem) => this.resolution.has(item.id) ? this.resolution.get(item.id)! : undefined,
      bottega: (appId: string | null) => this.ports.apps.fact(appId),
      running: this.apps?.runningRegular() ?? [],
      isRunning: (target: { bundleIdentifier: string | null; path: string | null }) => this.apps?.isRunning(target) ?? false,
      iconKey: (path: string | null) => this.apps?.iconKey(path) ?? null,
      finderPath: "/System/Library/CoreServices/Finder.app",
      downloadsPath: join(homedir(), "Downloads"),
      trash: this.trash?.face() ?? "unknown",
      widgetFace: (item: Extract<DockItem, { kind: "widget" }>) => {
        const widget = item.widget;
        const face = widget.type === "builtin.ai-limits" ? this.usage.limitsFace(widget) : this.usage.activityFace(widget);
        return state.privacyMask ? maskFace(face) : face;
      },
      label: (key: "finder" | "downloads" | "trash" | "limits" | "activity") => entryLabel(locale, key),
      showRunning: state.showRunningByMode[mode],
    };
  }
  visibleItems(): { pinned: DockBarItem[]; running: DockBarItem[]; overflow: number } {
    const layout = this.ports.config.layout();
    const facts = this.facts();
    const pinned = projectPinned(layout, facts);
    const running = projectRunning(layout, facts);
    const fit = this.runtime.placement?.fit ?? { pinned: pinned.length, running: running.length };
    return { pinned: pinned.slice(0, fit.pinned), running: running.slice(0, fit.running), overflow: pinned.length - Math.min(fit.pinned, pinned.length) + running.length - Math.min(fit.running, running.length) };
  }
  isEmpty(): boolean { return isDockEmpty(this.ports.config.layout(), this.facts()); }
  allItems(): DockBarItem[] { const layout = this.ports.config.layout(); const facts = this.facts(); return [...projectPinned(layout, facts), ...projectRunning(layout, facts)]; }
  private refreshAccessibility() {
    if (process.platform !== "darwin") return;
    try { this.accessibility = systemPreferences.isTrustedAccessibilityClient(false) ? "granted" : "not-granted"; } catch { this.accessibility = "unsupported"; }
  }
  private bindShortcut() {
    const accelerator = this.ports.local.get().shortcut;
    if (this.runtime.shortcut === accelerator) return;
    if (this.runtime.shortcut) globalShortcut.unregister(this.runtime.shortcut);
    this.runtime.shortcut = null;
    if (!accelerator || !this.runtime.started) return;
    try {
      if (globalShortcut.register(accelerator, () => { void this.openKeyboard(); })) this.runtime.shortcut = accelerator;
    } catch (cause) { console.warn("[system-dock] shortcut rejected", cause); }
  }
  /** The active keyboard entry: reveal, then open the focusable navigation panel (D2, INV-09). */
  async openKeyboard() {
    if (!this.runtime.started || this.runtime.locked) return;
    const current = this.panel.current();
    if (current.state === "visible" && current.request?.view.kind === "navigate") { this.panel.close(); return; }
    this.runtime.revealed = true; this.publish();
    await this.openPanel({ view: { kind: "navigate" }, focus: true, anchor: null });
  }
  /* ============================================================ snapshots */
  schedule() {
    if (this.publishQueued || !this.ready) return;
    this.publishQueued = true;
    setImmediate(() => { this.publishQueued = false; this.publish(); });
  }
  private displays(): DisplayFact[] {
    const primary = screen.getPrimaryDisplay().id;
    return screen.getAllDisplays().map((display) => ({ id: display.id, bounds: display.bounds, workArea: display.workArea, primary: display.id === primary }));
  }
  publish() {
    if (!this.ready) return;
    this.runtime.revision++;
    this.bindShortcut();
    const bar = this.runtime.bar;
    const state = this.ports.local.get();
    if (bar && !bar.isDestroyed() && this.runtime.started) {
      const layout = this.ports.config.layout();
      const facts = this.facts();
      const pinned = projectPinned(layout, facts), running = projectRunning(layout, facts);
      const mode = this.actualMode()!;
      const revealed = state.visibility === "pinned" || this.runtime.revealed || this.panel.visible || (!pinned.length && !running.length);
      const placement = placeBar({ displays: this.displays(), state, mode, revealed, handle: state.showHandle, pinned: metricItems(pinned), running: metricItems(running) });
      this.runtime.placement = placement;
      const visible = Boolean(placement && !placement.hidden && !this.runtime.locked && !this.runtime.temporarilyHidden);
      this.applyLevel(bar);
      if (visible && placement) { bar.setBounds(placement.bounds); if (!bar.isVisible()) bar.showInactive(); } else if (bar.isVisible()) bar.hide();
      // Only the revealed strip wears the native glass (the handle stays a drawn pill); where the compositor gives this
      // window a solid background anyway, the page draws the solid surface instead.
      const material = placement?.revealed && !this.solidBackground ? "hud" : null;
      if (material !== this.barMaterial) { this.barMaterial = material; bar.setVibrancy(material); }
      const showing = visible && Boolean(placement?.revealed);
      const visibleWidgets = pinned.slice(0, placement?.fit.pinned ?? 0).flatMap((item) => { const source = this.layoutItem(item.id); return source?.kind === "widget" ? [{ itemId: source.id, widget: source.widget }] : []; });
      this.usage.setVisible("dock-bar", showing ? visibleWidgets : []);
      this.trash?.demand("bar", showing && layout.items.some((item) => item.kind === "system" && item.entry === "system.trash"));
      this.ipc?.send("bar", this.barSnapshot());
    }
    if (this.panel.visible) this.ipc?.send("panel", this.panelSnapshot());
    const settings = this.settingsSnapshot();
    for (const listener of [...this.settingsListeners]) listener(settings);
  }
  barSnapshot(): DockBarSnapshot {
    const state = this.ports.local.get();
    const visible = this.visibleItems();
    const current = this.panel.current();
    return { revision: this.runtime.revision, locale: this.ports.locale(), mode: this.actualMode() ?? state.preferredMode, visibility: state.visibility,
      revealed: Boolean(this.runtime.placement?.revealed), showHandle: state.showHandle, scale: state.scale, privacyMask: state.privacyMask,
      pinned: visible.pinned, running: visible.running, overflow: visible.overflow, reducedMotion: systemPreferences.getAnimationSettings?.().prefersReducedMotion ?? false,
      panelTarget: current.state === "visible" && current.request?.view.kind === "detail" ? current.request.view.itemId : null,
      solidBackground: this.solidBackground, busyItemId: this.runtime.busy, highlightItemId: this.highlighted, empty: this.isEmpty(), syncPending: this.ports.config.snapshot().sync.pending };
  }
  panelSnapshot(): PanelSnapshot { return buildPanel(this); }
  onSettings(listener: (snapshot: DockSettingsSnapshot) => void) { this.settingsListeners.add(listener); return () => { this.settingsListeners.delete(listener); }; }
  settingsSnapshot(): DockSettingsSnapshot {
    const state = this.ready ? this.ports.local.get() : DEFAULT_DOCK_LOCAL_STATE;
    const record = this.ready ? this.ports.config.snapshot() : { layout: UNINITIALIZED_LAYOUT };
    const status = this.replacement?.status();
    return { revision: this.runtime.revision, capability: this.capability, state, actualMode: this.actualMode(), phase: status?.phase ?? "inactive",
      suspendReason: status?.reason ?? null, registration: status?.registration ?? "unsupported",
      recovery: { pending: false, lastResult: status?.lastResult ?? "none" }, layoutInitialized: record.layout.initialized, itemCount: record.layout.items.length,
      sync: this.sync?.status() ?? { state: "local-only", conflict: null }, accessibility: this.accessibility };
  }
  panelTargetItem(): string | null { const current = this.panel.current(); return current.state === "visible" && current.request?.view.kind === "detail" ? current.request.view.itemId : null; }
  orderedLayout() { return orderedItems(this.ports.config.layout()); }
}
