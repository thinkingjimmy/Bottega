/**
 * [INPUT]: Depends on the explicit runtime storage mode and Apps store/gateway/runtime/installer, the durable generation/reference/data/custody ledgers, the compiled Base GUI runtime, the Design integration, and the turn/delete/edit sub-domains
 * [OUTPUT]: Assembles App collaborators and injects passive cached inventory into ordinary capability reads. U06-d: the ExtensionConsentBroker the installer asks (instead of a bare dialog) and the AppBuildTracker, which also hears the installer's compatibility blocks. Injects the shared availability check into gateway and App turn admission.
 * [POS]: The apps composition factory; AppsService owns policy and lifecycle while the object graph is assembled here
 */

import { isAppEnabled } from "./availability/guard";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type {
  AppInstallEvent,
  AppRecord,
  AppRecordProjection,
} from "../../../../shared/ipc/apps/apps-ipc";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { resolvePlatformCapabilities } from "../../../../shared/platform/platform-capabilities";
import { DESIGN_PRESET_ID } from "../../design/enabled";
import type { AppExtensionIntegration } from "../../extensions/integration/app-extension-composition";
import { ThirdPartyMcpPlanLedger } from "../../extensions/lifecycle/mcp/third-party-mcp-plan-ledger";
import type { AppGenerationBuildParticipantRegistry } from "../../lifecycle/generation/build-participants";
import { AppPlatformAdmission } from "../../lifecycle/app-platform-admission";
import { AppDataArchiveStore } from "../server/app-data-archive";
import { AppDataCutoverLedger } from "../server/app-data-cutover-ledger";
import { AppDataMigrations } from "../maintenance/app-data-migrations";
import { AppGateway } from "../gateway/app-gateway";
import { AppGenerationBuildLedger } from "../generation/app-generation-build-ledger";
import { AppInstaller } from "../source/app-installer";
import { AppInstructionContributorRegistry } from "../turn/app-instruction-contributors";
import { AppReferenceJournal } from "../turn/app-reference-journal";
import { AppRuntime } from "../server/app-runtime";
import { AppServerDataCutover } from "../server/app-server-cutover";
import { AppMutationCoordinator } from "../source/app-source-coordinator";
import { AppStore } from "../store/app-store";
import type { AppGrantAuthority } from "../attachments/grant-authority";
import type { AppAttachmentSurfaceLeaseRegistry } from "../attachments/surface-leases";
import { BaseGuiGrantStore } from "../base-gui/grant-store";
import { createAppGuiBuildService } from "../gui-build/composition";
import { MaintenanceGate } from "../maintenance/maintenance-gate";
import { AppProcessCustodyJournal } from "../server/process-custody-journal";
import { AppServerCustodyRuntime } from "../runtime/server-custody";
import type { AgentToolInventory } from "../runtime/agent-tools";
import { composeServerLifecycle } from "../server/server-lifecycle";
import { AppPackageController } from "../share/app-package-controller";
import { AppAgentOperations } from "./agent-operations";
import { AppDeleteCoordinator } from "./delete-coordinator";
import { AppGuiRuntimeService } from "./gui-runtime-service";
import { AppDesignIntegration } from "./integrations/design-integration";
import { AppEditTurnLifecycle } from "./lifecycle/edit-turn-lifecycle";
import { AppTurnCoordinator } from "./turn-coordinator";
import type { CustodyRuntimeOptions } from "../../custody/attachment";
import { randomUUID } from "node:crypto";
import { ExtensionConsentBroker, type DeclinedNotice } from "./consent/broker";
import { AppBuildTracker } from "./consent/build-status";
import { nativeConsentPorts } from "./consent/dialog";

/** 迟绑定的协作者只有一处「还没配好」的判词，两边共用同一句话。 */
export function requireConfigured<T>(value: T | null, what: string): T {
  if (!value) throw new Error(`${what} 尚未初始化`);
  return value;
}

