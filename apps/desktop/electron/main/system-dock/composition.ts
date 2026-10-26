/**
 * [INPUT]: Depends on Electron app, the macOS product-version Dock gate, stores, DockService/DockSetup, PluginCatalog, native menus, main-role renderer IPC, the window registry/surface residence, Bottega App records, and caller-provided task activity, Usage owners, presence destinations and background residence.
 * [OUTPUT]: Provides createSystemDockRuntime: (its account watch hears built-ins only) constructs the Dock (stores under userData, gate evaluated before any Dock window/registration/write), registers Settings → Dock IPC for the main window only, publishes settings snapshots, routes the host through normal application activation and safe quit, exposes the Presence submenu, the plugin owner, task subscriptions with lazy role labels, sync attachment seam and ordered close. Composes live App facts, catalog pin IPC and standalone App activation.
 * [POS]: system-dock composition beneath the desktop root; the bar/panel never receive product capabilities and the main window never receives Dock paths or permissions.
 */

import { localizeDockTasks, type DockTasksPort } from "./widgets/tasks";
import type { PluginCatalog } from "../plugins/catalog";
import { attachDockPlugin } from "./plugin/owner";
import { app } from "electron";
import { devRendererUrl } from "../window/security/frame-guard";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import { conflictChoiceSchema, dockPreferencePatchSchema, importConfirmSchema, setupConfirmSchema, SYSTEM_DOCK_SETTINGS_CHANNEL } from "../../../shared/system-dock/ipc";
import { DOCK_MODES, type DockMode } from "../../../shared/system-dock/local-state";
import { setAppPinnedSchema } from "../../../shared/system-dock/ipc";
import { setAppPinned } from "./apps/pins";
import { createDockApps } from "./apps/adapter";
import type { AppsService } from "../apps/apps-service";
import { rendererIpc } from "../registration/ipc-registrar";
import { windowRegistry } from "../window/surfaces/window-registry";
import { evaluateDockPlatform } from "./capability";
import { DockService, type SyncHandle } from "./service";
import { DockSetup } from "./setup";
import { DockConfigStore } from "./store/config-store";
import { DockLocalStore } from "./store/local-store";
import type { HistoryPort, LimitsPort } from "./widgets/usage";
import { itemMenu, presenceSubmenu } from "./window/menus";
import { backendRuntimeRegistry } from "../backends";
import { builtinProviderCatalog, knownBackend } from "../../../shared/providers/catalog";

export type SystemDockRuntimePorts = {
  plugins: PluginCatalog;
  mainDirectory: string;
  userData: string;
  locale(): AppLocale;
  installation: string;
  limits: LimitsPort | null;
  history: HistoryPort | null;
  tasks?: DockTasksPort;
  apps(): AppsService | null;
  /** Main-window destinations through the presence sender (navigate / presence-destination). */
  send(command: import("../../../shared/ipc/settings/window-surfaces-ipc").SurfaceMigrationCommand): Promise<void>;
  refreshMenu(): void;
  ensureBackground(): Promise<void>;
};

