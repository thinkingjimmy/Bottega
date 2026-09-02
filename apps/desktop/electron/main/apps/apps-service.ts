/**
 * [INPUT]: Depends on the Apps store/runtime/installer, shared per-App source/lifecycle mutation lanes, generation/reference/data/custody durable ledgers, compiled Base GUI runtime, Design domain, App×Extension integration, navigation, and service sub-modules
 * [OUTPUT]: Provides authority-gated AppsService startup, source-fenced Edit turns, Use/Edit navigation, compiled GUI cohort cutover, signed-update compatibility, Studio authorization, file export, renderer cleanup, convergent deletion, Design integration, and one durable status forwarder
 * [POS]: The composition root of the apps module; it owns shared mutation lanes while delegating GUI, navigation, Design, install, turn, delete, and agent workflows to focused domains
 */

import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  AppCapabilitiesSnapshot,
  AppExtensionStatus,
  AppGuiInfo,
  AppGuiInfoInput,
  AppGuiReadyInput,
  AppInstallEvent,
  AppRecord,
  AppRecordProjection,
  RemoveAppMode,
} from "../../../shared/apps-ipc";
import type { BaseToolsAvailability } from "../../../shared/builtin-tools";
import type { ExtensionTurnIdentity } from "../../../shared/extensions-ipc";
import type { TurnProjectContext } from "../../../shared/product-resource-scope";
import type { AppLocale } from "../../../shared/i18n/locale";
import type { TrustedRendererContext } from "../window/surfaces/trusted-renderer-context";
import type { AppExtensionIntegration } from "../extensions/integration/app-extension-composition";
import { ThirdPartyMcpPlanLedger } from "../extensions/lifecycle/third-party-mcp-plan-ledger";
import type { AppGenerationBuildParticipantRegistry } from "../lifecycle/app-generation-build-participants";
import type { AppNavigationService } from "./app-navigation";
import { AppPlatformAdmission } from "../lifecycle/app-platform-admission";
import type { AppChatSlots } from "./app-chat-slots";
import { AppDataArchiveStore } from "./app-data-archive";
import { AppDataCutoverLedger } from "./app-data-cutover-ledger";
import {
  AppDataMigrations,
  type AppDataMigrationPort,
} from "./app-data-migrations";
import type { AppDeleteService } from "./app-delete";
import { AppGenerationBuildLedger } from "./app-generation-build-ledger";
import { AppGateway } from "./app-gateway";
import { AppInstaller } from "./app-installer";
import { AppInstructionContributorRegistry } from "./app-instruction-contributors";
import { BaseAppRenamer } from "./app-rename";
import { AppReferenceJournal } from "./app-reference-journal";
import { AppRuntime } from "./app-runtime";
import { AppServerDataCutover } from "./app-server-cutover";
import { AppStore } from "./app-store";
import { AppMutationCoordinator } from "./app-source-coordinator";
import type { AppAttachmentFence } from "./attachments/attachment-fence";
import {
  studioSurfaceReady,
  type AppGrantAuthority,
} from "./attachments/grant-authority";
import type { AppManagementLeaseRegistry } from "./attachments/management-leases";
import type { AppAttachmentSurfaceLeaseRegistry } from "./attachments/surface-leases";
import type { GuiBasePort } from "./gui-api";
import type { WorkspacePreviewPort } from "./base-gui/workspace-preview";
import { BaseGuiGrantStore } from "./base-gui/grant-store";
import type { BaseAppImporter } from "./install/import-base-app";
import { MaintenanceGate } from "./maintenance-gate";
import { AppProcessCustodyJournal } from "./process-custody-journal";
import { AppServerCustodyRuntime } from "./runtime/server-custody";
import type { AgentToolInventory } from "./runtime/agent-tools";
import type { SaveAsAppService } from "./save-as-app";
import { composeServerLifecycle } from "./server-lifecycle";
import { AppAgentOperations } from "./service/agent-operations";
import { publishAppEvent } from "./service/app-event-publisher";
import { AppDeleteCoordinator } from "./service/delete-coordinator";
import { AppDesignIntegration } from "./service/integrations/design-integration";
import { AppEditTurnLifecycle } from "./service/lifecycle/edit-turn-lifecycle";
import { applyCandidateCompatibility } from "./service/lifecycle/update-compatibility";
import { registerAppsIpc } from "./service/ipc";
import { resolveBindableApp, resolveRunnableApp } from "./service/lifecycle/app-resolution";
import {
  authorizeStudioAccess,
  declineStudioAccess,
  originWithoutStart,
  rebuildExtensionGeneration,
  removeApp,
  revokeExtensionGrant,
  runtimeStatus,
} from "./service/lifecycle/runtime-operations";
import { AppGuiRuntimeService } from "./service/gui-runtime-service";
import { AppTurnCoordinator } from "./service/turn-coordinator";
import { AppPackageController } from "./share/app-package-controller";
import type { ShareFlow } from "./share/share-flow";
import { projectAppExtensionStatus } from "./app-extension-status";
import { resolvePlatformCapabilities } from "../../../shared/platform-capabilities";
import type { EffectiveWorkspaceResolver } from "../workspace-resolver";
import { DESIGN_PRESET_ID } from "../design/enabled";
import type { DesignProjectRebindEvidence } from "../design/service";
import { createAppGuiBuildService } from "./gui-build/composition";
function defaultGuardianArgs() {
  if (typeof __dirname !== "string") return [] as const;
  return [join(__dirname, "custody-guardian-entry.js")] as const;
}

