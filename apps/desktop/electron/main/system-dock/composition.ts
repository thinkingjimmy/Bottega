/**
 * [INPUT]: Depends on Electron app, the macOS product-version Dock gate, stores, DockService/DockSetup, PluginCatalog, native menus, main-role renderer IPC, the window registry/surface residence, Bottega App records, and caller-provided task activity, Usage owners, presence destinations and background residence.
 * [OUTPUT]: Provides Dock runtime, initialization-loaded unified Widgets and cold Setup/Weather implementations, trusted-window first-use commands, immediate local privacy reconciliation, recovery-first initialization, pending-copy replay, sender-bound Widget previews, local official installs, pre-sync migration capture and drained shutdown.
 * [POS]: system-dock composition beneath the desktop root; the bar/panel never receive product capabilities and the main window never receives Dock paths or permissions.
 */
import type { PluginDockWidgets } from './widgets/plugins/owner';
import { WidgetCatalogOwner } from './widgets/catalog/owner';
import type { OfficialWidgetDistribution } from './widgets/distribution/owner';
import type { OfficialWidgetMigration } from './widgets/distribution/migration';
import { officialWidgetId, widgetDirectoryRequestSchema } from '../../../shared/system-dock/widgets/catalog/distribution';
import { app, BrowserWindow, webContents } from 'electron';
import desktopPackage from '../../../package.json';
import { installPluginDockWidgets } from './widgets/plugins/runtime';
import { unifiedPluginIntegration } from '../plugins/integration/composition';
import { pluginProcessRuntime } from '../plugins/process/runtime';
import { type DockTasksPort } from './widgets/tasks';
import type { PluginCatalog } from '../plugins/catalog';
import { attachDockPlugin } from './plugin/owner';
import { rendererIdentity } from '../window/security/renderer-identity';
import { devRendererUrl } from '../window/security/frame-guard';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { installWeatherOwner, weatherOwner } from '../plugins/official/weather/runtime';
import { WEATHER_PLUGIN_ID } from '../../../shared/system-dock/widgets/weather';
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
  const feature = createDeferredOwner<DockWidgetFeature>(async (current) => { if (!integration)
    throw new Error('DOCK_AUTHORING_UNAVAILABLE'); const { createDockWidgetFeature } = await import('./widgets/custom/feature'); return createDockWidgetFeature({ runtime: ports, service, config, local, integration, tasks: ports.tasks, changed: widgetsChanged }, current); });
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
  let pluginWidgets: PluginDockWidgets;
  let distribution: OfficialWidgetDistribution | undefined;
  let migration: OfficialWidgetMigration | undefined;
  const officialDirectory = unifiedPluginIntegration()?.widgetCatalogDirectory;
  const isDistributedWidget = (widget: WidgetItem["widget"]) =>
    widget.type === "plugin" || Boolean(officialDirectory && widget.type === "builtin.ai-activity");
  const createPluginWidgets = (WidgetOwner: typeof PluginDockWidgets) => new WidgetOwner({ locale: ports.locale, userData: ports.userData, config, changed: () => { service.schedule(); if (service.initialized) windowRegistry.publish(SYSTEM_DOCK_SETTINGS_CHANNEL.widgetsChanged, undefined, record => record.role === 'main'); }, masked: () => local.get().privacyMask,
    ...(officialDirectory ? { officialUsage: () => service.usage } : {}),
    integration: () => { const unified = unifiedPluginIntegration(); return unified ? { platform: unified.platform, gateway: unified.gateway,
      invoke: input => { const runtime = pluginProcessRuntime(); if (!runtime) throw new Error('Plugin process runtime is unavailable'); return runtime.invoke(input); } } : null; } });
  const custom: DockCustomWidgetsPort = {
    candidates: () => pluginWidgets?.snapshot().definitions.map(value => ({ id: value.id, name: value.name, available: value.activeGenerationId !== null })) ?? [],
    officialDirectory: Boolean(officialDirectory),
    activityAllowed: () => pluginWidgets?.activityAllowed() ?? !officialDirectory,
    liveCards: id => pluginWidgets?.liveCards(id) ?? [],
    face: (item, edge) => isDistributedWidget(item.widget) ? pluginWidgets.face(item, edge) : feature.peek()?.data.face(item, edge) ?? fallback(item),
    detail: (item, edge) => isDistributedWidget(item.widget) ? pluginWidgets.detail(item, edge) : feature.peek()?.data.detail(item, edge) ?? { itemId: item.id, name: item.label ?? '', face: fallback(item), data: [], updatedAt: null, surface: null, actions: [] },
    setVisible(surface, widgets) {
      const window = surface === "dock-bar" ? service.barWindow() : surface === "dock-panel" ? service.panelContainer() : undefined;
      pluginWidgets?.setVisible(surface, widgets, window && !window.isDestroyed() ? window.webContents.id : undefined);
      surfaces.set(surface, widgets); const owner = feature.peek(); if (owner)
      owner.data.setVisible(surface, widgets);
    else if (widgets.some(value => value.widget.type === 'custom') && !failed && !closing)
      void getWidgets().catch(() => service.schedule()); },
    source: id => feature.peek()?.data.source(id) ?? null,
    read: (id, sources) => { const owner = feature.peek(); if (!owner)
      throw new Error('DOCK_DATA_UNAVAILABLE'); return owner.data.read(id, sources); },
    refresh: async (id) => config.layout().items.some(item => item.id === id && item.kind === "widget" && isDistributedWidget(item.widget)) ? pluginWidgets.refresh(id) : (await getWidgets()).data.refresh(id),
    invokeAction: async (id, ref) => { const owner = await getWidgets(); if (!owner.data.invokeAction)
      throw new Error('DOCK_ACTION_UNAVAILABLE'); return owner.data.invokeAction(id, ref); },
  };
  const service: DockService = new DockService({ platform, mainDirectory: ports.mainDirectory, local, config, locale: ports.locale, installation: ports.installation, profile: createHash('sha256').update(ports.userData).digest('hex').slice(0, 32),
    host: { open: () => { app.emit('activate'); }, quit: () => app.quit() }, appPath: process.execPath, ownBundleId: null, limits: ports.limits, history: ports.history, apps: appAdapter.apps, tasks: ports.tasks, custom,
    prepareCustom: async () => { if (hasWidgets())
      await getWidgets(); },
    accounts: { fingerprint: backend => backendRuntimeRegistry.accountFingerprint(backend), subscribe: listener => { const stop = backendRuntimeRegistry.subscribe(id => { const backend = knownBackend(builtinProviderCatalog, id); if (backend)
        listener(backend); }); return () => { stop(); }; } },
    destination: target => ports.send(target.kind === 'dock' ? { type: 'presence-destination', destination: 'dock' } : { type: 'presence-destination', destination: 'usage', ...(target.agent ? { agent: target.agent as AgentBackendId } : {}) }),
    widgetEntry: entry => ports.send({ type: 'dock-widget-entry', entry }), loginItems: platform.recoveryAvailable ? app : null, refreshMenu: ports.refreshMenu, ensureBackground: ports.ensureBackground, menus: { item: itemMenu },
  });
  projection.service = service;
  function widgetsChanged() { if (!service.initialized || closing)
    return; feature.peek()?.reconcile(); pluginWidgets.reconcile(); if (hasWidgets() && !feature.peek() && !feature.loading() && !failed)
    void getWidgets().then(() => widgetsChanged(), () => service.schedule()); service.schedule(); windowRegistry.publish(SYSTEM_DOCK_SETTINGS_CHANNEL.widgetsChanged, undefined, record => record.role === 'main'); }
  const syncOfficialDemand = () => {
    if (!officialDirectory || !service.initialized) return;
    for (const [surface, widgets] of surfaces) service.setWidgetDemand(surface, widgets);
    service.usage.forgetUnusedActivity();
  };
  const stopOfficialChanges = officialDirectory ? unifiedPluginIntegration()?.platform.onChanged(syncOfficialDemand) : undefined;
  const stopApps = appAdapter.subscribe(() => service.schedule()), releasePlugin = attachDockPlugin(ports.plugins, service, {disable:()=>withSetup(owner=>owner.disable()),setPreference:patch=>withSetup(owner=>owner.setPreference(patch))});
  const mode = (value: unknown): DockMode => { if (!DOCK_MODES.includes(value as DockMode))
    throw new Error('DOCK_MODE_INVALID'); return value as DockMode; };
  const session = (value: unknown) => { if (typeof value !== 'string' || value.length < 8 || value.length > 64)
    throw new Error('DOCK_SESSION_INVALID'); return value; };
  const loaded = <T>(run: () => T): T => { if (!service.initialized)
    throw new Error('DOCK_NOT_READY'); return run(); };
  const ipc = rendererIpc(rendererUrl, 'Rejected untrusted Dock settings request');
  const catalog = new WidgetCatalogOwner(service, () => pluginWidgets);
  ipc.handleWithContext(SYSTEM_DOCK_SETTINGS_CHANNEL.widgetDirectoryControl, (context, raw) => loaded(() => {
    if (!distribution) throw new Error("Official Widget catalog is unavailable");
    const assertWindow = () => {
      const contents = webContents.fromId(context.webContentsId);
      const window = contents && BrowserWindow.fromWebContents(contents);
      if (!window || window.isDestroyed() || !window.isVisible() || closing ||
        rendererIdentity(context.webContentsId).rendererSessionId !== context.rendererIncarnation) throw new Error("Widget catalog window closed");
    };
    const input = widgetDirectoryRequestSchema.parse(raw);
    if (input.kind === "repair") {
      assertWindow();
      if (!local.get().enabled) throw new Error("Dock is disabled");
      return migration!.retry(input.pluginId, assertWindow).then(repaired => ({ kind: "repair" as const, repaired }));
    }
    return distribution.control(input, context.webContentsId, assertWindow).then(result => result.kind === "browse"
      ? { ...result, directory: { ...result.directory, recovery: officialWidgetId.options.filter(id => migration?.needs(id)) } } : result);
  }));
  ipc.handleWithContext(SYSTEM_DOCK_SETTINGS_CHANNEL.widgetCatalogSnapshot, context => loaded(() => catalog.snapshot(context.webContentsId)))
    .handleWithContext(SYSTEM_DOCK_SETTINGS_CHANNEL.setWidgetCatalogVisible, (context, value) => loaded(() => catalog.setVisible(value, context.webContentsId)))
    .handleWithContext(SYSTEM_DOCK_SETTINGS_CHANNEL.widgetCatalogSurface, (context, value) => loaded(() => catalog.surface(value, context.webContentsId)));
  ipc.handle(SYSTEM_DOCK_SETTINGS_CHANNEL.widgetHealth, () => loaded(() => ({ ...feature.peek()?.health() ?? { detail: { views: 0, sessions: 0, timers: 0, requests: 0 }, base: { consumers: 0, flights: 0, timers: 0 } }, feature: { loaded: feature.peek() !== null, loading: feature.loading(), sourceLoaded: integration?.dockLoaded() ?? false },
    ...(distribution ? { officialWidgets: { ...pluginWidgets.cardResources(), ...unifiedPluginIntegration()?.surfaceResources() } } : {}) })));
  for (const command of WIDGET_COMMANDS)
    ipc.handleWithContext(SYSTEM_DOCK_SETTINGS_CHANNEL[command], (context,value) => loaded(async () => {
      if (command === 'widgetSnapshot') {
        const unified = pluginWidgets.snapshot();
        const labels = new Map(service.allItems().map(item => [item.id, item.label]));
        const existing = hasWidgets() || feature.peek() ? await (await getWidgets()).invoke(command, value, context.webContentsId) as import('../../../shared/system-dock/widgets/authoring').WidgetManagementSnapshot
          : { layoutRevision: config.snapshot().localRevision, instances: config.layout().items.flatMap(item => item.kind === 'widget' && item.widget.type !== 'plugin' ? [{ id: item.id, definitionId: item.widget.type === 'custom' ? item.widget.definition.definitionId : item.widget.type, name: labels.get(item.id) ?? item.label ?? '' }] : []), definitions: [] };
        const pluginIds = new Set(unified.instances.map(item => item.id));
        return { ...existing, definitions: [...existing.definitions, ...unified.definitions], instances: [...existing.instances.filter(item => !pluginIds.has(item.id)), ...unified.instances] };
      }
      return (await getWidgets()).invoke(command, value,context.webContentsId);
    }));
  ipc.handle(SYSTEM_DOCK_SETTINGS_CHANNEL.weatherControl, input => loaded(() => {
    if (!unifiedPluginIntegration()?.platform.isActive(WEATHER_PLUGIN_ID)) throw new Error('WEATHER_UNAVAILABLE');
    return weatherOwner().control(input);
  }));
  ipc.handle(SYSTEM_DOCK_SETTINGS_CHANNEL.pluginWidgetForm, input => loaded(() => pluginWidgets.form(input)))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.savePluginWidget, input => loaded(() => pluginWidgets.save(input)))
    .handle(SYSTEM_DOCK_SETTINGS_CHANNEL.removePluginWidget, input => loaded(() => pluginWidgets.remove(input)));
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
  const stopSettings = service.onSettings(snapshot => windowRegistry.publish(SYSTEM_DOCK_SETTINGS_CHANNEL.changed, snapshot, record => record.role === 'main')), stopWidgets = integration?.onChanged(widgetsChanged), stopWidgetLayout = config.onChanged(widgetsChanged), stopWidgetLocal = local.onChanged(() => { feature.peek()?.reconcile(); pluginWidgets?.reconcile(); syncOfficialDemand(); });
  let stopSync: (() => void) | null = null, stopTasks: (() => void) | undefined;
  return { service, config: () => config,
    initialize: async () => {
      const [{WeatherOwner},{PluginDockWidgets:WidgetOwner}]=await Promise.all([import('../plugins/official/weather/owner'),import('./widgets/plugins/owner')]);
      if(closing)throw new Error('SYSTEM_DOCK_CLOSED');
      pluginWidgets=createPluginWidgets(WidgetOwner);
      installPluginDockWidgets(pluginWidgets);
      installWeatherOwner(new WeatherOwner(ports.locale));
      stopTasks = ports.tasks?.subscribe?.(() => { service.schedule(); feature.peek()?.reconcile(); });
      if (officialDirectory && service.capability.supported) {
        const [{ OfficialWidgetDistribution }, { OfficialWidgetMigration }] = await Promise.all([
          import("./widgets/distribution/owner"), import("./widgets/distribution/migration"),
        ]);
        if (closing) throw new Error('SYSTEM_DOCK_CLOSED');
        const platform = unifiedPluginIntegration()!.platform;
        distribution = new OfficialWidgetDistribution({ platform, config, root: officialDirectory, userData: ports.userData,
          version: desktopPackage.version, available: () => service.initialized && local.get().enabled,
          supported: () => service.capability.supported, locale: ports.locale });
        await distribution.initialize().catch(error => console.warn("[official-widgets] package cleanup pending", error));
        if (closing) throw new Error('SYSTEM_DOCK_CLOSED');
        migration = new OfficialWidgetMigration({ platform, config, distribution, root: join(ports.mainDirectory, "official-widget-recovery"), userData: ports.userData });
      }
      await service.initialize();
      await migration?.capture();
      await pluginWidgets.initialize();
      widgetsChanged();
      migration?.start();
    },
    menu: () => presenceSubmenu(service),
    attachSync(handle: SyncHandle | null) { stopSync?.(); service.sync = handle; stopSync = handle?.onChanged(() => service.schedule()) ?? null; service.schedule(); },
    restoreForQuit: () => service.restoreForQuit(),
    async close() { closing = true; migration?.stopRequests(); stopOfficialChanges?.(); catalog.close(); installWeatherOwner(null); stopWidgetLocal(); stopWidgetLayout(); stopWidgets?.(); stopApps(); stopTasks?.(); releasePlugin(); stopSettings(); stopSync?.(); service.sync = null; surfaces.clear(); installPluginDockWidgets(null); const errors: unknown[] = []; for (const run of [() => distribution?.close(), () => migration?.close(), () => pluginWidgets?.close(), () => feature.close(), () => setup.close(), () => service.close()])
      try {
        await run();
      }
      catch (error) {
        errors.push(error);
      } if (errors.length)
      throw new AggregateError(errors, 'SYSTEM_DOCK_CLEANUP_FAILED'); },
  };
}
