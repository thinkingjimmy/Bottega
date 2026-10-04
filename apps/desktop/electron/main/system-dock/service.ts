/**
 * [INPUT]: Depends on Electron screen/power/shortcut/menu/shell, the Dock stores, native bridge adapters, entries, Usage adapter, replacement controller, window surfaces/geometry/panel lifecycle, projections, and caller ports (Bottega Apps, main-window destinations, tray refresh, background retention).
 * [OUTPUT]: Provides DockService: the single main-owned Dock runtime — enable/start/stop, actual mode, three-edge display directory/placement and revision-fenced hover, authoritative presentation, bounded transparent-frame transitions, the revealed bar's native glass, lazy panel orchestration, bar/panel/settings snapshots with coalesced publication, consumer demand per ready visible surface, serialized startup cleanup, generation-fenced startup, renderer recovery, intent admission and resolution, disabled recovery responsibility, truthful recovery/permission health, keyboard entry, temporary hide, and the replacement admission facts.
 * [POS]: system-dock orchestrator; intents live in intents.ts and Settings flows in setup.ts, both acting through this service. It is the only writer of DockConfigStore's working layout and DockLocalStore.
 */

import { BrowserWindow, globalShortcut, powerMonitor, screen, systemPreferences } from "electron";
import { type AgentAccounts, watchAgentAccounts } from "./widgets/account-watch";
import { homedir, release } from "node:os";
import { join } from "node:path";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import type { DockBarItem, DockBarSnapshot, DockSettingsSnapshot, DockSyncStatus, PanelSnapshot } from "../../../shared/system-dock/ipc";
import { UNINITIALIZED_LAYOUT, type DockItem, type DockWidget } from "../../../shared/system-dock/layout";
import { DEFAULT_DOCK_LOCAL_STATE, DOCK_CONSENT_VERSION, type DockMode, type DockDisplaySelection, type DockDisplayPreference } from "../../../shared/system-dock/local-state";
import type { DockPlacementStatus, DockPresentation } from "../../../shared/system-dock/displays";
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
import { inBarGap, resolveBarPlacement, placePanel, type BarPlacement } from "./window/geometry";
import { DisplayDirectory, dockClock, type DockClock } from "./window/display-observer";
import { PanelLifecycle, type OpenRequest } from "./window/panel";
import { applyDockGlass, clearDockGlass } from "./window/glass";
import { createDockSurface, DockIpc, dockEntryUrl, type DockRole } from "./window/surface";
import { DOCK_METRICS } from "../../../shared/system-dock/metrics";