export { appTurnCompletionAction } from "./service/turn-action";

export class AppsService {
  readonly store: AppStore;
  readonly processCustody: AppProcessCustodyJournal;
  readonly serverCustody: AppServerCustodyRuntime;
  readonly serverCutover: AppServerDataCutover;
  readonly buildLedger: AppGenerationBuildLedger;
  readonly referenceJournal: AppReferenceJournal;
  readonly dataCutovers: AppDataCutoverLedger;
  readonly dataArchives: AppDataArchiveStore;
  readonly admission = new AppPlatformAdmission();
  readonly instructionContributors = new AppInstructionContributorRegistry();
  readonly thirdPartyMcpPlans: ThirdPartyMcpPlanLedger;
  readonly baseGuiGrants: BaseGuiGrantStore;
  readonly design: AppDesignIntegration["service"];

  private readonly gateway: AppGateway;
  private readonly runtime!: AppRuntime;
  private readonly installer!: AppInstaller;
  private readonly maintenanceGate = new MaintenanceGate();
  private readonly sourceMutations = new AppMutationCoordinator();
  private readonly lifecycleMutations = new AppMutationCoordinator();
  private readonly guiRuntime: AppGuiRuntimeService;
  private readonly dataMigrations: AppDataMigrations;
  private readonly packages: AppPackageController;
  private readonly serverLifecycle: ReturnType<typeof composeServerLifecycle>;
  private readonly agentOperations: AppAgentOperations;
  private readonly turnCoordinator: AppTurnCoordinator;
  private readonly deleteCoordinator: AppDeleteCoordinator;
  private readonly designIntegration: AppDesignIntegration;
  private readonly editTurnLifecycle: AppEditTurnLifecycle;

  private window: BrowserWindow | null = null;
  private gatewayWarning: string | null = null;
  private saveAsAppService: SaveAsAppService | null = null;
  private appDeleteService: AppDeleteService | null = null;
  private renamer: BaseAppRenamer | null = null;
  private invalidateSkills: (() => void) | null = null;
  private chatSlots: AppChatSlots | null = null;
  private grantAuthority: AppGrantAuthority | null = null;
  private attachmentFence: AppAttachmentFence | null = null;
  private surfaceLeases: AppAttachmentSurfaceLeaseRegistry | null = null;
  private managementLeases: AppManagementLeaseRegistry | null = null;
  private extensions: AppExtensionIntegration | null = null;
  private buildParticipants: AppGenerationBuildParticipantRegistry | null = null;
  private navigationService: AppNavigationService | null = null;
  private locale: () => AppLocale = () => "en";

