/**
 * [INPUT]: Depends on the operation layer, the utility host runtime, the Extension integration's host-package attachment, the builtin-MCP lease store and the live turn registry (which workflow Chats wait on the person)
 * [OUTPUT]: Provides composeFoundationRuntime (operations broker + registry, the Base public ports registered on it, utility hosts reconciled before any host starts, host packages made runnable, the built-in Provider packages admitted against their build pins (TASK-11 d3) before the Provider bridges are composed, the package-aware Provider catalog (built-ins plus installed Provider packages, rebuilt on every inventory change, closing an unavailable Provider's bridge; TASK-11 d4a) with its main-window IPC and its package Providers' runtime facts forgotten when one stops being available or changes generation and announced to every window when one becomes available, Provider host-probe measurements (adopted from the runtimes the registry already knows, probed only on demand) feeding Agent configurations, the plugin catalog (built-in states applied before anything spawns, declarative settings in their store, main-side health, the catalog's one resolution attached to host-package negotiation, each package's settings.get and settings delivery, and the Provider plugin settings each turn freezes), the workflow runtime (TASK-17; its Chat index loaded before any window, installed into the Chat summary projection) and the main-window registrar for Agent configurations, Plugins & Apps and workflows) and FoundationRuntime (stopAdmission, close) Provider readiness for workflows comes from provider-readiness.ts (E2-04: ready only on positive sign-in evidence). For workflow role admission it also answers which explicit settings the Provider's runtime here cannot apply (T21-c) and records that on the configuration. The package-Provider gate (d4c) is installed before any Provider bridge can start: admission, its last check before a bridge is created, and the foreign-sensitive package roots.
 * The plugin catalog names Workflow's enabled Projects and refreshes when bindings change.
 * All four Providers supply workflow measurements; scoped Kimi authentication and localized default configurations share the production services.
 * Package metadata remains readable while disabled; settings.get supplies effective values through the host's process-start snapshot.
 * Settings delivery carries a revision acknowledgement invoked after successful replacement, while Provider overrides remain changed-only.
 * Shutdown first stops package admission, then closes package queues and hosts before the utility-host and persistence owners.
 * [POS]: The one startup seam for the composable-workbench foundation; index.ts calls it once after the ledgers and the builtin bridge exist, and closes it among the terminal owners
 */
import type { HostCustodyDependencyPorts } from "../../host/processes/custody";
import { composeOperations } from "../../operations/composition";
import { createHostRuntime } from "../../host/composition";
import { announceComposition } from "../boot/composition-hooks";
import type { AppExtensionIntegration } from "../../extensions/integration/app-extension-composition";
import type { BuiltinMcpLeaseStore } from "../../tools/lease";
import type { BasesService } from "../../bases/bases-service";
import { composeBasePublicPorts } from "../../bases/public/composition";
import { homedir } from "node:os";
import { join } from "node:path";
import { installProviderBridge, ProviderBridgeRuntime } from "../../providers/host/runtime";
import { admitBundledProviderPackages } from "../../extensions/host/bundled-providers";
import { installProviderCatalog, registerProviderCatalog } from "../../providers/host/catalog";
import { createPackageProviderCatalog } from "../../providers/host/packages/package-catalog";
import { createDescriptorBackend } from "../../providers/host/packages/descriptor-backend";
import { followPackageProviders } from "../../providers/host/packages/runtime-sync";
import { ProviderAdmissionRefused } from "../../providers/host/admission";
import { extensionPackageRoot } from "../../extensions/skills/skill-candidates";
import { builtinProviderCatalog, knownBackend } from "../../../../shared/providers/catalog";
import { runtimePort } from "../../runtime";
import { composeAgentConfigs } from "../../agent-configs/runtime";
import { backendById, backendRegistry, backendRuntimeRegistry, providerReadinessPlan } from "../../backends";
import { MeasurementStore } from "../../providers/measurements/store";
import { workflowDefaultLabels } from "../../workflows/runtime/surface/titles";
import { MEASURED_PROVIDERS, ProviderMeasurements } from "../../providers/measurements/service";
import { app, Notification, powerMonitor, type BrowserWindow } from "electron";
import { AgentPluginInventory } from "../../extensions/agent-plugins/inventory";
import { GLOBAL_PRODUCT_RESOURCE_SCOPE } from "@ai-chat/cloud-protocol/contracts/resources";
import { setAgentBackendDisabled } from "../../agent-process-supervisor";
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../../shared/ipc/agent/agent-ipc";
import { installProviderPluginSettings, PluginCatalog, PluginError } from "../../plugins/catalog";
import { PluginStateStore } from "../../plugins/states";
import { PluginSettingsStore } from "../../plugins/settings-store";
import { pluginHealth } from "../../plugins/health";
import { registerPlugins } from "../../plugins/ipc";
import { workflowRuntime } from "../../workflows/runtime/installed";
import { WorkflowChatRegistry } from "../../workflows/runtime/chats";
import { installWorkflowChatIndex } from "../../chats/projection/chat-summary";
import { turns } from "../../agent/bridge/agent-bridge";
import { agentTurnProcess, forceKillAgentTurn, verifyForceStoppedGroup } from "../../agent/turns/force/force-stop";
import type { AgentTurnCustodyRuntime } from "../../backends/jobs/custody/agent-turn-custody-runtime";
import { awaitsUserResponse } from "../../agent/turns/turn/turn-registry-model";
import type { WorkflowRuntimeInput } from "../../workflows/runtime/composition";
import { createProviderReadiness } from "./provider-readiness";
import { unappliedSettings } from "../../workflows/runtime/turn/effective-config";
import { createProviderAdmission, installProviderRunnablePolicy, onProviderRunnablePolicyChanged, providerRunnable } from "../../extensions/trust/provider-admission";
import { installProviderAdmissionGate, installProviderRevocationCheck } from "../../providers/host/admission";
import { installHostPackageRuntime } from "../../extensions/host/runtime";
import { installForeignPackageRoots } from "../../backends/sandbox/fences";