export function createSystemDockRuntime(ports: SystemDockRuntimePorts) {
  const platform = evaluateDockPlatform({ platform: process.platform, arch: process.arch, packaged: app.isPackaged,
    systemVersion: process.platform === "darwin" ? process.getSystemVersion() : "", resourcesPath: process.resourcesPath, mainDirectory: ports.mainDirectory });
  const rendererUrl = devRendererUrl(app.isPackaged) ?? pathToFileURL(join(ports.mainDirectory, "../renderer/index.html")).href;
  const appAdapter = createDockApps(ports);
  const taskAdapter = localizeDockTasks(ports.tasks, ports.locale, () => service.schedule());
  const service = new DockService({
    platform, mainDirectory: ports.mainDirectory, local: new DockLocalStore(ports.userData), config: new DockConfigStore(ports.userData),
    locale: ports.locale, installation: ports.installation, profile: createHash("sha256").update(ports.userData).digest("hex").slice(0, 32),
    host: { open: () => { app.emit("activate"); }, quit: () => app.quit() },
    appPath: process.execPath, ownBundleId: null, limits: ports.limits, history: ports.history, apps: appAdapter.apps, tasks: taskAdapter.port,
    accounts: { fingerprint: (backend) => backendRuntimeRegistry.accountFingerprint(backend), subscribe: (listener) => { const stop = backendRuntimeRegistry.subscribe((id) => { const backend = knownBackend(builtinProviderCatalog, id); if (backend) listener(backend); }); return () => { stop(); }; } },
    destination: (target) => ports.send(target.kind === "dock" ? { type: "presence-destination", destination: "dock" }
      : { type: "presence-destination", destination: "usage", ...(target.agent ? { agent: target.agent as AgentBackendId } : {}) }),
    loginItems: platform.recoveryAvailable ? app : null,
    refreshMenu: ports.refreshMenu, ensureBackground: ports.ensureBackground,
    menus: { item: itemMenu },
  });
  const stopApps = appAdapter.subscribe(() => service.schedule());
  const setup = new DockSetup(service);
  const releasePlugin = attachDockPlugin(ports.plugins, service, setup);
  const mode = (value: unknown): DockMode => { if (!DOCK_MODES.includes(value as DockMode)) throw new Error("DOCK_MODE_INVALID"); return value as DockMode; };
  const session = (value: unknown) => { if (typeof value !== "string" || value.length < 8 || value.length > 64) throw new Error("DOCK_SESSION_INVALID"); return value; };
  // Every flow except the snapshot needs loaded stores; a request racing startup fails instead of reading an empty file.
  const loaded = <T>(run: () => T): T => { if (!service.initialized) throw new Error("DOCK_NOT_READY"); return run(); };
  rendererIpc(rendererUrl, "Rejected untrusted Dock settings request")
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.snapshot, () => service.refreshSettings())
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.beginSetup, (value) => loaded(() => setup.beginSetup(mode(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.confirmSetup, (value) => loaded(() => setup.confirmSetup(setupConfirmSchema.parse(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.cancelSetup, (value) => loaded(() => setup.cancelSetup(session(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.importCandidates, () => loaded(() => setup.importCandidates()))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.confirmImport, (value) => loaded(() => setup.confirmImport(importConfirmSchema.parse(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.setAppPinned, (value) => loaded(() => setAppPinned(service, setAppPinnedSchema.parse(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.setPreference, (value) => loaded(() => setup.setPreference(dockPreferencePatchSchema.parse(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.setMode, (value) => loaded(() => setup.setMode(mode(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.disable, () => loaded(() => setup.disable()))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.restoreSystemDock, () => loaded(() => setup.restoreSystemDock()))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.resume, () => loaded(() => setup.resume()))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.resetLayout, () => loaded(() => setup.resetLayout()))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.resolveConflict, (value) => loaded(() => setup.resolveConflict(conflictChoiceSchema.parse(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.openRecoverySettings, () => loaded(() => setup.openRecoverySettings()));
  const stopSettings = service.onSettings((snapshot) => windowRegistry.publish(SYSTEM_DOCK_SETTINGS_CHANNEL.changed, snapshot, (record) => record.role === "main"));
  let stopSync: (() => void) | null = null;
  let stopTasks: (() => void) | undefined;
  return {
    service,
    config: () => service.ports.config,
    initialize: () => { stopTasks = taskAdapter.port?.subscribe?.(() => service.schedule()); return service.initialize(); },
    menu: () => presenceSubmenu(service),
    /** Account-config sync attaches after the cloud runtime exists; the Dock works fully without it (INV-16). */
    attachSync(handle: SyncHandle | null) {
      stopSync?.(); service.sync = handle;
      stopSync = handle?.onChanged(() => service.schedule()) ?? null;
      service.schedule();
    },
    restoreForQuit: () => service.restoreForQuit(),
    async close() { stopApps(); taskAdapter.close(); stopTasks?.(); releasePlugin(); stopSettings(); stopSync?.(); service.sync = null; await service.close(); },
  };
}