  get lifecycleGate() {
    return this.admission.app;
  }
  get usageRegistry() {
    return this.admission.usage;
  }
  get gatewayRequestLeases() {
    return this.gateway.requestLeases;
  }
  get attachments() {
    return this.attachmentFence;
  }
  get configs() {
    return this.packages.configs;
  }
  constructor(
    readonly userData: string,
    guardianArgs: readonly string[] = defaultGuardianArgs(),
    inspectCapabilityInventory?: (
      appId: string
    ) => Promise<AgentToolInventory | null>
  ) {
    this.store = new AppStore(userData);
    this.store.configureAppGuiCompiler(createAppGuiBuildService(userData));
    /* 唯一的 status 发源地：AppStore 每提交一条记录就在这里转成 renderer 事件。
       IPC、工厂 provisioning、installer、runtime、启动自愈走的是同一个闸口，
       没有哪条写入路径需要（也没有资格）自己记得补一条广播。 */
    this.store.watch((record) =>
      this.emit({
        appId: record.id,
        type: "status",
        record: this.projectRecord(record),
      })
    );
    this.baseGuiGrants = new BaseGuiGrantStore(userData);
    this.store.configureBaseGuiGrants(this.baseGuiGrants);
    this.buildLedger = new AppGenerationBuildLedger(userData);
    this.referenceJournal = new AppReferenceJournal(userData);
    this.thirdPartyMcpPlans = new ThirdPartyMcpPlanLedger(userData);
    this.dataCutovers = new AppDataCutoverLedger(userData);
    this.dataArchives = new AppDataArchiveStore(userData);
    this.serverCutover = new AppServerDataCutover(userData, this.dataCutovers);
    this.store.configureGenerationLifecycle(this.buildLedger, this.serverCutover);
    this.packages = new AppPackageController(userData);
    this.processCustody = new AppProcessCustodyJournal(userData);
    this.serverCustody = new AppServerCustodyRuntime(this.processCustody, {
      controlRoot: join(userData, "app-custody"),
      guardianArgs,
    });
    this.gateway = new AppGateway(userData, (message) => {
      this.gatewayWarning = message;
      this.emit({ type: "runtime-warning", message });
    });
    this.gateway.configureGenerationResolver((appId, binding) => {
      const record = this.store.get(appId);
      const active = record?.generationBinding.active;
      if (!record || !active) return false;
      if (active.generationId === binding.generationId) {
        return record.lifecycleRevision === binding.lifecycleRevision;
      }
      if (this.guiRuntime.isRoutableStagingBinding(appId, binding)) return true;
      return (
        binding.lifecycleRevision < record.lifecycleRevision &&
        record.generationBinding.drainingGenerationIds.includes(
          binding.generationId
        ) &&
        record.generations.some(
          (generation) => generation.generationId === binding.generationId
        )
      );
    });
    this.guiRuntime = new AppGuiRuntimeService(
      userData,
      this.store,
      this.gateway,
      this.baseGuiGrants,
      this.lifecycleGate,
      () => this.window,
      (appId) => this.emit({ appId, type: "gui" })
    );
    this.designIntegration = new AppDesignIntegration(
      userData,
      this.store,
      this.baseGuiGrants,
      {
        surfaceLeases: () => this.requireSurfaceLeases(),
        grantAuthority: () => this.requireGrantAuthority(),
        configureWorkspacePreview: (port) => this.configureWorkspacePreview(port),
        emit: (event) => this.emit(event),
        invalidateSkills: () => this.invalidateSkills?.(),
        factoryDescriptor: () => {
          const preset = this.packages.presets.require(DESIGN_PRESET_ID);
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
    this.design = this.designIntegration.service;
    this.store.configureGenerationCutover((appId, operation) =>
      this.guiRuntime.cutover(appId, operation)
    );
    this.dataMigrations = new AppDataMigrations(this.store);
    this.agentOperations = new AppAgentOperations({
      userData,
      store: this.store,
      installer: () => this.installer,
      packages: this.packages,
      maintenanceGate: this.maintenanceGate,
      inspectCapabilityInventory:
        inspectCapabilityInventory ??
        ((appId) => this.runtime.inspectToolInventory(appId)),
      stop: (appId) => this.stopApp(appId),
      emit: (event) => this.emit(event),
      window: () => this.window,
      locale: () => this.locale(),
    });
    this.runtime = new AppRuntime(
      userData,
      this.store,
      this.gateway,
      this.maintenanceGate,
      (event) => this.emit(event),
      (appId, line) => this.agentOperations.appendLog(appId, line),
      (appId, requirements) =>
        this.packages.configs.environment(appId, requirements),
      this.serverCustody,
      (appId, dataEpochId) => this.serverCutover.epochRoot(appId, dataEpochId),
      resolvePlatformCapabilities(process.platform).capabilities.serverApps
    );
    this.serverLifecycle = composeServerLifecycle({
      custody: this.serverCustody,
      cutover: this.serverCutover,
      lifecycleGate: this.lifecycleGate,
      gatewayRequests: this.gateway.requestLeases,
      revokeRoute: (appId) => this.gateway.unregister(appId),
      stopRuntime: (appId) => this.runtime.stop(appId),
      unsettledCustody: (appId) =>
        this.processCustody.listUnsettled(appId).length,
      activeServerBinding: (appId) => {
        const active = this.store.get(appId)?.generationBinding.active;
        return active?.runtime.kind === "server"
          ? {
              generationId: active.generationId,
              dataEpochId: active.runtime.dataEpochId,
            }
          : null;
      },
      appDir: (appId) => this.store.get(appId)?.dir ?? null,
    });
    this.serverCutover.configure(this.serverLifecycle.environment);
    this.installer = new AppInstaller(
      userData,
      this.store,
      this.runtime,
      (event) => this.emit(event),
      (appId, line) => this.agentOperations.appendLog(appId, line),
      (record, details) =>
        this.agentOperations.confirmExtensions(record, details),
      this.maintenanceGate,
      (appId) => this.agentOperations.readLogTail(appId),
      this.sourceMutations
    );
    this.turnCoordinator = new AppTurnCoordinator({
      userData,
      store: this.store,
      lifecycleGate: this.lifecycleGate,
      usageRegistry: this.usageRegistry,
      referenceJournal: this.referenceJournal,
      thirdPartyMcpPlans: this.thirdPartyMcpPlans,
      instructionContributors: this.instructionContributors,
      grantAuthority: () => this.requireGrantAuthority(),
      extensions: () => this.extensions,
      sourceMutations: this.sourceMutations,
      editAppId: (conversationId) => this.chatSlots?.editAppIdOf(conversationId),
      reconcileEditSource: (appId) => this.installer.reconcileSourceHeld(appId),
      emit: (event) => this.emit(event),
    });
    this.deleteCoordinator = new AppDeleteCoordinator({
      userData,
      store: this.store,
      installer: this.installer,
      runtime: this.runtime,
      lifecycleGate: this.lifecycleGate,
      usageRegistry: this.usageRegistry,
      gatewayRequestLeases: this.gateway.requestLeases,
      buildLedger: this.buildLedger,
      referenceJournal: this.referenceJournal,
      processCustody: this.processCustody,
      dataCutovers: this.dataCutovers,
      dataArchives: this.dataArchives,
      serverCutover: this.serverCutover,
      surfaceLeases: () => this.surfaceLeases,
      managementLeases: () => this.managementLeases,
      grantAuthority: () => this.grantAuthority,
      extensions: () => this.extensions,
      buildParticipants: () => this.buildParticipants,
      stop: (appId) => this.stopApp(appId),
      closeGuiSideEffects: (appId) => this.guiRuntime.closeAppSideEffects(appId),
      deletePreferences: (appId) => this.guiRuntime.deletePreferences(appId),
    });
    this.editTurnLifecycle = new AppEditTurnLifecycle({
      store: this.store,
      installer: this.installer,
      maintenanceGate: this.maintenanceGate,
      chatRole: (conversationId) => this.chatSlots?.roleOf(conversationId) ?? undefined,
      syncGui: (appId) => this.syncBaseGuiRoute(appId),
      emit: (event) => this.emit(event),
      invalidateSkills: () => this.invalidateSkills?.(),
      settleSourceMutation: (requestId, task) =>
        this.turnCoordinator.settleSourceMutation(requestId, task),
    });
  }

  configureLocale(locale: () => AppLocale) { this.locale = locale; }
  async initialize() {
    if ((await this.store.inspectAuthority()) === "degraded-corrupt") return "degraded-corrupt";
    await Promise.all([
      this.buildLedger.initialize(),
      this.referenceJournal.initialize(),
      this.thirdPartyMcpPlans.initialize(),
      this.dataCutovers.initialize(),
      this.dataArchives.initialize(),
      this.baseGuiGrants.initialize(),
      this.store.initializeAppGuiCompiler(),
      this.designIntegration.initialize(),
      this.guiRuntime.initialize(),
    ]);
    await this.serverCustody.initialize();
    await this.store.load();
    if (this.store.authorityState() === "degraded-corrupt") return "degraded-corrupt";
    await this.guiRuntime.recoverCutovers();
    await this.serverLifecycle.reconcile();
    await this.gateway.start();
    await this.installer.initialize();
    await this.store.normalizeStartupStates();
    return this.store.authorityState();
  }
  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    registerAppsIpc(window, rendererUrl, {
      store: this.store,
      runtime: this.runtime,
      installer: this.installer,
      packages: this.packages,
      lifecycleGate: this.lifecycleGate,
      gatewayWarning: () => this.gatewayWarning,
      grantAuthority: () => this.requireGrantAuthority(),
      surfaceLeases: () => this.requireSurfaceLeases(),
      managementLeases: () => this.requireManagementLeases(),
      saveAsApp: () => this.saveAsAppService,
      appDelete: () => this.appDeleteService,
      emit: (event) => this.emit(event),
      requireRecord: (appId) => this.requireRecord(appId),
      stop: (appId) => this.stopApp(appId),
      runtimeStatus: (appId) => runtimeStatus(this.store, this.runtime, appId),
      originWithoutStart: (appId) =>
        originWithoutStart(this.store, this.runtime, appId),
      extensionStatus: (appId) => this.extensionStatus(appId),
      capabilities: (appId) => this.capabilities(appId),
      authorizeStudioAccess: (appId) =>
        this.runAppLifecycleMutation(appId, () => this.authorizeStudioAccess(appId)),
      declineStudioAccess: (appId) =>
        this.runAppLifecycleMutation(appId, () =>
          declineStudioAccess({ appId, store: this.store })
        ),
      revokeStudioAccess: (appId) =>
        this.runAppLifecycleMutation(appId, () =>
          this.withGuiCutover(appId, () => this.store.revokeStudioAccess(appId))
        ),
      studioSurfaceReady: (record) =>
        this.projectRecord(record).studioSurfaceReady === true,
      revokeExtensionGrant: async (appId) => {
        await revokeExtensionGrant(this.store, this.extensions, appId);
        return this.extensionStatus(appId);
      },
      rebuildExtensionGeneration: (appId) =>
        rebuildExtensionGeneration(this.store, appId),
      remove: (appId, mode, requestId) => this.remove(appId, mode, requestId),
      readLogTail: (appId) => this.agentOperations.readLogTail(appId),
      setAgent: (input) => this.agentOperations.setAgent(input),
      rename: (input) => {
        if (!this.renamer) throw new Error("Base App 改名尚未初始化");
        return this.renamer.rename(input);
      },
      ensureChatSlot: (input) => {
        if (!this.chatSlots) throw new Error("App chat slots 尚未初始化");
        return this.chatSlots.ensure(input);
      },
      listUseHistory: (input) => this.requireNavigation().listAppUseHistory(input),
      openUseChat: (input) => this.requireNavigation().openAppUseChat(input),
      newUseChat: (appId, requestId) =>
        this.requireNavigation().newAppUseChat(appId, requestId),
      openEditor: (input) => this.requireNavigation().openAppEditor(input),
      openEditorChat: (input) =>
        this.requireNavigation().openAppEditorChat(input),
      hideEditor: (appId) => this.requireNavigation().hideAppEditor(appId),
      guiInfo: (input, context) => this.guiInfo(input, context),
      guiReady: (input) => this.guiReady(input),
      releaseGuiSurface: (input, context) => this.releaseGuiSurface(input, context),
      fileExportBegin: (input) => this.guiRuntime.beginExport(input),
      fileExportWrite: (input) => this.guiRuntime.writeExport(input),
      fileExportFinalize: (input) => this.guiRuntime.finalizeExport(input),
      fileExportCancel: (input) => this.guiRuntime.cancelExport(input),
      importDesignCanvas: (surfaceLeaseId, file) =>
        this.designIntegration.importCanvas(surfaceLeaseId, file),
      listDesignImportCandidates: (surfaceLeaseId) =>
        this.designIntegration.listImportCandidates(surfaceLeaseId),
      listDesignFiles: (surfaceLeaseId) =>
        this.designIntegration.listSurfaceFiles(surfaceLeaseId),
      listDesignVersions: (surfaceLeaseId, file) =>
        this.designIntegration.listSurfaceVersions(surfaceLeaseId, file),
      restoreDesignVersion: (surfaceLeaseId, versionId) =>
        this.designIntegration.restoreSurfaceVersion(surfaceLeaseId, versionId),
      setDesignAutoOpen: (input) => this.designIntegration.setAutoOpen(input),
      designDataStatus: (appId) => this.designIntegration.dataStatus(appId),
      deleteDesignData: (input) => this.designIntegration.deleteData(input),
      setDesignEnabled: (appId, enabled) => this.designIntegration.setEnabled(appId, enabled),
      resolveMaintenanceBackend: (agent) =>
        this.agentOperations.resolveMaintenanceBackend(agent),
      resolvePresetAgent: () => this.agentOperations.resolvePresetAgent(),
      onClosed: () => {
        this.window = null;
      },
    });
  }
  resolveApp(appId: string) { return resolveRunnableApp(this.store, appId); }
  resolveAppForBinding(appId: string) { return resolveBindableApp(this.store, appId); }
  resolveAppData(appId: string) { return this.designIntegration.resolveAppData(appId); }
  readDesignCanvasForTool(chatId: string, incarnationId: string, relativePath: string) {
    return this.designIntegration.readCanvasForTool(chatId, incarnationId, relativePath);
  }
  configureDesignWorkspace(
    resolver: EffectiveWorkspaceResolver,
    getConversationIncarnation: (chatId: string) => string | undefined
  ) {
    this.designIntegration.configureWorkspace(resolver, getConversationIncarnation);
  }
  migrateDesignProjectWorkspace(evidence: DesignProjectRebindEvidence) { return this.designIntegration.migrateProjectWorkspace(evidence); }
  async armDesignTurn(input: {
    chatId: string;
    conversationIncarnationId: string;
    turnId: string;
    explicitDesign: boolean;
  }) {
    return this.designIntegration.armTurn(input);
  }
  settleDesignTurn(chatId: string, incarnationId: string, turnId: string) { return this.designIntegration.settleTurn(chatId, incarnationId, turnId); }
  configureSaveAsApp(
    service: SaveAsAppService,
    options: {
      renameBase(record: AppRecord, name: string): Promise<void>;
      invalidateSkills(): void;
    }
  ) {
    if (this.saveAsAppService) throw new Error("Save as App 已配置");
    this.saveAsAppService = service;
    this.renamer = new BaseAppRenamer({
      store: this.store,
      syncBase: options.renameBase,
      warn: (message, cause) => console.warn(`[apps] ${message}`, cause),
    });
    this.invalidateSkills = options.invalidateSkills;
  }
  configureAppDelete(service: AppDeleteService) {
    if (this.appDeleteService) throw new Error("App delete 已配置"); this.appDeleteService = service;
  }
  async markDeleteStalled(appId: string, message: string) {
    if (!this.store.get(appId)) return;
    await this.store.update(appId, (value) => ({
      ...value,
      state: "delete-failed",
      lastError: { phase: "delete", message },
    }));
  }
  configureChatSlots(service: AppChatSlots) {
    if (this.chatSlots) throw new Error("App chat slots 已配置"); this.chatSlots = service;
  }
  configureGrantAuthority(authority: AppGrantAuthority) {
    if (this.grantAuthority) throw new Error("App grant authority 已配置"); this.grantAuthority = authority;
  }
  configureAttachmentFence(fence: AppAttachmentFence) {
    if (this.attachmentFence) throw new Error("App attachment fence 已配置"); this.attachmentFence = fence;
  }
  configureSurfaceLeases(registry: AppAttachmentSurfaceLeaseRegistry) {
    if (this.surfaceLeases) throw new Error("App surface leases 已配置");
    this.surfaceLeases = registry;
    this.designIntegration.configureSurfaceLeases(registry);
    this.guiRuntime.configureSurfaceLeases(registry);
    this.gateway.configureBaseGuiSurfaceValidator((surfaceLeaseId) =>
      registry.describe(surfaceLeaseId)
    );
  }
  configureManagementLeases(registry: AppManagementLeaseRegistry) {
    if (this.managementLeases) throw new Error("App management leases 已配置");
    this.managementLeases = registry;
  }
  describeManagementLease(id: string) { return this.requireManagementLeases().describe(id); }
  effectiveGrant(chatId: string, appId: string) {
    return this.requireGrantAuthority().effectiveGrant(chatId, appId);
  }
  describeSurface(id: string) { return this.requireSurfaceLeases().describe(id); }
  releaseWindowSurfaces(windowId: string) { this.requireSurfaceLeases().revokeWindow(windowId); }
  configureExtensions(
    integration: AppExtensionIntegration,
    participants: AppGenerationBuildParticipantRegistry
  ) {
    if (this.extensions) throw new Error("App extension integration 已配置");
    this.extensions = integration;
    this.buildParticipants = participants;
    this.thirdPartyMcpPlans.configure({
      acquireMany: (refs, owner) =>
        integration.registry.acquireGenerationRefs(refs, owner),
      releaseMany: (refs, owner) =>
        integration.registry.releaseGenerationRefs(refs, owner),
    });
    this.store.configureExtensionComposition(participants, integration.port);
    this.packages.configureExtensions(integration);
  }
  reconcileThirdPartyMcpPlans(ids: ReadonlySet<string>) { return this.thirdPartyMcpPlans.reconcile(ids); }
  extensionStatus(appId: string): AppExtensionStatus {
    const record = this.requireRecord(appId);
    if (!this.extensions) throw new Error("App extension integration 尚未配置");
    return projectAppExtensionStatus(
      record,
      this.extensions.registry,
      this.extensions.grants,
      this.extensions.contextForApp(appId)
    );
  }
  async capabilities(appId: string): Promise<AppCapabilitiesSnapshot> {
    const [snapshot, record] = await Promise.all([
      this.agentOperations.capabilities(appId),
      Promise.resolve(this.requireRecord(appId)),
    ]);
    const requested =
      record.manifest?.kind === "base"
        ? record.manifest.gui?.capabilities ?? []
        : [];
    return {
      ...snapshot,
      baseGuiCapability: {
        requested,
        effective: this.guiRuntime.liveBinding(appId)?.baseCapabilities ?? [],
      },
    };
  }
  markChatCanonical(appId: string, role: "edit" | "use", chatId: string) {
    return this.chatSlots?.markCanonical(appId, role, chatId) ?? Promise.resolve();
  }
  configureNavigation(service: AppNavigationService) {
    if (this.navigationService) throw new Error("App navigation 已配置");
    this.navigationService = service;
  }
  navigation() {
    return this.requireNavigation();
  }
  runAppLifecycleMutation<T>(appId: string, operation: () => Promise<T>) {
    return this.lifecycleMutations.run(appId, operation);
  }
  private requireNavigation() {
    if (!this.navigationService) throw new Error("App navigation 尚未初始化");
    return this.navigationService;
  }
  configurePackageFlows(importer: BaseAppImporter, shareFlow: ShareFlow) {
    this.packages.configure(importer, shareFlow);
    this.designIntegration.configureFactory({
      importer,
      grants: this.requireGrantAuthority(),
      resolveAgent: () => this.agentOperations.resolvePresetAgent(),
    });
    this.packages.configureFactoryPreset(
      this.designIntegration.factoryPresetFlow()
    );
  }

  ensureDesignFactory() { return this.designIntegration.ensureFactory(); }
  resetDesignFactoryToPin() { return this.designIntegration.ensureFactory(true); }
  finalizeDelete(appId: string) {
    return this.designIntegration.finalizeFactoryDeletion(appId);
  }
  emitDeleteProgress(appId: string) {
    this.emit({ appId, type: "progress", step: "", operation: "delete" });
  }
  emitRemoval(appId: string) {
    this.emit({ appId, type: "removed" });
  }
  resolveInteractiveAgent(appId: string) {
    const record = this.store.get(appId);
    return record && record.state !== "delete-failed" ? record.agent : undefined;
  }
  resolveAgentEnvironment(appId: string) {
    const record = this.requireRecord(appId);
    return this.packages.environment(appId, record);
  }
  isProjectAvailable(appId: string) {
    const record = this.store.get(appId); return Boolean(record && record.state !== "delete-failed");
  }
  listAppDirs() { return this.store.list().map((record) => record.dir); }
  async onAppTurnCompleted(appId: string, conversationId: string, requestId = "") {
    return this.editTurnLifecycle.completed(appId, conversationId, requestId);
  }
  async onAppTurnFailed(appId: string, conversationId: string, requestId = "") {
    return this.editTurnLifecycle.failed(appId, conversationId, requestId);
  }
  readReadme(appId: string) { return this.packages.readReadme(this.requireRecord(appId)); }
  isAllowedOrigin(origin: string) { return this.gateway.isRegisteredOrigin(origin); }
  isBaseGuiOrigin(origin: string) { return this.gateway.isBaseGuiOrigin(origin); }
  isAllowedBaseGuiDocumentUrl(value: string) { return this.gateway.isAllowedBaseGuiDocumentUrl(value); }
  configureGuiApi(port: GuiBasePort) { this.guiRuntime.configureApi(port); }
  configureWorkspacePreview(port: WorkspacePreviewPort) { this.guiRuntime.configureWorkspacePreview(port); }
  configureAppDataMigrations(port: AppDataMigrationPort) { this.dataMigrations.configure(port); }
  reconcileAppDataMigrations() { return this.dataMigrations.reconcileAll(); }
  async syncBaseGuiRoute(appId: string) {
    return this.guiRuntime.sync(appId, () => this.dataMigrations.reconcile(appId));
  }
  async guiInfo(input: AppGuiInfoInput, renderer: TrustedRendererContext): Promise<AppGuiInfo> {
    const surface = await this.requireSurfaceLeases().describe(
      input.appSurfaceLeaseId
    );
    if (surface.appId !== input.appId) {
      throw Object.assign(new Error("App GUI surface lease 与 App 不匹配"), {
        status: 401,
      });
    }
    return this.guiRuntime.info(input, () => this.dataMigrations.reconcile(input.appId), renderer);
  }
  async releaseGuiSurface(input: AppGuiInfoInput, renderer: TrustedRendererContext) {
    if (!this.guiRuntime.rendererOwns(input, renderer)) return;
    await this.guiRuntime.release(input);
  }
  guiReady(input: AppGuiReadyInput) { return this.guiRuntime.ready(input); }
  getReactGrabInjection() { return this.gateway.getServerInjectionJavascript(); }
  applyCandidateCompatibility(matrix: Parameters<typeof applyCandidateCompatibility>[2]) { return applyCandidateCompatibility(this.store, this.guiRuntime, matrix); }

  async shutdown() {
    this.turnCoordinator.releaseAllSourceMutations();
    await this.installer.shutdown();
    await this.lifecycleMutations.drain();
    await this.runtime.shutdown();
    await this.serverCustody.close();
    await this.processCustody.closeAndFlush();
    await this.dataCutovers.closeAndFlush();
    await this.designIntegration.closeAndFlush();
    await this.guiRuntime.shutdown();
  }
  closeDeleteAdmission(appId: string) { return this.deleteCoordinator.closeAdmission(appId); }
  revokeDeleteCapabilities(appId: string) { return this.deleteCoordinator.revokeCapabilities(appId); }
  settleDeleteBuilds(appId: string) { return this.deleteCoordinator.settleBuilds(appId); }
  generationDrainCounts(appId: string, generationId: string) {
    return this.deleteCoordinator.generationDrainCounts(appId, generationId);
  }
  configureGenerationRetirement(
    proof: (input: { appId: string; generationId: string }) => Promise<unknown>
  ) {
    this.guiRuntime.configureGenerationRetirement(proof);
  }
  settleDeleteData(record: AppRecord, mode: RemoveAppMode) {
    return this.deleteCoordinator.settleData(record, mode);
  }
  removeBaseShell(record: AppRecord) { return this.deleteCoordinator.removeBaseShell(record); }
  acquireTurnApps(input: {
    conversationId: string;
    requestId: string;
    backendId: AgentBackendId;
    backendRuntimeIdentity: string;
    turnClass: ExtensionTurnIdentity["turnClass"];
    planMode: boolean;
    projectContext: TurnProjectContext;
    toolAccess: "none" | "read" | "mutate";
    baseToolsAvailability?: BaseToolsAvailability;
  }) {
    return this.turnCoordinator.acquire(input);
  }
  turnExtensionSkills(id: string) { return this.turnCoordinator.skills(id); }
  turnExtensionMcpServers(id: string) { return this.turnCoordinator.mcpServers(id); }
  turnCustodyDependencies(id: string) { return this.turnCoordinator.custodyDependencies(id); }
  isTurnReferenceActive(id: string) { return this.referenceJournal.isActive(id); }
  isTurnPlanActive(id: string) { return this.thirdPartyMcpPlans.isActive(id); }
  releaseTurnApps(id: string) { return this.turnCoordinator.release(id); }
  /* ============================================================
   * 派生字段只在这一处补
   *
   * record 到达 renderer 只有两条路：`list` 的快照与 `status` 事件。两条
   * 路必须补同一份投影，否则界面会在「刚授权完」与「下一条事件」之间来回
   * 翻脸——而那正是同一个事实被算了两遍的经典症状。
   * ============================================================ */
  private projectRecord(record: AppRecord): AppRecordProjection {
    return {
      ...record,
      studioSurfaceReady: studioSurfaceReady(
        record,
        record.generationBinding.active && this.baseGuiGrants
          ? this.baseGuiGrants.projection(
              record.id,
              record.generationBinding.active.generationId
            )
          : null
      ),
    };
  }

  private withGuiCutover<T>(appId: string, operation: () => Promise<T>) {
    return this.guiRuntime.cutover(appId, operation);
  }
  /** 一次动作批准同一 frozen generation 的全部声明，并在 promotion 前落 Studio grant。 */
  private authorizeStudioAccess(appId: string) {
    return authorizeStudioAccess({
      appId,
      store: this.store,
      cutover: (operation) => this.withGuiCutover(appId, operation),
    });
  }
  private async stopApp(appId: string) {
    await this.runtime.stop(appId);
    await this.guiRuntime.revoke(appId);
  }
  private remove(appId: string, mode?: RemoveAppMode, requestId = "") {
    return removeApp({
      appId,
      mode,
      requestId,
      store: this.store,
      maintenanceGate: this.maintenanceGate,
      deleteService: this.appDeleteService,
      markDeleteStalled: (message) => this.markDeleteStalled(appId, message),
    });
  }
  private requireGrantAuthority() {
    if (!this.grantAuthority) throw new Error("App grant authority 尚未初始化");
    return this.grantAuthority;
  }
  private requireSurfaceLeases() {
    if (!this.surfaceLeases) throw new Error("App surface leases 尚未初始化");
    return this.surfaceLeases;
  }
  private requireManagementLeases() {
    if (!this.managementLeases) {
      throw new Error("App management leases 尚未初始化");
    }
    return this.managementLeases;
  }
  private requireRecord(appId: string) {
    const record = this.store.get(appId);
    if (!record) throw new Error("App 不存在");
    return record;
  }
  private emit(event: AppInstallEvent) {
    publishAppEvent({
      event,
      window: this.window,
      invalidateSkills: this.invalidateSkills,
    });
  }
}
