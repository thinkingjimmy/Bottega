/**
 * [INPUT]: Depends on Electron app, the Dock platform gate, stores, DockService/DockSetup, native menus, main-role renderer IPC, the window registry/surface residence, Bottega App records, and caller-provided Usage owners, presence destinations and background residence.
 * [OUTPUT]: Provides createSystemDockRuntime: constructs the Dock (stores under userData, gate evaluated before any Dock window/registration/write), registers Settings → Dock IPC for the main window only, publishes settings snapshots, exposes the Presence submenu, the sync attachment seam and ordered close.
 * [POS]: system-dock composition beneath the desktop root; the bar/panel never receive product capabilities and the main window never receives Dock paths or permissions.
 */

import { app } from "electron";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import { conflictChoiceSchema, dockPreferencePatchSchema, importConfirmSchema, setupConfirmSchema, SYSTEM_DOCK_SETTINGS_CHANNEL } from "../../../shared/system-dock/ipc";
import { DOCK_MODES, type DockMode } from "../../../shared/system-dock/local-state";
import { appStudioSurface } from "../../../shared/window-surfaces-ipc";
import type { AppsService } from "../apps/apps-service";
import { rendererIpc } from "../ipc-registrar";
import { windowRegistry } from "../window/surfaces/window-registry";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import { evaluateDockPlatform } from "./capability";
import { DockService, type SyncHandle } from "./service";
import { DockSetup } from "./setup";
import { DockConfigStore } from "./store/config-store";
import { DockLocalStore } from "./store/local-store";
import type { HistoryPort, LimitsPort } from "./widgets/usage";
import { itemMenu, presenceSubmenu } from "./window/menus";

export type SystemDockRuntimePorts = {
  mainDirectory: string;
  userData: string;
  locale(): AppLocale;
  installation: string;
  limits: LimitsPort | null;
  history: HistoryPort | null;
  apps(): AppsService | null;
  /** Main-window destinations through the presence sender (navigate / presence-destination). */
  send(command: import("../../../shared/window-surfaces-ipc").SurfaceMigrationCommand): Promise<void>;
  refreshMenu(): void;
  ensureBackground(): Promise<void>;
};

export function createSystemDockRuntime(ports: SystemDockRuntimePorts) {
  const platform = evaluateDockPlatform({ platform: process.platform, arch: process.arch, packaged: app.isPackaged,
    resourcesPath: process.resourcesPath, mainDirectory: ports.mainDirectory });
  const rendererUrl = process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(join(ports.mainDirectory, "../renderer/index.html")).href;
  const apps = {
    list: () => (ports.apps()?.store.list() ?? []).filter((record) => !["deleting", "quarantined"].includes(record.state))
      .map((record) => ({ id: record.id, label: record.displayName, ready: record.state === "ready" })),
    fact: (appId: string | null) => {
      const record = appId ? ports.apps()?.store.get(appId) : undefined;
      if (!record || record.state === "deleting") return { label: record?.displayName ?? "", state: "missing" as const, running: false };
      // Running means an actual App surface window, not a background runtime or Agent task (3.5).
      const owner = surfaceWindowController.residence.get(appStudioSurface(record.id)).windowId;
      return { label: record.displayName, state: record.state === "ready" ? "ready" as const : "unavailable" as const, running: owner !== null && windowRegistry.get(owner)?.role === "app-window" };
    },
    /** D4: reuse and focus an open App window; otherwise the current profile's Use entry, without pre-starting its runtime. */
    open: async (appId: string) => {
      const owner = surfaceWindowController.residence.get(appStudioSurface(appId)).windowId;
      if (owner !== null && windowRegistry.get(owner)?.role === "app-window" && windowRegistry.focus(owner)) return;
      await ports.send({ type: "navigate", route: `/apps/${encodeURIComponent(appId)}/app` });
    },
  };
  const service = new DockService({
    platform, mainDirectory: ports.mainDirectory, local: new DockLocalStore(ports.userData), config: new DockConfigStore(ports.userData),
    locale: ports.locale, installation: ports.installation, profile: createHash("sha256").update(ports.userData).digest("hex").slice(0, 32),
    appPath: process.execPath, ownBundleId: null, limits: ports.limits, history: ports.history, apps,
    destination: (target) => ports.send(target.kind === "dock" ? { type: "presence-destination", destination: "dock" }
      : { type: "presence-destination", destination: "usage", ...(target.agent ? { agent: target.agent as AgentBackendId } : {}) }),
    loginItems: platform.capability.replacement ? app : null,
    refreshMenu: ports.refreshMenu, ensureBackground: ports.ensureBackground,
    menus: { item: itemMenu },
  });
  const setup = new DockSetup(service);
  const mode = (value: unknown): DockMode => { if (!DOCK_MODES.includes(value as DockMode)) throw new Error("DOCK_MODE_INVALID"); return value as DockMode; };
  const session = (value: unknown) => { if (typeof value !== "string" || value.length < 8 || value.length > 64) throw new Error("DOCK_SESSION_INVALID"); return value; };
  // Every flow except the snapshot needs loaded stores; a request racing startup fails instead of reading an empty file.
  const loaded = <T>(run: () => T): T => { if (!service.initialized) throw new Error("DOCK_NOT_READY"); return run(); };
  rendererIpc(rendererUrl, "Rejected untrusted Dock settings request")
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.snapshot, () => service.settingsSnapshot())
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.beginSetup, (value) => loaded(() => setup.beginSetup(mode(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.confirmSetup, (value) => loaded(() => setup.confirmSetup(setupConfirmSchema.parse(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.cancelSetup, (value) => loaded(() => setup.cancelSetup(session(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.importCandidates, () => loaded(() => setup.importCandidates()))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.confirmImport, (value) => loaded(() => setup.confirmImport(importConfirmSchema.parse(value))))
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
  return {
    service,
    config: () => service.ports.config,
    initialize: () => service.initialize(),
    menu: () => presenceSubmenu(service),
    /** Account-config sync attaches after the cloud runtime exists; the Dock works fully without it (INV-16). */
    attachSync(handle: SyncHandle | null) {
      stopSync?.(); service.sync = handle;
      stopSync = handle?.onChanged(() => service.schedule()) ?? null;
      service.schedule();
    },
    restoreForQuit: () => service.restoreForQuit(),
    async close() { stopSettings(); stopSync?.(); service.sync = null; await service.close(); },
  };
}
