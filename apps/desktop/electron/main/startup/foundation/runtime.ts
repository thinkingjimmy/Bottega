/**
 * [INPUT]: Operations, Base ports, host custody, scoped Extensions, Provider catalog, plugin states and settings.
 * [OUTPUT]: Composes the shared foundation, plugin catalog, Provider bridges, renderer registrars and shutdown owners.
 * [POS]: Main startup foundation; execution and data ownership remain with their domain services.
 */
import type { HostCustodyDependencyPorts } from "../../host/processes/custody";
import { composeOperations } from "../../operations/composition";
import { createHostRuntime } from "../../host/composition";
import { announceComposition } from "../boot/composition-hooks";
import { windowRegistry } from "../../window/surfaces/window-registry";
import type { AppExtensionIntegration } from "../../extensions/integration/app-extension-composition";
import type { BuiltinMcpLeaseStore } from "../../tools/lease";
import type { BasesService } from "../../bases/bases-service";
import { composeBasePublicPorts } from "../../bases/public/composition";
import { installProviderBridge, ProviderBridgeRuntime } from "../../providers/host/runtime";
import { admitBundledProviderPackages } from "../../extensions/host/bundled-providers";
import { installProviderCatalog, registerProviderCatalog } from "../../providers/host/catalog";
import { createPackageProviderCatalog } from "../../providers/host/packages/package-catalog";
import { createDescriptorBackend } from "../../providers/host/packages/descriptor-backend";
import { followPackageProviders } from "../../providers/host/packages/runtime-sync";
import { ProviderAdmissionRefused } from "../../providers/host/admission";
import { extensionPackageRoot } from "../../extensions/skills/skill-candidates";
import { builtinProviderCatalog } from "../../../../shared/providers/catalog";
import { runtimePort } from "../../runtime";
import { backendRegistry, backendRuntimeRegistry, providerReadinessPlan } from "../../backends";
import { app, type BrowserWindow } from "electron";
import { AgentPluginInventory } from "../../extensions/agent-plugins/inventory";
import { GLOBAL_PRODUCT_RESOURCE_SCOPE } from "@ai-chat/cloud-protocol/contracts/resources";
import { setAgentBackendDisabled } from "../../agent-process-supervisor";
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { installProviderPluginSettings, PluginCatalog, PluginError } from "../../plugins/catalog";
import { PluginStateStore } from "../../plugins/states";
import { PluginSettingsStore } from "../../plugins/settings-store";
import { pluginHealth } from "../../plugins/health";
import { registerPlugins } from "../../plugins/ipc";
import { createProviderAdmission, installProviderRunnablePolicy, onProviderRunnablePolicyChanged, providerRunnable } from "../../extensions/trust/provider-admission";
import { installProviderAdmissionGate, installProviderRevocationCheck } from "../../providers/host/admission";
import { installHostPackageRuntime } from "../../extensions/host/runtime";
import { installForeignPackageRoots } from "../../backends/sandbox/fences";


export type FoundationRuntime = Awaited<ReturnType<typeof composeFoundationRuntime>>;