export type BottegaAppsPort = { list(): { id: string; label: string; ready: boolean }[]; fact(appId: string | null): BottegaAppFact; open(appId: string): Promise<void> };
export type SyncHandle = { status(): DockSyncStatus; onChanged(listener: () => void): () => void; resolveConflict(choice: import("../../../shared/system-dock/ipc").ConflictChoice): Promise<unknown>; wake(): void };
export type DockServicePorts = {
  platform: DockPlatform;
  clock?: DockClock;
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
  /** Which account each Agent CLI is signed in to (an opaque fingerprint, null when unknown); read-only. */
  accounts?: AgentAccounts;
  apps: BottegaAppsPort;
  destination(target: { kind: "dock" } | { kind: "usage"; agent: AgentBackendId | null }): Promise<void>;
  loginItems: LoginItemApi | null;
  refreshMenu(): void;
  ensureBackground(): Promise<void>;
  menus: { item(service: DockService, itemId: string | null): Electron.Menu | null };
};
const PLACEMENT_INTENTS = new Set(["hover", "activate", "context-menu", "open-panel", "move", "pin-running"]);
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
  private generation = 0;
  private barLoad: Promise<void> | null = null;
  private barRetry: ReturnType<typeof setTimeout> | null = null;
  private barFailed = false;
  private barReady = false;
  private panelWindow: BrowserWindow | null = null;
  private panelSpaceUnavailable = false;
  private contextMenu: Electron.Menu | null = null;
  private readonly displayDirectory: DisplayDirectory;
  private placementKey = "";
  private locationRevision = 0;
  private locationReason: DockPlacementStatus["reason"] = "no-display";
  private presentation: DockPresentation = { presentation: "hidden", hiddenBy: "disabled" };
  private transition: { window: BrowserWindow; generation: number; revision: number; started: number; waitingForFrame: boolean; timer: ReturnType<typeof setTimeout> } | null = null;
  private get clock() { return this.ports.clock ?? dockClock; }
  get placementRevision() { return this.locationRevision; }
  directory() { return this.displayDirectory.snapshot(); }
  refreshDirectory() { return this.displayDirectory.refresh(); }
  resolveDisplaySelection(selection: DockDisplaySelection): DockDisplayPreference {
    if (selection.kind === "primary") return { displayId: null, preferExternal: false, label: null };
    if (selection.kind === "external") return { displayId: null, preferExternal: true, label: null };
    const display = this.refreshDirectory().find((entry) => entry.id === selection.displayId && entry.selectable && entry.label === selection.label);
    if (!display) { this.schedule(); throw new Error("DOCK_DISPLAY_UNAVAILABLE"); }
    return { displayId: display.id, preferExternal: false, label: display.label };
  }
  /** Stores load after the first frame; nothing may read them (Usage pushes, IPC, menus) before that. */
  private ready = false;
  private unavailableRecovery = false;
  private previousRecovery: DockSettingsSnapshot["recovery"]["lastResult"] = "none";
  private quitRestore: Promise<void> | null = null;
  private layoutQueue: Promise<void> = Promise.resolve();
  private revealTimer: ReturnType<typeof setTimeout> | null = null;
  private resolveRetry: ReturnType<typeof setTimeout> | null = null;
  private readonly stopAccounts: () => void;
  /* TASK-28: an Agent CLI signing in to a different account clears only that Agent's usage history (widgets/account-watch.ts). */
  private watchAccounts() {
    return watchAgentAccounts(this.ports.accounts, (backend) => { if (this.usage.hasHistory(backend)) this.usage.resetHistory(backend); });
  }
  private accessibility: DockSettingsSnapshot["accessibility"] = "unsupported";
  private previousFrontmost: number | null = null;
  private highlighted: string | null = null;
  private highlightTimer: ReturnType<typeof setTimeout> | null = null;
  constructor(readonly ports: DockServicePorts) {
    this.displayDirectory = new DisplayDirectory(() => this.publish(), this.clock);
    const supported = ports.platform.capability.supported;
    this.native = supported ? new DockNativeBridge(ports.platform.paths.bridge, (code) => console.warn("[system-dock] native helper stopped", code)) : null;
    this.apps = this.native ? new NativeApps(this.native, ports.ownBundleId) : null;
    this.trash = this.native ? new TrashEntry(this.native, () => this.schedule()) : null;
    this.downloads = new DownloadsEntry({ openPath: (path) => import("electron").then(({ shell }) => shell.openPath(path)) }, () => this.schedule());
    this.usage = new DockUsage(ports.limits, ports.history, () => this.schedule());
    this.stopAccounts = this.watchAccounts();
    const serviceName = ports.platform.serviceName;
    this.replacement = this.native ? new ReplacementController({ native: this.native, files: this.files,
      registration: createRegistration(ports.platform.recoveryAvailable ? ports.loginItems : null, serviceName),
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
      stillValid: (request) => !this.runtime.locked && !this.runtime.temporarilyHidden && this.runtime.started && Boolean(this.runtime.placement && !this.runtime.placement.hidden) && (request.view.kind !== "detail" || this.layoutItem(request.view.itemId) !== undefined),
      presented: (request) => { this.onPanelPresented(request); },
      busy: (anchor) => { this.runtime.busy = anchor; this.schedule(); },
      failed: (cause) => console.warn("[system-dock] panel failed", cause),
    });
  }
  /* ============================================================ lifecycle */
  async initialize() {
    await Promise.all([this.ports.local.initialize(), this.ports.config.initialize()]);
    // An old takeover is restored even when the feature is now off or gated (5.6, INV-05).
    this.previousRecovery = (await this.files.readLastResult())?.result ?? "none";
    if (this.replacement) {
      await this.replacement.recoverPrevious();
      if (!this.ports.local.get().enabled) await this.replacement.unregister().catch((cause) => console.warn("[system-dock] disabled recovery pending", cause));
      if (!this.ports.local.get().enabled) this.native?.release();
    } else this.unavailableRecovery = await this.files.exists();
    this.refreshAccessibility();
    if (this.quitRestore) return;
    this.ready = true;
    this.displayDirectory.start();
    // Local preferences change what the Dock shows too (e.g. hiding the running area can leave it empty).
    this.ports.local.onChanged(() => { this.schedule(); this.ports.refreshMenu(); this.checkEmpty(); });
    this.ports.config.onChanged(() => { this.pruneDrafts(); if (this.runtime.started) void this.resolveAll(); this.schedule(); this.checkEmpty(); });
    if (this.ports.local.get().enabled && this.capability.supported && !this.settingsSnapshot().recovery.pending)
      await this.start().catch((cause) => console.warn("[system-dock] start failed", cause));
    this.publish();
  }
  get capability() { return this.ports.platform.capability; }
  get revision() { return this.runtime.revision; }
  /** Darwin 24 = macOS 15: translucency is not part of the supported look there (5.6). */
  private barMaterial: "under-window" | null = null;
  private glassOn = false;
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
    if (this.runtime.started) return;
    if (this.quitRestore) throw new Error("DOCK_CLOSING");
    if (!this.capability.supported) throw new Error("DOCK_UNSUPPORTED");
    if (this.settingsSnapshot().recovery.pending) throw new Error("DOCK_RECOVERY_PENDING");
    this.runtime.started = true;
    const generation = this.generation;
    const assertCurrent = () => { if (this.quitRestore || !this.runtime.started || generation !== this.generation) throw new Error("DOCK_START_CANCELLED"); };
    try {
      this.runtime.locked = powerMonitor.getSystemIdleState(1) === "locked";
      this.ipc = new DockIpc({ snapshot: (role) => role === "bar" ? this.barSnapshot() : this.panelSnapshot(),
        intent: (role, intent) => {
          const admittedRevision = this.locationRevision;
          const currentPlacement = () => admittedRevision === this.locationRevision && (role !== "bar" || !PLACEMENT_INTENTS.has(intent.kind)
            || ("placementRevision" in intent && intent.placementRevision === this.locationRevision));
          if (intent.kind === "layout-ready") {
            assertCurrent();
            if (role === "bar") this.layoutReady(intent.placementRevision);
            return Promise.resolve();
          }
          const run = () => import("./intents").then(({ handleIntent }) => {
            assertCurrent();
            if (!currentPlacement()) return;
            return handleIntent(this, role, intent);
          });
          // Layout edits apply in arrival order (a drag's pin-then-move); hover and launches never wait behind them.
          if (!LAYOUT_INTENTS.has(intent.kind)) return run();
          const next = this.layoutQueue.then(run, run);
          this.layoutQueue = next.catch(() => undefined);
          return next;
        },
        icons: (_role, keys) => this.apps?.iconData(keys) ?? Promise.resolve({}) });
      await this.apps?.start();
      assertCurrent();
      const stopApps = this.apps?.onChanged(() => { this.schedule(); this.checkEmpty(); });
      const lock = () => { this.runtime.locked = true; this.invalidateInteractions(); this.locationRevision++; this.schedule(); };
      const unlock = () => { this.runtime.locked = false; this.refreshDirectory(); this.schedule(); };
      powerMonitor.on("lock-screen", lock); powerMonitor.on("suspend", lock); powerMonitor.on("unlock-screen", unlock); powerMonitor.on("resume", unlock);
      this.runtime.cleanup.push(() => {
        stopApps?.();
        powerMonitor.removeListener("lock-screen", lock); powerMonitor.removeListener("suspend", lock); powerMonitor.removeListener("unlock-screen", unlock); powerMonitor.removeListener("resume", unlock);
      });
      this.refreshAccessibility();
      await this.resolveAll();
      assertCurrent();
      await this.createBar();
      assertCurrent();
      this.bindShortcut();
      this.publish();
      if (this.actualMode() === "replace" && !this.runtime.temporarilyHidden) await this.replacement?.prepare();
      assertCurrent();
      this.ports.refreshMenu();
    } catch (cause) { if (generation === this.generation) await this.stop("quit"); throw cause; }
  }
  /** `quit`/`hide` end this takeover only; `disable` also clears registration after restoring (INV-02). */
  async stop(kind: "quit" | "disable") {
    if (kind === "disable" && this.unavailableRecovery) throw new Error("DOCK_RECOVERY_PENDING");
    if (kind === "disable") await this.replacement?.unregister();
    else await this.replacement?.release();
    this.runtime.started = false;
    this.generation++;
    if (this.barRetry) this.clock.clearTimeout(this.barRetry);
    this.barRetry = null; this.barLoad = null; this.barFailed = false; this.barReady = false;
    this.cancelTransition(); this.invalidateInteractions();
    this.usage.setVisible("dock-bar", []); this.usage.setVisible("dock-panel", []);
    this.trash?.demand("bar", false); this.trash?.demand("panel", false);
    this.downloads.setVisible(false);
    if (this.runtime.shortcut) { globalShortcut.unregister(this.runtime.shortcut); this.runtime.shortcut = null; }
    this.runtime.cleanup.splice(0).forEach((stop) => stop());
    if (this.revealTimer) this.clock.clearTimeout(this.revealTimer);
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.revealTimer = null; this.highlightTimer = null;
    this.runtime.hover = { bar: false, panel: false }; this.runtime.revealed = false; this.runtime.temporarilyHidden = false;
    if (this.resolveRetry) clearTimeout(this.resolveRetry);
    this.resolveRetry = null;
    const bar = this.runtime.bar; this.runtime.bar = null; this.glassOn = false; this.ipc?.bind("bar", null);
    if (bar && !bar.isDestroyed()) bar.destroy();
    this.ipc?.close(); this.ipc = null;
    this.apps?.close();
    // A disabled Dock keeps no 9 MB helper around; the restore above already finished with it (C-11).
    this.native?.release?.();
    this.ports.refreshMenu(); this.publish();
  }
  /** Temporary hide restores the system Dock and keeps intent and registration (event table 3.1). */
  async setTemporarilyHidden(hidden: boolean) {
    if (this.runtime.temporarilyHidden === hidden) return;
    this.runtime.temporarilyHidden = hidden;
    if (hidden) { this.invalidateInteractions(); this.locationRevision++; await this.replacement?.release(); }
    this.schedule(); this.ports.refreshMenu();
    if (!hidden && this.actualMode() === "replace") await this.replacement?.prepare();
  }
  /** Quit, step one: every system side effect is undone while the rest of the app is still alive. */
  restoreForQuit(): Promise<void> {
    return this.quitRestore ??= this.restoreBeforeQuit();
  }
  private async restoreBeforeQuit() {
    await this.stop("quit").catch((cause) => console.warn("[system-dock] stop failed", cause));
    await this.replacement?.close().catch(() => undefined);
    this.displayDirectory.close();
    this.stopAccounts(); this.usage.close(); this.trash?.close(); this.downloads.close(); this.apps?.close(); this.native?.close();
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
    if (!admission.ok && (admission.reason === "empty-layout" || admission.reason === "entry-unreachable")) this.replacement.suspendQuietly(admission.reason);
  }
  /** The panel's Usage consumer follows what it shows: the draft while editing, the applied Widget otherwise. */
  refreshPanelDemand() {
    const current = this.panel.current();
    this.usage.setVisible("dock-panel", panelDemand(current.state === "visible" ? current.request?.view ?? null : null, (id) => this.layoutItem(id), this.drafts));
  }
  /* ============================================================ windows */
  /** A coexistence renderer retry never changes replacement intent or system preferences. */
  async resumeBar() {
    if (this.quitRestore) throw new Error("DOCK_CLOSING");
    if (!this.capability.supported) throw new Error("DOCK_UNSUPPORTED");
    if (!this.runtime.started || !this.ports.local.get().enabled) throw new Error("DOCK_DISABLED");
    if (this.settingsSnapshot().recovery.pending) throw new Error("DOCK_RECOVERY_PENDING");
    await this.createBar();
  }
  private async createBar() {
    if (!this.runtime.started || this.quitRestore) throw new Error("DOCK_START_CANCELLED");
    if (this.barLoad) return this.barLoad;
    if (this.runtime.bar && !this.runtime.bar.isDestroyed()) return;
    if (this.barRetry) this.clock.clearTimeout(this.barRetry);
    this.barRetry = null;
    const generation = this.generation;
    const url = dockEntryUrl(this.ports.mainDirectory, "bar");
    const window = createDockSurface({ mainDirectory: this.ports.mainDirectory, role: "bar", url, focusable: false, onGone: () => this.barGone(window, generation) });
    const current = () => generation === this.generation && this.runtime.bar === window;
    this.cancelTransition();
    this.runtime.bar = window; this.runtime.barUrl = url; this.barMaterial = null; this.glassOn = false; this.barReady = false;
    this.ipc?.bind("bar", window, url);
    this.applyLevel(window);
    // Automatic recovery and Resume share one load; a window reference alone is not a ready renderer.
    const load = window.loadURL(url).then(() => {
      if (!current() || !this.runtime.started || this.quitRestore || window.isDestroyed()) throw new Error("DOCK_START_CANCELLED");
      this.barFailed = false; this.barReady = true;
      this.publish();
    }).catch((cause) => {
      if (current()) {
        this.cancelTransition();
        this.barFailed = true; this.barReady = false;
        this.runtime.bar = null; this.glassOn = false; this.ipc?.bind("bar", null);
        if (!window.isDestroyed()) window.destroy();
        this.publish();
      }
      throw cause;
    }).finally(() => { if (this.barLoad === load) this.barLoad = null; });
    this.barLoad = load;
    return load;
  }
  private applyLevel(window: BrowserWindow) {
    // Above the system Dock only while replacing; coexistence stays below it so the system Dock wins (INV-10, E1).
    window.setAlwaysOnTop(true, this.actualMode() === "replace" ? "pop-up-menu" : "floating");
  }
  private barGone(window: BrowserWindow, generation: number) {
    if (generation !== this.generation || this.runtime.bar !== window || !this.runtime.started || this.quitRestore) return;
    this.cancelTransition();
    this.barFailed = true; this.barReady = false;
    if (this.actualMode() === "replace") this.replacement?.suspendQuietly("renderer-failed");
    this.runtime.bar = null; this.glassOn = false; this.barLoad = null; this.ipc?.bind("bar", null);
    if (!window.isDestroyed()) window.destroy();
    this.publish();
    if (this.barRetry) this.clock.clearTimeout(this.barRetry);
    this.barRetry = this.clock.setTimeout(() => {
      this.barRetry = null;
      if (generation === this.generation && this.runtime.started && !this.quitRestore && !this.runtime.bar)
        void this.createBar().catch((cause) => console.warn("[system-dock] bar recreation failed", cause));
    }, 1_000);
  }
  private async createPanel() {
    const url = dockEntryUrl(this.ports.mainDirectory, "panel");
    const window = createDockSurface({ mainDirectory: this.ports.mainDirectory, role: "panel", url, focusable: true, onGone: () => {
      if (this.panelWindow !== window) return;
      this.panelWindow = null; this.ipc?.bind("panel", null); this.panel.destroy();
    } });
    this.panelWindow = window;
    window.setAlwaysOnTop(true, "pop-up-menu");
    window.on("blur", () => { if (this.panelWindow !== window) return; const current = this.panel.current(); if (current.state === "visible" && current.request?.focus) this.panel.close(); });
    window.on("closed", () => { if (this.panelWindow === window) { this.panelWindow = null; this.ipc?.bind("panel", null); } });
    this.ipc?.bind("panel", window, url);
    try { await window.loadURL(url); return window; }
    catch (cause) { if (!window.isDestroyed()) window.destroy(); throw cause; }
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
    /* A panel that closed (Esc, focus loss) takes its hover with it; a strip revealed by the keyboard or a highlight
       otherwise stayed up until the pointer happened to cross it (F-19). */
    if (!request && this.runtime.revealed) this.hover("panel", false);
    this.schedule();
  }
  hover(role: DockRole, inside: boolean) {
    if (!this.runtime.started || this.runtime.locked || this.runtime.temporarilyHidden) return;
    const isCurrent = this.captureInteraction();
    this.runtime.hover[role] = inside;
    const any = this.runtime.hover.bar || this.runtime.hover.panel;
    if (this.revealTimer) { this.clock.clearTimeout(this.revealTimer); this.revealTimer = null; }
    if (any && !this.runtime.revealed) {
      this.panel.prewarm();
      this.revealTimer = this.clock.setTimeout(() => { if (!isCurrent()) return; this.revealTimer = null; this.runtime.revealed = true; this.schedule(); }, 200);
    } else if (!any) {
      const collapse = () => {
        if (!isCurrent()) return;
        this.revealTimer = null;
        // The pointer resting in the margin under the strip is still "on the bar"; poll until it really leaves.
        const placement = this.runtime.placement;
        if (placement && inBarGap(placement, screen.getCursorScreenPoint(), this.ports.local.get().scale)) { this.revealTimer = this.clock.setTimeout(collapse, 250); return; }
        const current = this.panel.current();
        if (current.state === "visible" && !current.request?.focus) this.panel.close();
        if (this.panel.current().state !== "visible") { this.runtime.revealed = false; this.schedule(); }
      };
      this.revealTimer = this.clock.setTimeout(collapse, 600);
    }
  }
  reveal(value: boolean) { this.runtime.revealed = value; this.schedule(); }
  barWindow() { const bar = this.runtime.bar; return bar && !bar.isDestroyed() ? bar : undefined; }
  /** Focused views remember the app that had focus so Escape can hand it back (INV-09). */
  async openPanel(request: OpenRequest) {
    if (!this.runtime.started || this.runtime.locked || this.runtime.temporarilyHidden || !this.runtime.placement || this.runtime.placement.hidden) return;
    if (!this.placePanel(request.anchor)) {
      this.panelSpaceUnavailable = true; this.publish();
      await this.ports.destination({ kind: "dock" });
      return;
    }
    this.panelSpaceUnavailable = false;
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
    if (itemId) this.highlightTimer = setTimeout(() => {
      this.highlighted = null; this.highlightTimer = null; this.schedule();
      if (!this.runtime.hover.bar && !this.runtime.hover.panel) this.hover("bar", false);
    }, 1_600);
    this.runtime.revealed = true;
    this.schedule();
  }
  /* ============================================================ facts */
  layoutItem(itemId: string): DockItem | undefined { return this.ports.config.layout().items.find((item) => item.id === itemId); }
  private pruneDrafts() { for (const itemId of [...this.drafts.keys()]) if (!this.layoutItem(itemId)) this.dropDraft(itemId); }
  dropDraft(itemId: string) { this.drafts.delete(itemId); this.draftBases.delete(itemId); this.staleDrafts.delete(itemId); }
  async resolveAll() {
    if (!this.apps || !this.runtime.started) return;
    const state = this.ports.local.get(), generation = this.generation;
    const current = () => this.runtime.started && generation === this.generation;
    let unknown = false;
    await Promise.all(this.ports.config.layout().items.map(async (item) => {
      if (item.kind !== "native-app") return;
      const binding = state.nativeBindings[item.id];
      let value = binding ? await this.apps!.resolve({ path: binding.path }) : null;
      if (!current()) return;
      if (value == null && item.bundleIdentifier) value = await this.apps!.resolve({ bundleIdentifier: item.bundleIdentifier });
      if (!current()) return;
      // An unanswered lookup keeps what was known and is asked again shortly, instead of becoming a "missing" placeholder.
      if (value === undefined) { unknown = true; return; }
      this.resolution.set(item.id, value ? { path: value.path, bundleIdentifier: value.bundleIdentifier, name: value.name } : null);
    }));
    if (!current()) return;
    if (unknown && !this.resolveRetry) {
      this.resolveRetry = setTimeout(() => { this.resolveRetry = null; void this.resolveAll(); }, 5_000);
      this.resolveRetry.unref();
    }
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
    if (!this.runtime.started || this.runtime.locked || this.runtime.temporarilyHidden) return;
    const current = this.panel.current();
    if (current.state === "visible" && current.request?.view.kind === "navigate") { this.panel.close(); return; }
    this.runtime.revealed = true; this.publish();
    await this.openPanel({ view: { kind: "navigate" }, focus: true, anchor: null });
  }
  captureInteraction() {
    const generation = this.generation, revision = this.locationRevision;
    return () => this.runtime.started && generation === this.generation && revision === this.locationRevision && !this.quitRestore;
  }
  private closeMenu() { this.contextMenu?.closePopup(); this.contextMenu = null; }
  showContextMenu(itemId: string | null) {
    this.closeMenu();
    const menu = this.ports.menus.item(this, itemId), window = this.barWindow();
    if (!menu || !window) return;
    this.contextMenu = menu;
    menu.popup({ window, callback: () => { if (this.contextMenu === menu) this.contextMenu = null; } });
  }
  private invalidateInteractions() {
    this.panel.destroy();
    // A cold surface may not have entered PanelLifecycle's ready slot yet.
    if (this.panelWindow && !this.panelWindow.isDestroyed()) this.panelWindow.destroy();
    this.panelWindow = null;
    this.closeMenu();
    if (this.revealTimer) this.clock.clearTimeout(this.revealTimer);
    if (this.highlightTimer) clearTimeout(this.highlightTimer);
    this.revealTimer = null; this.highlightTimer = null; this.highlighted = null;
    this.runtime.hover = { bar: false, panel: false }; this.runtime.revealed = false;
    this.runtime.busy = null; this.previousFrontmost = null;
  }
  private cancelTransition() {
    const pending = this.transition;
    this.transition = null;
    if (!pending) return;
    this.clock.clearTimeout(pending.timer);
    if (!pending.window.isDestroyed()) {
      if (pending.waitingForFrame) pending.window.webContents.endFrameSubscription();
      pending.window.setOpacity(1); pending.window.setIgnoreMouseEvents(false);
    }
  }
  private beginTransition(window: BrowserWindow) {
    this.cancelTransition();
    const revision = this.locationRevision, generation = this.generation, started = this.clock.now();
    const timer = this.clock.setTimeout(() => {
      const pending = this.transition;
      if (!pending || pending.window !== window || pending.generation !== generation || pending.revision !== revision) return;
      this.cancelTransition();
      if (!this.runtime.started || this.generation !== generation || this.runtime.bar !== window || window.isDestroyed()) return;
      console.warn("[system-dock] layout transition timed out", { revision, elapsedMs: this.clock.now() - started, strategy: "transparent-frame" });
      this.publish();
    }, 500);
    this.transition = { window, generation, revision, started, timer, waitingForFrame: false };
    window.setIgnoreMouseEvents(true); window.setOpacity(0);
  }
  private layoutReady(revision: number) {
    const pending = this.transition;
    if (!pending || pending.waitingForFrame || revision !== pending.revision || revision !== this.locationRevision || pending.generation !== this.generation
      || pending.window !== this.runtime.bar || pending.window.isDestroyed() || !this.runtime.started) return;
    // A DOM commit is not a presented frame. The native probe verified frame subscription while opacity is zero.
    pending.waitingForFrame = true;
    pending.window.webContents.beginFrameSubscription(false, () => {
      if (this.transition !== pending || pending.revision !== this.locationRevision || pending.generation !== this.generation
        || pending.window !== this.runtime.bar || pending.window.isDestroyed() || !this.runtime.started) return;
      this.cancelTransition();
      this.publish();
    });
  }
  private decidePresentation(): DockPresentation {
    const state = this.ports.local.get(), placement = this.runtime.placement;
    const hidden = (hiddenBy: Extract<DockPresentation, { presentation: "hidden" }>["hiddenBy"]): DockPresentation => ({ presentation: "hidden", hiddenBy });
    if (!state.enabled) return hidden("disabled");
    if (!this.capability.supported) return hidden("unsupported");
    if (this.runtime.locked) return hidden("locked-or-sleeping");
    if (this.runtime.temporarilyHidden) return hidden("user");
    if (this.barFailed) return hidden("renderer-failed");
    if (!this.runtime.started || !this.barReady || this.quitRestore || this.unavailableRecovery || this.replacement?.status().pending) return hidden("not-ready");
    if (!placement) return hidden(this.locationReason === "no-display" ? "no-display" : "no-space");
    if (placement.hidden) return hidden("coexist-hide");
    if (this.transition) return hidden("transition");
    if (!placement.revealed && !state.showHandle) return hidden("autohide");
    return { presentation: placement.revealed ? "shown" : "handle", hiddenBy: null };
  }
  /* ============================================================ snapshots */
  schedule() {
    if (this.publishQueued || !this.ready) return;
    this.publishQueued = true;
    setImmediate(() => { this.publishQueued = false; this.publish(); });
  }
  publish() {
    if (!this.ready) return;
    this.runtime.revision++;
    this.bindShortcut();
    const bar = this.runtime.bar, state = this.ports.local.get();
    const layout = this.ports.config.layout(), facts = this.facts();
    const pinned = projectPinned(layout, facts), running = projectRunning(layout, facts);
    const previous = this.runtime.placement;
    const calculate = () => resolveBarPlacement({ displays: this.directory(), state, mode: this.actualMode() ?? "coexist",
      revealed: state.visibility === "pinned" || this.runtime.revealed || this.panel.visible || (!pinned.length && !running.length),
      handle: state.showHandle, pinned: metricItems(pinned), running: metricItems(running), currentDisplayId: previous?.display.id });
    let resolved = calculate();
    const display = resolved.placement?.display;
    const key = JSON.stringify([state.edge, state.scale, display?.id, display?.label, display?.bounds, display?.workArea, display?.scaleFactor, display?.rotation]);
    if (key !== this.placementKey) {
      const wasTransitioning = this.transition !== null;
      this.cancelTransition();
      this.placementKey = key; this.locationRevision++; this.panelSpaceUnavailable = false;
      this.invalidateInteractions();
      resolved = calculate();
      this.runtime.placement = resolved.placement; this.locationReason = resolved.reason;
      const gate = this.decidePresentation();
      if (bar && !bar.isDestroyed() && gate.presentation !== "hidden" && (wasTransitioning || bar.isVisible())
        && (wasTransitioning || (previous !== null && previous.edge !== state.edge))) this.beginTransition(bar);
    }
    if (resolved.placement?.hidden && (!previous?.hidden || this.panel.current().state !== "absent")) {
      this.cancelTransition(); this.invalidateInteractions(); this.locationRevision++;
      resolved = calculate();
    }
    const placement = resolved.placement;
    this.runtime.placement = placement; this.locationReason = resolved.reason;
    this.presentation = this.decidePresentation();
    if (bar && !bar.isDestroyed()) {
      // The invisible 2 DIP trigger is retained only for explicit no-handle autohide.
      const visible = this.presentation.presentation !== "hidden" || this.presentation.hiddenBy === "autohide" || this.presentation.hiddenBy === "transition";
      this.applyLevel(bar);
      if (placement) bar.setBounds(placement.bounds);
      if (visible) { if (!bar.isVisible()) bar.showInactive(); } else if (bar.isVisible()) bar.hide();
      // macOS 26 vibrancy paints a flat tint (measured, it does not follow the wallpaper). The revealed bar uses NSGlassEffectView.
      const wantGlass = Boolean(placement?.revealed) && !this.solidBackground;
      if (wantGlass) {
        if (!this.glassOn && this.barMaterial === null) {
          bar.setBackgroundColor("#00000000");
          this.glassOn = applyDockGlass(bar, this.ports.platform.paths.glass, DOCK_METRICS.stripRadius);
        }
        if (!this.glassOn && this.barMaterial !== "under-window") { this.barMaterial = "under-window"; bar.setVibrancy("under-window"); }
      } else {
        if (this.glassOn) { clearDockGlass(bar, this.ports.platform.paths.glass); this.glassOn = false; }
        if (this.barMaterial !== null) { this.barMaterial = null; bar.setVibrancy(null); }
      }
      this.ipc?.send("bar", this.barSnapshot());
    }
    const showing = this.presentation.presentation === "shown";
    const visibleWidgets = pinned.slice(0, placement?.fit.pinned ?? 0).flatMap((item) => {
      const source = this.layoutItem(item.id); return source?.kind === "widget" ? [{ itemId: source.id, widget: source.widget }] : [];
    });
    this.usage.setVisible("dock-bar", showing ? visibleWidgets : []);
    this.trash?.demand("bar", showing && layout.items.some((item) => item.kind === "system" && item.entry === "system.trash"));
    if (this.panel.visible) { this.panel.reposition(); this.ipc?.send("panel", this.panelSnapshot()); }
    const settings = this.settingsSnapshot();
    for (const listener of [...this.settingsListeners]) listener(settings);
  }
  barSnapshot(): DockBarSnapshot {
    const state = this.ports.local.get();
    const visible = this.visibleItems();
    const current = this.panel.current();
    return { revision: this.runtime.revision, edge: state.edge, placementRevision: this.locationRevision, locale: this.ports.locale(), mode: this.actualMode() ?? state.preferredMode, visibility: state.visibility,
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
    const rendererFailed = this.actualMode() === "coexist" && this.barFailed && !status?.pending;
    return { revision: this.runtime.revision, capability: this.capability, state, displays: this.directory(), panelSpaceUnavailable: this.panelSpaceUnavailable,
      placement: { ...this.presentation, effectiveDisplayId: this.runtime.placement?.display.id ?? null, edge: state.edge,
        reason: this.locationReason, sharedEdge: this.runtime.placement?.sharedEdge ?? false, placementRevision: this.locationRevision }, actualMode: this.actualMode(),
      phase: rendererFailed ? "suspended" : this.runtime.started && this.actualMode() === "coexist" && status?.phase === "inactive" ? "active" : status?.phase ?? "inactive",
      suspendReason: rendererFailed ? "renderer-failed" : status?.reason ?? null, registration: status?.registration ?? "unsupported",
      recovery: { pending: this.unavailableRecovery || status?.pending === true, lastResult: status?.lastResult ?? this.previousRecovery }, layoutInitialized: record.layout.initialized, itemCount: record.layout.items.length,
      sync: this.sync?.status() ?? { state: "local-only", conflict: null }, accessibility: this.accessibility, automation: this.trash?.snapshot().automation ?? "unavailable" };
  }
  panelTargetItem(): string | null { const current = this.panel.current(); return current.state === "visible" && current.request?.view.kind === "detail" ? current.request.view.itemId : null; }
}