/**
 * 组合期拿不到、但运行期必然存在的那几件事。全是惰性取值——对象图在构造完
 * 之前不会去读它们，构造完之后 AppsService 才把真身配上来。
 */
type AppsRuntimeHost = Readonly<{
  emit(event: AppInstallEvent): void;
  projectRecord(record: AppRecord): AppRecordProjection;
  reportGatewayWarning(message: string): void;
  window(): BrowserWindow | null;
  locale(): AppLocale;
  invalidateSkills(): void;
  grantAuthority(): AppGrantAuthority | null;
  surfaceLeases(): AppAttachmentSurfaceLeaseRegistry | null;
  extensions(): AppExtensionIntegration | null;
  buildParticipants(): AppGenerationBuildParticipantRegistry | null;
  chatAppId(conversationId: string): string | undefined;
  editAppId(conversationId: string): string | undefined;
  chatRole(conversationId: string): "edit" | "use" | undefined;
  /** U06-d: writes the Edit Chat's notice for an extension declined from another device or by the time limit. */
  extensionDeclined(notice: DeclinedNotice): Promise<void>;
}>;

type ComposeAppsRuntimeInput = Readonly<{
  /** The selected folder. Null only before the first selection, where the catalog reads as empty. */
  libraryRoot: () => string | null;
  userData: string;
  storageMode?: import("../../../../shared/local-storage/contracts").RuntimeStorageMode;
  guardian: CustodyRuntimeOptions["guardian"];
  inspectCapabilityInventory?: (
    appId: string
  ) => Promise<AgentToolInventory | null>;
  host: AppsRuntimeHost;
}>;

/**
 * 一次装配，不留转手层：所有边都在这里连好，返回的就是协作者本身。
 * AppsService 只负责「什么时候 initialize、什么时候 shutdown、谁有资格调用」。
 */
