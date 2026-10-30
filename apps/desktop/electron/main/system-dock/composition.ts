/**
 * [INPUT]: Depends on Electron app, the macOS product-version Dock gate, stores, DockService/DockSetup, PluginCatalog, native menus, main-role renderer IPC, the window registry/surface residence, Bottega App records, and caller-provided task activity, Usage owners, presence destinations and background residence.
 * [OUTPUT]: Provides Dock runtime, cold Widget/Setup owners, trusted-window first-use commands, immediate local privacy reconciliation, recovery-first initialization and ordered shutdown.
 * [POS]: system-dock composition beneath the desktop root; the bar/panel never receive product capabilities and the main window never receives Dock paths or permissions.
 */
import { localizeDockTasks, type DockTasksPort } from './widgets/tasks';
import type { PluginCatalog } from '../plugins/catalog';
import { attachDockPlugin } from './plugin/owner';
import { app } from 'electron';
import { devRendererUrl } from '../window/security/frame-guard';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import type { AppLocale } from '@ai-chat/ui/lib/locale';
import type { AgentBackendId } from '../../../shared/ipc/agent/agent-ipc';
import { conflictChoiceSchema, dockPreferencePatchSchema, importConfirmSchema, setupConfirmSchema, SYSTEM_DOCK_SETTINGS_CHANNEL, setAppPinnedSchema } from '../../../shared/system-dock/ipc';
import { DOCK_MODES, type DockMode } from '../../../shared/system-dock/local-state';
import { setAppPinned } from './apps/pins';
import { createDockApps } from './apps/adapter';
import type { AppsService } from '../apps/apps-service';
import { rendererIpc } from '../registration/ipc-registrar';
import { windowRegistry } from '../window/surfaces/window-registry';
import { evaluateDockPlatform } from './capability';
import { DockService, type SyncHandle } from './service';
import type { DockSetup } from './setup';
import { DockConfigStore } from './store/config-store';
import { DockLocalStore } from './store/local-store';
import type { HistoryPort, LimitsPort, DockSurface } from './widgets/usage';
import { itemMenu, presenceSubmenu } from './window/menus';
import { backendRuntimeRegistry } from '../backends';
import { builtinProviderCatalog, knownBackend } from '../../../shared/providers/catalog';
import { pluginSurfaceIntegration } from '../plugins/surface-integration/runtime';
import type { BasesService } from '../bases/bases-service';
import { createDeferredOwner } from '../plugins/lifecycle/deferred';
import { WIDGET_COMMANDS, type DockWidgetFeature } from './widgets/custom/feature-api';
import type { DockCustomWidgetsPort, WidgetItem } from './widgets/custom/ports';
import type { CustomWidgetFace } from '../../../shared/system-dock/widgets/runtime';
export type SystemDockRuntimePorts = {
  plugins: PluginCatalog;
  mainDirectory: string;
  userData: string;
  locale(): AppLocale;
  installation: string;
  limits: LimitsPort | null;
  history: HistoryPort | null;
  tasks?: DockTasksPort;
  bases?: BasesService;
  apps(): AppsService | null;
  /** Main-window destinations through the presence sender (navigate / presence-destination). */
  send(command: import("../../../shared/ipc/settings/window-surfaces-ipc").SurfaceMigrationCommand, current?: () => boolean): Promise<void>;
  refreshMenu(): void;
  ensureBackground(): Promise<void>;
};
export function createSystemDockRuntime(ports: SystemDockRuntimePorts) {
  const platform = evaluateDockPlatform({ platform: process.platform, arch: process.arch, packaged: app.isPackaged, systemVersion: process.platform === 'darwin' ? process.getSystemVersion() : '', resourcesPath: process.resourcesPath, mainDirectory: ports.mainDirectory });
  const rendererUrl = devRendererUrl(app.isPackaged) ?? pathToFileURL(join(ports.mainDirectory, '../renderer/index.html')).href, appAdapter = createDockApps(ports), config = new DockConfigStore(ports.userData), local = new DockLocalStore(ports.userData), integration = pluginSurfaceIntegration();
  const projection: {
    service?: DockService;
  } = {}, surfaces = new Map<DockSurface, Parameters<DockCustomWidgetsPort['setVisible']>[1]>();
  let closing = false, failed = false;
  const taskAdapter = localizeDockTasks(ports.tasks, ports.locale, () => projection.service?.schedule());
  const feature = createDeferredOwner<DockWidgetFeature>(async (current) => { if (!integration)
    throw new Error('DOCK_AUTHORING_UNAVAILABLE'); const { createDockWidgetFeature } = await import('./widgets/custom/feature'); return createDockWidgetFeature({ runtime: ports, service, config, local, integration, tasks: taskAdapter.port, changed: widgetsChanged }, current); });
  const setup = createDeferredOwner(async current => {
    const {DockSetup}=await import('./setup');
    if(!current())throw new Error('DOCK_SETUP_CLOSED');
    // Setup owns in-memory previews; DockService owns every native resource.
    return {value:new DockSetup(service),close:()=>undefined};
  });
  const withSetup=async<T>(run:(owner:DockSetup)=>T):Promise<Awaited<T>>=>await run((await setup.get()).value);
  const hasWidgets = () => Boolean(integration?.hasDockState()) || config.layout().items.some(item => item.kind === 'widget' && item.widget.type === 'custom');
  const getWidgets = async (): Promise<DockWidgetFeature> => {
    try {
      if (!service.capability.supported)
        throw new Error('DOCK_UNSUPPORTED');
      const owner = await feature.get();
      if (closing)
        throw new Error('DOCK_WIDGET_FEATURE_CLOSED');
      if (service.ports.widgetDetail !== owner.detail) {
        service.ports.widgetDetail = owner.detail;
        for (const [surface, widgets] of surfaces)
          owner.data.setVisible(surface, widgets);
        owner.detail.presented(service.panelContainer(), service.panelTargetItem());
        service.schedule();
      }
      failed = false;
      return owner;
    }
    catch (error) {
      failed = true;
      throw error;
    }
  };
  const fallback = (item: WidgetItem): CustomWidgetFace => ({ type: 'custom', size: item.widget.type === 'custom' ? item.widget.size : 'small', state: failed ? 'failed' : 'loading', summary: null, description: null, readings: {} });
  const custom: DockCustomWidgetsPort = {
    face: (item, edge) => feature.peek()?.data.face(item, edge) ?? fallback(item),
    detail: (item, edge) => feature.peek()?.data.detail(item, edge) ?? { itemId: item.id, name: item.label ?? '', face: fallback(item), data: [], updatedAt: null, surface: null, actions: [] },
    setVisible(surface, widgets) { surfaces.set(surface, widgets); const owner = feature.peek(); if (owner)
      owner.data.setVisible(surface, widgets);
    else if (widgets.some(value => value.widget.type === 'custom') && !failed && !closing)
      void getWidgets().catch(() => service.schedule()); },
    source: id => feature.peek()?.data.source(id) ?? null,
    read: (id, sources) => { const owner = feature.peek(); if (!owner)
      throw new Error('DOCK_DATA_UNAVAILABLE'); return owner.data.read(id, sources); },
    refresh: async (id) => (await getWidgets()).data.refresh(id),
    invokeAction: async (id, ref) => { const owner = await getWidgets(); if (!owner.data.invokeAction)
      throw new Error('DOCK_ACTION_UNAVAILABLE'); return owner.data.invokeAction(id, ref); },
  };
  const service: DockService = new DockService({ platform, mainDirectory: ports.mainDirectory, local, config, locale: ports.locale, installation: ports.installation, profile: createHash('sha256').update(ports.userData).digest('hex').slice(0, 32),
    host: { open: () => { app.emit('activate'); }, quit: () => app.quit() }, appPath: process.execPath, ownBundleId: null, limits: ports.limits, history: ports.history, apps: appAdapter.apps, tasks: taskAdapter.port, custom,
    prepareCustom: async () => { if (hasWidgets())
      await getWidgets(); },
    accounts: { fingerprint: backend => backendRuntimeRegistry.accountFingerprint(backend), subscribe: listener => { const stop = backendRuntimeRegistry.subscribe(id => { const backend = knownBackend(builtinProviderCatalog, id); if (backend)
        listener(backend); }); return () => { stop(); }; } },
    destination: target => ports.send(target.kind === 'dock' ? { type: 'presence-destination', destination: 'dock' } : { type: 'presence-destination', destination: 'usage', ...(target.agent ? { agent: target.agent as AgentBackendId } : {}) }),
    widgetEntry: entry => ports.send({ type: 'dock-widget-entry', entry }), loginItems: platform.recoveryAvailable ? app : null, refreshMenu: ports.refreshMenu, ensureBackground: ports.ensureBackground, menus: { item: itemMenu },
  });
  projection.service = service;
  function widgetsChanged() { if (!service.initialized || closing)
    return; feature.peek()?.reconcile(); if (hasWidgets() && !feature.peek() && !feature.loading() && !failed)
    void getWidgets().then(() => widgetsChanged(), () => service.schedule()); service.schedule(); windowRegistry.publish(SYSTEM_DOCK_SETTINGS_CHANNEL.widgetsChanged, undefined, record => record.role === 'main'); }
  const stopApps = appAdapter.subscribe(() => service.schedule()), releasePlugin = attachDockPlugin(ports.plugins, service, {disable:()=>withSetup(owner=>owner.disable()),setPreference:patch=>withSetup(owner=>owner.setPreference(patch))});
  const mode = (value: unknown): DockMode => { if (!DOCK_MODES.includes(value as DockMode))
    throw new Error('DOCK_MODE_INVALID'); return value as DockMode; };
  const session = (value: unknown) => { if (typeof value !== 'string' || value.length < 8 || value.length > 64)
    throw new Error('DOCK_SESSION_INVALID'); return value; };
  const loaded = <T>(run: () => T): T => { if (!service.initialized)
    throw new Error('DOCK_NOT_READY'); return run(); };
  const ipc = rendererIpc(rendererUrl, 'Rejected untrusted Dock settings request');
  ipc.handle(SYSTEM_DOCK_SETTINGS_CHANNEL.widgetHealth, () => loaded(() => ({ ...feature.peek()?.health() ?? { detail: { views: 0, sessions: 0, timers: 0, requests: 0 }, base: { consumers: 0, flights: 0, timers: 0 } }, feature: { loaded: feature.peek() !== null, loading: feature.loading(), sourceLoaded: integration?.dockLoaded() ?? false } })));
  for (const command of WIDGET_COMMANDS)
    ipc.handleWithContext(SYSTEM_DOCK_SETTINGS_CHANNEL[command], (context,value) => loaded(async () => {
      if (command === 'widgetSnapshot' && !hasWidgets() && !feature.peek()) {
        const labels = new Map(service.allItems().map(item => [item.id, item.label]));
        return { layoutRevision: config.snapshot().localRevision, instances: config.layout().items.flatMap(item => item.kind === 'widget' ? [{ id: item.id, definitionId: item.widget.type === 'custom' ? item.widget.definition.definitionId : item.widget.type, name: labels.get(item.id) ?? item.label ?? '' }] : []), definitions: [] };
      }
      return (await getWidgets()).invoke(command, value,context.webContentsId);
    }));
  ipc.handle(SYSTEM_DOCK_SETTINGS_CHANNEL.snapshot, () => service.refreshSettings())
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.beginSetup, (value) => loaded(() => withSetup(owner=>owner.beginSetup(mode(value)))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.confirmSetup, (value) => loaded(() => withSetup(owner=>owner.confirmSetup(setupConfirmSchema.parse(value)))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.cancelSetup, (value) => loaded(() => withSetup(owner=>owner.cancelSetup(session(value)))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.importCandidates, () => loaded(() => withSetup(owner=>owner.importCandidates())))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.confirmImport, (value) => loaded(() => withSetup(owner=>owner.confirmImport(importConfirmSchema.parse(value)))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.setAppPinned, (value) => loaded(() => setAppPinned(service, setAppPinnedSchema.parse(value))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.setPreference, (value) => loaded(() => withSetup(owner=>owner.setPreference(dockPreferencePatchSchema.parse(value)))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.setMode, (value) => loaded(() => withSetup(owner=>owner.setMode(mode(value)))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.disable, () => loaded(() => withSetup(owner=>owner.disable())))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.restoreSystemDock, () => loaded(() => withSetup(owner=>owner.restoreSystemDock())))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.resume, () => loaded(() => withSetup(owner=>owner.resume())))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.resetLayout, () => loaded(() => withSetup(owner=>owner.resetLayout())))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.resolveConflict, (value) => loaded(() => withSetup(owner=>owner.resolveConflict(conflictChoiceSchema.parse(value)))))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.openRecoverySettings, () => loaded(() => withSetup(owner=>owner.openRecoverySettings())));
  const stopSettings = service.onSettings(snapshot => windowRegistry.publish(SYSTEM_DOCK_SETTINGS_CHANNEL.changed, snapshot, record => record.role === 'main')), stopWidgets = integration?.onChanged(widgetsChanged), stopWidgetLayout = config.onChanged(widgetsChanged), stopWidgetLocal = local.onChanged(() => feature.peek()?.reconcile());
  let stopSync: (() => void) | null = null, stopTasks: (() => void) | undefined;
  return { service, config: () => config,
    initialize: async () => { stopTasks = taskAdapter.port?.subscribe?.(() => { service.schedule(); feature.peek()?.reconcile(); }); await service.initialize(); widgetsChanged(); },
    menu: () => presenceSubmenu(service),
    attachSync(handle: SyncHandle | null) { stopSync?.(); service.sync = handle; stopSync = handle?.onChanged(() => service.schedule()) ?? null; service.schedule(); },
    restoreForQuit: () => service.restoreForQuit(),
    async close() { closing = true; stopWidgetLocal(); stopWidgetLayout(); stopWidgets?.(); stopApps(); taskAdapter.close(); stopTasks?.(); releasePlugin(); stopSettings(); stopSync?.(); service.sync = null; surfaces.clear(); const errors: unknown[] = []; for (const run of [() => feature.close(), () => setup.close(), () => service.close()])
      try {
        await run();
      }
      catch (error) {
        errors.push(error);
      } if (errors.length)
      throw new AggregateError(errors, 'SYSTEM_DOCK_CLEANUP_FAILED'); },
  };
}