const shownNotices = new Set<Notification>();
/* The turn events that open or close a wait on the person. */
const INTERACTION_EVENTS = new Set(["approval-requested", "approval-closed", "user-input-requested", "user-input-closed"]);

export type FoundationRuntime = Awaited<ReturnType<typeof composeFoundationRuntime>>;

export async function composeFoundationRuntime(input: Parameters<typeof composeOperations>[0] & Readonly<{
  userData: string;
  mainDirectory: string;
  /** Live (existing, not archived) Project ids and a Provider's Chat defaults, for Agent configurations. */
  agentConfigs: Omit<Parameters<typeof composeAgentConfigs>[0], "userData">;
  leases: BuiltinMcpLeaseStore;
  basesService: BasesService;
  /** The App service's answers for the dependencies host custody journals with a process (App references, extension plans). */
  custodyDependencies: HostCustodyDependencyPorts;
  /** A previous life's agent-turn custody, recovered before the foundation: what it still holds for a cancelled workflow turn's request. */
  turnCustody: Pick<AgentTurnCustodyRuntime, "heldBy">;
  extensions: Pick<AppExtensionIntegration, "attachHosts" | "installer" | "convergence" | "uninstall" | "registry">;
  /** The workflow runtime's host ports: the coordinator that owns turns, Projects, chat defaults per backend and the verified operator (TASK-17). */
  workflows: Pick<WorkflowRuntimeInput, "coordinator" | "projects" | "turnDefaults" | "operator" | "locale" | "providerPreferences">;
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
  announceComposition("foundation", { hosts, operations, leases: input.leases, extensions: input.extensions, hostPackages, bases, providers });
  /* Agent configurations work signed out; cloud composition attaches their sync once the account runtime exists (TASK-12). */
  const measurementStore = new MeasurementStore(input.userData);
  await measurementStore.initialize();
  const measurements = new ProviderMeasurements(measurementStore, { now: () => Date.now(),
    runtime: async providerId => { const snapshot = await backendRuntimeRegistry.resolve(providerId); return snapshot.runtimeStatus === "installed" ? snapshot.runtime : null; },
    knownRuntime: providerId => { const snapshot = backendRuntimeRegistry.current(providerId); return snapshot?.runtimeStatus === "installed" ? snapshot.runtime : null; },
    report: (providerId, detail) => console.info(`[measurements] ${providerId}`, JSON.stringify(detail).slice(0, 600)) });
  /* Stored measurements are adopted whenever the registry learns a runtime; nothing here starts discovery or a probe.
     Probes run on demand only (workflow admission, a re-check). */
  const adopt = (providerId: string) => { if ((MEASURED_PROVIDERS as readonly string[]).includes(providerId)) {
    void measurements.adopt(providerId as (typeof MEASURED_PROVIDERS)[number]).catch(cause => console.warn(`[measurements] ${providerId} failed`, cause instanceof Error ? cause.message : String(cause)));
  } };
  for (const providerId of MEASURED_PROVIDERS) adopt(providerId);
  const releaseRuntimeWatch = backendRuntimeRegistry.subscribe(backend => adopt(backend));
  /* Plugins & Apps (TASK-10, Q29): built-in states are applied before anything can spawn a turned-off Provider. */
  const pluginStates = new PluginStateStore(input.userData);
  await pluginStates.initialize();
  const pluginSettings = new PluginSettingsStore(input.userData);
  let plugins: PluginCatalog | null = null;
  const agentConfigs = await composeAgentConfigs({ userData: input.userData, ...input.agentConfigs, measurements,
    providerEnabled: providerId => plugins?.providerEnabled(providerId) ?? true });
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
    nativePlugins: async () => (await agentPlugins.snapshot(registry.snapshot())).flatMap(view => "plugins" in view ? [view] : []),
    agentConfigs: () => agentConfigs.service.list(), workflowProjects: () => [...new Set((workflowRuntime()?.bindings() ?? [])
      .filter(binding => binding.state === "enabled")
      .flatMap(binding => { const project = input.workflows.projects.get(binding.projectId); return project && !project.archivedAt ? [project.name] : []; }))],
    applyProvider: (providerId, enabled) => {
      if ((AGENT_BACKEND_ORDER as readonly string[]).includes(providerId)) setAgentBackendDisabled(providerId as AgentBackendId, !enabled);
    },
    health: (pluginId, entry) => pluginHealth(entry, { now: Date.now(),
      provider: providerId => (AGENT_BACKEND_ORDER as readonly string[]).includes(providerId) ? backendRuntimeRegistry.current(providerId as AgentBackendId) : null,
      packageRunning: installIdentity => hostPackages.outstanding(installIdentity).length > 0,
      workflow: () => workflowRuntime() ? { running: workflowRuntime()!.ledger.list().filter(run => run.state === "running").length } : null }),
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
  const releasePlugins = plugins.onChanged(() => agentConfigs.service.refreshViews());
  /* Workflows (TASK-17): runs execute here, the computer that holds the Project; admission probes on demand only. The runtime is
     loaded by a dynamic import and composed off the startup path; its IPC waits for it. Its Chat index is not: every Chat list
     leaves workflow Chats out from the first list the window asks for. */
  const workflowChats = new WorkflowChatRegistry(join(input.userData, "workflows"));
  await workflowChats.initialize();
  installWorkflowChatIndex(workflowChats);
  const workflowTurns = {
    waitingChatIds: () => new Set(turns.liveEntries().filter(awaitsUserResponse).map(entry => entry.conversationId)),
    onInteraction: (listener: (chatId: string) => void) => turns.subscribeEvents(event => {
      if (INTERACTION_EVENTS.has(event.type)) listener(event.conversationId);
    }),
    forceKill: (requestId: string) => forceKillAgentTurn(requestId),
    verifyGroup: verifyForceStoppedGroup,
    processOf: async (requestId: string) => agentTurnProcess(requestId, input.turnCustody, hosts.custody),
  };
  const workflowsReady = import("../../workflows/runtime/composition").then(({ composeWorkflowRuntime }) => composeWorkflowRuntime({ ...input.workflows,
    showNotification: (notice, open) => {
      if (!Notification.isSupported()) return;
      /* Held until clicked or closed: a notification the collector takes loses its click. */
      const notification = new Notification({ title: notice.title, body: notice.body });
      shownNotices.add(notification);
      notification.once("click", () => { shownNotices.delete(notification); open(); });
      notification.once("close", () => shownNotices.delete(notification));
      notification.show();
    },
    onWake: listener => { powerMonitor.on("resume", listener); return () => { powerMonitor.off("resume", listener); }; },
    providerReadiness: createProviderReadiness({ enabled: providerId => plugins!.providerEnabled(providerId),
      isAgent: providerId => (AGENT_BACKEND_ORDER as readonly string[]).includes(providerId),
      refresh: providerId => backendRuntimeRegistry.refreshIfNeeded(providerId as AgentBackendId),
      checkScopedAuth: async (providerId, signal) => {
        const snapshot = backendRuntimeRegistry.current(providerId as AgentBackendId);
        return snapshot?.runtimeStatus === "installed"
          ? await backendById(providerId as AgentBackendId).auth?.check(snapshot.runtime, signal) ?? { status: "unknown" }
          : { status: "unknown" };
      },
      info: providerId => {
        const snapshot = backendRuntimeRegistry.current(providerId as AgentBackendId);
        return snapshot ? backendRuntimeRegistry.toBackendInfo(providerId as AgentBackendId, snapshot) : null;
      } }),
    userData: input.userData, chatRegistry: workflowChats, turns: workflowTurns, chats: input.chats, now: () => Date.now(),
    bases: { store: input.bases, service: input.basesService, results: bases.results },
    isBackend: (id): id is AgentBackendId => (AGENT_BACKEND_ORDER as readonly string[]).includes(id),
    validateTurnOptions: (backend, options) => { backendById(backend).validateTurnOptions(options); return options; },
    freezeConfig: (configId, role, projectId) => agentConfigs.service.freeze(configId, role, projectId),
    defaultConfigurations: async (provider, persist, projectId) => agentConfigs.service.workflowDefaults(provider, await workflowDefaultLabels(input.workflows.locale()), persist, projectId),
    /* T21-c: what the Provider's runtime here takes, checked the way a turn's start checks it (capability-validation). */
    unapplied: async (providerId, fields, workspace) => {
      const backendId = knownBackend(builtinProviderCatalog, providerId);
      if (!backendId) return [];
      const snapshot = backendRuntimeRegistry.current(backendId), backend = backendById(backendId);
      if (snapshot?.runtimeStatus !== "installed") return [];
      const models = snapshot.capabilities.modelOptions === "list-only" && backend.models
        ? (await backend.models.list(snapshot.runtime, workspace ?? homedir()).catch(() => null))?.map(entry => entry.slug) ?? null : null;
      return unappliedSettings(fields, { permissionModes: snapshot.capabilities.permissionModes, models });
    },
    reportApply: (frozen, settings) => agentConfigs.service.reportApply(frozen, settings),
    measurements: async providerId => {
      if ((MEASURED_PROVIDERS as readonly string[]).includes(providerId)) await measurements.ensure(providerId as (typeof MEASURED_PROVIDERS)[number]).catch(() => undefined);
      return measurements.current(providerId);
    },
    workflowEnabled: () => plugins!.workflowEnabled(), workflowBlockedBy: () => plugins!.workflowBlockedBy() }));
  const releaseWorkflowCatalog = workflowsReady.then(workflows => {
    void plugins!.refresh();
    return workflows.onChanged(event => { if (event.bindingId || !event.runId) void plugins!.refresh(); });
  }).catch(() => () => {});
  workflowsReady.catch((cause) => console.warn("[workflows] runtime failed to start", cause));
  /* Q29: a Provider turned off pauses each run with a step of it still ahead, after the current step. */
  const releasePluginRuns = plugins.onChanged(() => { void workflowsReady.then(workflows => {
    for (const { id: providerId } of builtinProviderCatalog.entries()) if (!plugins!.providerEnabled(providerId)) void workflows.pauseForProvider(providerId);
    if (!plugins!.workflowEnabled()) void workflows.pauseForWorkflowPlugin();
  }).catch(() => undefined); });
  const impact = { now: () => Date.now(), agentConfigs: () => agentConfigs.service.list(), bindings: () => workflowRuntime()?.bindings() ?? [],
    bindingName: (binding: { recipe: { recipeId: string } }) => binding.recipe.recipeId, runs: () => workflowRuntime()?.ledger.list() ?? [], chats: () => input.chats.list() };
  return {
    operations, hosts, hostPackages, bases, agentConfigs, measurements, plugins, workflows: workflowsReady,
    /** Main-window registrar for the foundation's renderer bridges: Agent configurations and Plugins & Apps. */
    registrar: { register: (window: BrowserWindow, rendererUrl: string) => { agentConfigs.registrar.register(window, rendererUrl); registerPlugins(plugins!, impact, window, rendererUrl); registerProviderCatalog(catalog, window, rendererUrl);
      void import("../../workflows/runtime/surface/ipc").then(({ registerWorkflows }) => registerWorkflows(workflowsReady, window, rendererUrl)); } },
    /** Revokes every capability ref: nothing out of process may act for anyone once admission stops. */
    stopAdmission: () => { plugins.stopAdmission(); hostPackages.stopAdmission(); operations.close(); },
    close: async () => { releaseRuntimeWatch(); releasePackageFacts(); measurements.close(); await plugins.close(); await hostPackages.close(); await hosts.close(); await bases.close(); releasePlugins(); releasePluginRuns(); (await releaseWorkflowCatalog)(); await (await workflowsReady.catch(() => null))?.close(); installWorkflowChatIndex(null); installProviderPluginSettings(null); await workflowChats.closeAndFlush(); await agentConfigs.close(); await measurementStore.closeAndFlush(); await pluginStates.closeAndFlush(); await pluginSettings.closeAndFlush(); },
  };
}