export function composeAppsRuntime(input: ComposeAppsRuntimeInput) {
  const { userData, host } = input;
  const emit = host.emit;
  const requireGrantAuthority = () =>
    requireConfigured(host.grantAuthority(), "App grant authority");
  const requireSurfaceLeases = () =>
    requireConfigured(host.surfaceLeases(), "App surface leases");

  const store = new AppStore(userData, undefined, input.storageMode, input.libraryRoot);
  store.configureLocale(() => host.locale());
  store.configureAppGuiCompiler(createAppGuiBuildService(userData));
  /* 唯一的 status 发源地：AppStore 每提交一条记录就在这里转成 renderer 事件。
     IPC、工厂 provisioning、installer、runtime、启动自愈走的是同一个闸口，
     没有哪条写入路径需要（也没有资格）自己记得补一条广播。 */
  store.watch((record) =>
    emit({ appId: record.id, type: "status", record: host.projectRecord(record) })
  );
  const baseGuiGrants = new BaseGuiGrantStore(userData);
  store.configureBaseGuiGrants(baseGuiGrants);

  const admission = new AppPlatformAdmission();
  const instructionContributors = new AppInstructionContributorRegistry();
  const maintenanceGate = new MaintenanceGate();
  const sourceMutations = new AppMutationCoordinator();

  const buildLedger = new AppGenerationBuildLedger(userData);
  const referenceJournal = new AppReferenceJournal(userData);
  const thirdPartyMcpPlans = new ThirdPartyMcpPlanLedger(userData);
  const dataCutovers = new AppDataCutoverLedger(userData);
  const dataArchives = new AppDataArchiveStore(userData);
  const serverCutover = new AppServerDataCutover(userData, dataCutovers);
  store.configureGenerationLifecycle(buildLedger, serverCutover);
  const packages = new AppPackageController(userData);
  const processCustody = new AppProcessCustodyJournal(userData);
  const serverCustody = new AppServerCustodyRuntime(processCustody, {
    controlRoot: join(userData, "app-custody"),
    guardian: input.guardian,
  });

  const gateway = new AppGateway(userData, (message) => {
    host.reportGatewayWarning(message);
  });
  const guiRuntime = new AppGuiRuntimeService(
    userData,
    store,
    gateway,
    baseGuiGrants,
    admission.app,
    () => host.window(),
    (appId) => emit({ appId, type: "gui" })
  );
  /* 每一次网关请求都会走这条闭包；读的是不克隆的路由事实，别把整条记录深拷。 */
  gateway.configureAvailability(appId => isAppEnabled(store.get(appId)));
  gateway.configureGenerationResolver((appId, binding) => {
    const facts = store.routingFacts(appId);
    if (!facts?.activeGenerationId) return false;
    if (facts.activeGenerationId === binding.generationId) {
      return facts.lifecycleRevision === binding.lifecycleRevision;
    }
    if (guiRuntime.isRoutableStagingBinding(appId, binding)) return true;
    return (
      binding.lifecycleRevision < facts.lifecycleRevision &&
      facts.draining.has(binding.generationId) &&
      facts.generationIds.has(binding.generationId)
    );
  });

  const designIntegration = new AppDesignIntegration(
    userData,
    store,
    baseGuiGrants,
    {
      surfaceLeases: requireSurfaceLeases,
      grantAuthority: requireGrantAuthority,
      configureWorkspacePreview: (port) =>
        guiRuntime.configureWorkspacePreview(port),
      emit,
      invalidateSkills: () => host.invalidateSkills(),
      factoryDescriptor: () => {
        const preset = packages.presets.require(DESIGN_PRESET_ID);
        if (!preset.factoryTreeDigest) {
          throw new Error("Design factory catalog 缺少 treeDigest");
        }
        return {
          presetId: DESIGN_PRESET_ID,
          repoUrl: preset.canonicalRepoUrl,
          catalogPin: preset.catalogPin,
          treeDigest: preset.factoryTreeDigest,
        };
      },
    }
  );
  store.configureGenerationCutover((appId, operation) =>
    guiRuntime.cutover(appId, operation)
  );

  const dataMigrations = new AppDataMigrations(store);
  const syncBaseGuiRoute = (appId: string) =>
    guiRuntime.sync(appId, () => dataMigrations.reconcile(appId));

  const runtime: AppRuntime = new AppRuntime(
    userData,
    store,
    gateway,
    maintenanceGate,
    emit,
    (appId, line) => agentOperations.appendLog(appId, line),
    (appId, requirements) => packages.configs.environment(appId, requirements),
    serverCustody,
    (appId, dataEpochId) => serverCutover.epochRoot(appId, dataEpochId),
    resolvePlatformCapabilities(process.platform).capabilities.serverApps
  );
  const stopApp = async (appId: string): Promise<void> => {
    await runtime.stop(appId);
    await guiRuntime.revoke(appId);
  };
  const agentOperations: AppAgentOperations = new AppAgentOperations({
    userData,
    store,
    installer: () => installer,
    packages,
    maintenanceGate,
    inspectCapabilityInventory:
      input.inspectCapabilityInventory ??
      (async (appId) => runtime.cachedToolInventory(appId)),
    stop: stopApp,
    emit,
  });

  const serverLifecycle = composeServerLifecycle({
    custody: serverCustody,
    cutover: serverCutover,
    lifecycleGate: admission.app,
    gatewayRequests: gateway.requestLeases,
    revokeRoute: (appId) => gateway.unregister(appId),
    stopRuntime: (appId) => runtime.stop(appId),
    unsettledCustody: (appId) => processCustody.listUnsettled(appId).length,
    activeServerBinding: (appId) => {
      const active = store.get(appId)?.generationBinding.active;
      return active?.runtime.kind === "server"
        ? {
            generationId: active.generationId,
            dataEpochId: active.runtime.dataEpochId,
          }
        : null;
    },
  });
  serverCutover.configure(serverLifecycle.environment);

  /* U06-d: one settlement point for the extension decision (dialog, remote decline, 30-minute bound) and one build-status projection. */
  let buildTracker: AppBuildTracker | null = null;
  const consent = new ExtensionConsentBroker({
    ...nativeConsentPorts({ window: () => host.window(), locale: () => host.locale() }),
    now: () => Date.now(),
    timer: (ms, fire) => { const timer = setTimeout(fire, ms); timer.unref?.(); return () => clearTimeout(timer); },
    changed: (appId) => buildTracker?.consentChanged(appId),
    declined: (notice) => host.extensionDeclined(notice),
    requestId: () => randomUUID(),
  });
  buildTracker = new AppBuildTracker({ list: () => store.list(), watch: (listener) => store.watch(listener), consent,
    now: () => Date.now(), attemptId: () => randomUUID() });

  const installer: AppInstaller = new AppInstaller(
    userData,
    store,
    runtime,
    emit,
    (appId, line) => agentOperations.appendLog(appId, line),
    (record, details) => consent.request(record, details),
    maintenanceGate,
    (appId) => agentOperations.readLogTail(appId),
    sourceMutations
  );

  packages.configureCompatibilityUpdates(installer);
  installer.configureCompatibilityReporter((failure) => {
    if (failure.candidate.appId) buildTracker.compatibilityBlocked(failure.candidate.appId);
    return packages.compatibility.remember(failure);
  });

  const turnCoordinator = new AppTurnCoordinator({
    userData,
    store,
    lifecycleGate: admission.app,
    usageRegistry: admission.usage,
    referenceJournal,
    thirdPartyMcpPlans,
    instructionContributors,
    grantAuthority: requireGrantAuthority,
    extensions: () => host.extensions(),
    sourceMutations,
    chatAppId: (conversationId) => host.chatAppId(conversationId),
    editAppId: (conversationId) => host.editAppId(conversationId),
    reconcileEditSource: (appId) => installer.reconcileSourceHeld(appId),
    emit,
  });

  const deleteCoordinator = new AppDeleteCoordinator({
    userData,
    store,
    installer,
    runtime,
    lifecycleGate: admission.app,
    usageRegistry: admission.usage,
    gatewayRequestLeases: gateway.requestLeases,
    buildLedger,
    referenceJournal,
    processCustody,
    dataCutovers,
    dataArchives,
    serverCutover,
    surfaceLeases: () => host.surfaceLeases(),
    grantAuthority: () => host.grantAuthority(),
    extensions: () => host.extensions(),
    buildParticipants: () => host.buildParticipants(),
    stop: stopApp,
    closeGuiSideEffects: (appId) => guiRuntime.closeAppSideEffects(appId),
    deletePreferences: (appId) => guiRuntime.deletePreferences(appId),
  });

  const editTurnLifecycle = new AppEditTurnLifecycle({
    store,
    installer,
    maintenanceGate,
    chatRole: (conversationId) => host.chatRole(conversationId),
    syncGui: syncBaseGuiRoute,
    emit,
    invalidateSkills: () => host.invalidateSkills(),
    settleSourceMutation: (requestId, task) =>
      turnCoordinator.settleSourceMutation(requestId, task),
  });

  return {
    admission,
    agentOperations,
    baseGuiGrants,
    buildLedger,
    buildTracker,
    consent,
    dataArchives,
    dataCutovers,
    dataMigrations,
    deleteCoordinator,
    designIntegration,
    editTurnLifecycle,
    gateway,
    guiRuntime,
    installer,
    instructionContributors,
    maintenanceGate,
    packages,
    processCustody,
    referenceJournal,
    runtime,
    serverCustody,
    serverCutover,
    serverLifecycle,
    sourceMutations,
    stopApp,
    store,
    syncBaseGuiRoute,
    thirdPartyMcpPlans,
    turnCoordinator,
  };
}