export async function composeFoundationRuntime(input: Parameters<typeof composeOperations>[0] & Readonly<{
  userData: string;
  mainDirectory: string;
  leases: BuiltinMcpLeaseStore;
  basesService: BasesService;
  /** The App service's answers for the dependencies host custody journals with a process (App references, extension plans). */
  custodyDependencies: HostCustodyDependencyPorts;
  extensions: Pick<AppExtensionIntegration, "attachHosts" | "installer" | "convergence" | "uninstall" | "registry">;
}>) {
  const operations = composeOperations(input);
  const bases = await composeBasePublicPorts({ userData: input.userData, service: input.basesService, registry: operations.registry });
  const hosts = createHostRuntime({ userData: input.userData, mainDirectory: input.mainDirectory, operations, dependencies: input.custodyDependencies });
  /* Process groups a crashed previous life left behind are cleaned before any host starts. */
  await hosts.initialize();
  const hostPackages = input.extensions.attachHosts(hosts);
  installHostPackageRuntime(hostPackages);
  /* The built-in Provider packages ship beside the main bundle (TASK-11 d3): admitted once here against their build pins; a refused one
     refuses only its own Provider, by name, when it is next used (P8). */
  const bundledProviders = await admitBundledProviderPackages(providerId => runtimePort().providerPackage(providerId));
  for (const refusal of bundledProviders.refused()) console.error(`[providers] ${refusal.message}`);
  /* The Provider catalog (TASK-11 d4a): the built-ins plus every installed Provider package, rebuilt on each inventory change outside the
     Registry's lock; a Provider that stops being available has its bridge closed. Each available package is built by the DescriptorBackend factory (d4b). */
  const registry = input.extensions.registry;
  let providers: ProviderBridgeRuntime | null = null;
  const catalog = createPackageProviderCatalog({ builtins: backendRegistry, factory: createDescriptorBackend,
    packages: () => registry.hostPackages().map(item => {
      const generation = item.generations.find(value => value.packageGenerationId === item.activeGenerationRef?.packageGenerationId);
      return { installIdentity: item.installIdentity, contentDigest: generation?.contentDigest ?? null, generationId: generation?.packageGenerationId ?? null,
        state: item.administrativeState === "active" ? "active" : "disabled", admission: item.admission };
    }),
    packageRoot: contentDigest => extensionPackageRoot(input.userData, contentDigest),
    /* d4c: a revoked package's Provider is unavailable (its bridge closes on the rebuild a revocation triggers below). */
    trustRefused: installIdentity => hostPackages.isRevoked(installIdentity),
    /* d4c: never list a Provider the gate would always refuse (a third-party module in production); the installed policy decides. */
    runnable: installIdentity => providerRunnable(installIdentity),
    closeProvider: (providerId, reason) => providers?.stop(providerId, `provider-unavailable: ${reason}`) });
  await catalog.rebuild();
  installProviderCatalog(catalog);
  /* d4b follow-up: a package Provider that stops being available, or changes generation, keeps no runtime facts (the registry never
     reads the catalog; the resolver answers it from here on). */
  const releasePackageFacts = followPackageProviders(catalog, providerId => backendRuntimeRegistry.forget(providerId),
    /* A package Provider available after a window's first Setup check reaches it as unknown, so the window asks for it (d5 F2). */
    providerId => backendRuntimeRegistry.invalidate(providerId));
  /* d4c: the gate asks the catalog who supplies an id; the sensitive roots follow the same inventory. */
  const providerAdmission = createProviderAdmission({ catalog, hostPackages, registry,
    packageRoot: digest => extensionPackageRoot(input.userData, digest) });
  registry.onInventoryChanged(() => { void catalog.rebuild(); void providerAdmission.refresh(); });
  /* A revocation does not write the Registry, so it rebuilds the catalog itself; so does a change of the runnable policy (E2E). */
  hostPackages.onRevoked(() => { void catalog.rebuild(); });
  onProviderRunnablePolicyChanged(() => { void catalog.rebuild(); });
  installProviderRunnablePolicy(providerAdmission.runnable);
  /* Every Provider runs on its bridge (TASK-11 flip); each proves readiness from its descriptor's own plan. A built-in's module comes from
     its bundled package, a package Provider's from its admitted package. */
  providers = new ProviderBridgeRuntime({ hosts, operations, mainDirectory: input.mainDirectory,
    packageBridge: async providerId => {
      const pkg = catalog.packageOf(providerId);
      return pkg ? hostPackages.ensure(pkg.installIdentity, "bridge") : null;
    },
    bridgeModule: providerId => {
      if (builtinProviderCatalog.get(providerId).known) return bundledProviders.get(providerId).bridge;
      const pkg = catalog.packageOf(providerId);
      if (!pkg) throw new ProviderAdmissionRefused(providerId, "package-inactive");
      return pkg.bridge;
    }, readinessPlan: providerReadinessPlan });
  installProviderBridge(providers);
  /* d4c: package Providers pass one gate on 3b's verdict and revoked mark (third-party bridge modules are refused this period); the
     same answers feed the last check before a bridge is created and the foreign-sensitive set every fence reads. */
  installProviderAdmissionGate(providerAdmission.gate);
  installProviderRevocationCheck(providerAdmission.revocationCheck);
  installForeignPackageRoots(providerAdmission.sensitiveRoots);
  await providerAdmission.refresh();
  announceComposition("foundation", { hosts, operations, leases: input.leases, extensions: input.extensions, hostPackages, bases, providers, ledger: input.ledger, windows: windowRegistry });
  /* Plugins & Apps (TASK-10, Q29): built-in states are applied before anything can spawn a turned-off Provider. */
  const pluginStates = new PluginStateStore(input.userData);
  await pluginStates.initialize();
  const pluginSettings = new PluginSettingsStore(input.userData);
  let plugins: PluginCatalog | null = null;
  const agentPlugins = new AgentPluginInventory(input.userData);
  plugins = new PluginCatalog({ states: pluginStates, settings: pluginSettings, now: () => Date.now(), appVersion: app.getVersion(),
    hostPackages: () => registry.hostPackages(),
    hostManifest: installIdentity => hostPackages.manifest(installIdentity),
    disableHostPackage: async item => {
      if (item.scope.kind !== "global") throw new PluginError("plugin-not-switchable");
      const version = registry.ownedInventory(GLOBAL_PRODUCT_RESOURCE_SCOPE, null).version;
      await input.extensions.convergence.beginDisable({ installIdentity: item.installIdentity, expectedScope: GLOBAL_PRODUCT_RESOURCE_SCOPE,
        expectedProjectLifecycleRevision: null, expectedScopeRevision: version.scopeRevision });
    },
    reenableHostPackage: async item => {
      if (item.scope.kind !== "global") throw new PluginError("plugin-not-switchable");
      const version = registry.ownedInventory(GLOBAL_PRODUCT_RESOURCE_SCOPE, null).version;
      await input.extensions.convergence.beginReenable({ installIdentity: item.installIdentity, expectedScope: GLOBAL_PRODUCT_RESOURCE_SCOPE,
        expectedProjectLifecycleRevision: null, expectedScopeRevision: version.scopeRevision }).catch((cause: { code?: string; status?: number }) => {
        /* A package whose files or record changed while it was off is never trusted back; anything else in the way is still settling. */
        if (cause?.code && /^package-(record|content)-/.test(cause.code)) throw new PluginError("plugin-reinstall-required");
        if (cause?.status === 409) throw new PluginError("plugin-busy");
        throw cause;
      });
    },
    nativePluginSwitchable: backendId => agentPlugins.canSetEnabled(backendId),
    setNativePluginEnabled: (backendId, pluginId, enabled) => agentPlugins.setEnabled(backendId, pluginId, enabled),
    nativePlugins: async () => (await agentPlugins.snapshot(registry.snapshot())).flatMap(view => "plugins" in view ? [view] : []),
    applyProvider: (providerId, enabled) => {
      if ((AGENT_BACKEND_ORDER as readonly string[]).includes(providerId)) setAgentBackendDisabled(providerId as AgentBackendId, !enabled);
    },
    stopProvider: providerId => providers!.stop(providerId, "provider-disabled"),
    health: (pluginId, entry) => pluginHealth(entry, { now: Date.now(),
      provider: providerId => (AGENT_BACKEND_ORDER as readonly string[]).includes(providerId) ? backendRuntimeRegistry.current(providerId as AgentBackendId) : null,
      packageRunning: installIdentity => hostPackages.outstanding(installIdentity).length > 0 }),
    packageSettingsChanged: (installIdentity, ids, restart, applied) => hostPackages.settingsChanged(installIdentity, ids, restart, applied) });
  plugins.applyStoredStates();
  installProviderPluginSettings(plugins);
  await plugins.refresh();
  registry.onInventoryChanged(() => { void plugins!.refresh(); });
  /* Appendix C.2: host-package negotiation reads the catalog's one resolution, so the page and the runtime agree. */
  hostPackages.attachAdmission(async installIdentity => {
    const resolution = await plugins!.resolveNow();
    return { missing: resolution.plugins[installIdentity]?.blockedBy.map(item => item.contract) ?? [],
      conflicts: resolution.conflicts.filter(item => item.pluginIds.includes(installIdentity)).map(item => item.contract) };
  });
  hostPackages.attachSettings(async installIdentity => {
    const manifest = await hostPackages.manifest(installIdentity);
    return manifest?.settings ? pluginSettings.packageValues(installIdentity, manifest.settings) : {};
  });
  return {
    operations, hosts, hostPackages, bases, plugins,
    registrar: { register: (window: BrowserWindow, rendererUrl: string) => {
      registerPlugins(plugins!, { now: () => Date.now(), chats: () => input.chats.list() }, window, rendererUrl);
      registerProviderCatalog(catalog, window, rendererUrl);
    } },
    stopAdmission: () => { plugins.stopAdmission(); hostPackages.stopAdmission(); operations.close(); },
    close: async () => {
      releasePackageFacts(); await plugins.close(); await hostPackages.close(); await hosts.close(); await bases.close();
      installProviderPluginSettings(null); await pluginStates.closeAndFlush(); await pluginSettings.closeAndFlush();
    },
  };
}
