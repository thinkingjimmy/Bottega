/**
 * [INPUT]: Depends on the Apps store/runtime/installer, generation/reference/data/custody durable ledgers, Base GUI grant/API/data migration, Design domain, App×Extension integration, and service sub-modules
 * [OUTPUT]: Provides AppsService with App lifecycle APIs, renderer-surface cleanup, request-bound Design turn settlement, role-aware and incarnation-fenced Design tool reads, registered preview ports, main Project-rebind migration, immediate Design Skill invalidation, and the single AppStore.watch subscription that turns every committed record into a renderer `status` event
 * [POS]: The composition root of the apps module; it maintains stable APIs, owns the only status forwarder, and delegates Design, install, turn, delete, and agent workflows to focused domains
 */

import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  AppCapabilitiesSnapshot,
  AppExtensionStatus,
  AppGuiInfo,
  AppGuiInfoInput,
  AppInstallEvent,
  AppRecord,
  RemoveAppMode,
} from "../../../shared/apps-ipc";
import { APPS_CHANNEL } from "../../../shared/apps-ipc";
import type { BaseToolsAvailability } from "../../../shared/builtin-tools";
import type { ExtensionTurnIdentity } from "../../../shared/extensions-ipc";
import type { TurnProjectContext } from "../../../shared/product-resource-scope";
import type { AppLocale } from "../../../shared/i18n/locale";
import { asError } from "../errors";
import { rendererEventBus } from "../window/surfaces/renderer-event-bus";
import type { AppExtensionIntegration } from "../extensions/integration/app-extension-composition";
import { ThirdPartyMcpPlanLedger } from "../extensions/lifecycle/third-party-mcp-plan-ledger";
import type { AppGenerationBuildParticipantRegistry } from "../lifecycle/app-generation-build-participants";
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
import type { AppAttachmentFence } from "./attachments/attachment-fence";
import type { AppGrantAuthority } from "./attachments/grant-authority";
import type { AppManagementLeaseRegistry } from "./attachments/management-leases";
import type { AppAttachmentSurfaceLeaseRegistry } from "./attachments/surface-leases";
import { AppGuiProjection } from "./gui-projection";
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
import { AppDeleteCoordinator } from "./service/delete-coordinator";
import { AppDesignIntegration } from "./service/integrations/design-integration";
import { AppEditTurnLifecycle } from "./service/lifecycle/edit-turn-lifecycle";
import { registerAppsIpc } from "./service/ipc";
import { resolveBindableApp, resolveRunnableApp } from "./service/lifecycle/app-resolution";
import {
  originWithoutStart,
  rebuildExtensionGeneration,
  removeApp,
  revokeBaseGuiAccess,
  revokeExtensionGrant,
  runtimeStatus,
  withGuiCutover,
} from "./service/lifecycle/runtime-operations";
import { AppTurnCoordinator } from "./service/turn-coordinator";
import { AppPackageController } from "./share/app-package-controller";
import type { ShareFlow } from "./share/share-flow";
import { projectAppExtensionStatus } from "./app-extension-status";
import { resolvePlatformCapabilities } from "../../../shared/platform-capabilities";
import type { EffectiveWorkspaceResolver } from "../workspace-resolver";
import { DESIGN_PRESET_ID } from "../design/enabled";
import type { DesignProjectRebindEvidence } from "../design/service";

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
  private readonly gui: AppGuiProjection;
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
    /* 唯一的 status 发源地：AppStore 每提交一条记录就在这里转成 renderer 事件。
       IPC、工厂 provisioning、installer、runtime、启动自愈走的是同一个闸口，
       没有哪条写入路径需要（也没有资格）自己记得补一条广播。 */
    this.store.watch((record) =>
      this.emit({ appId: record.id, type: "status", record })
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
    this.gateway.configureGenerationResolver((appId) => {
      const record = this.store.get(appId);
      const active = record?.generationBinding.active;
      return record && active
        ? {
            generationId: active.generationId,
            lifecycleRevision: record.lifecycleRevision,
          }
        : null;
    });
    this.gui = new AppGuiProjection(
      this.store,
      this.gateway,
      this.baseGuiGrants
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
      this.withGuiCutover(appId, operation)
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
      (appId) => this.agentOperations.readLogTail(appId)
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
      emitRemoved: (appId) => this.emit({ appId, type: "removed" }),
    });
    this.editTurnLifecycle = new AppEditTurnLifecycle({
      store: this.store,
      installer: this.installer,
      maintenanceGate: this.maintenanceGate,
      chatRole: (conversationId) => this.chatSlots?.roleOf(conversationId) ?? undefined,
      syncGui: (appId) => this.syncBaseGuiRoute(appId),
      emit: (event) => this.emit(event),
      invalidateSkills: () => this.invalidateSkills?.(),
    });
  }

  configureLocale(locale: () => AppLocale) { this.locale = locale; }

  async initialize() {
    await Promise.all([
      this.buildLedger.initialize(),
      this.referenceJournal.initialize(),
      this.thirdPartyMcpPlans.initialize(),
      this.dataCutovers.initialize(),
      this.dataArchives.initialize(),
      this.baseGuiGrants.initialize(),
      this.designIntegration.initialize(),
    ]);
    await this.serverCustody.initialize();
    await this.store.load();
    await this.serverLifecycle.reconcile();
    await this.gateway.start();
    await this.installer.initialize();
    await this.store.normalizeStartupStates();
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
      resolveExtensionConsent: (appId, granted) =>
        this.store.resolvePendingConsent(appId, granted),
      resolveBaseGuiConsent: (appId, granted, hostActions, scopes) =>
        this.store.resolvePendingBaseGuiConsent(
          appId,
          granted,
          hostActions,
          scopes
        ),
      revokeBaseGuiAccess: (appId) => this.revokeBaseGuiAccess(appId),
      revokeExtensionGrant: async (appId) => {
        await revokeExtensionGrant(this.store, this.extensions, appId);
        return this.extensionStatus(appId);
      },
      promoteGeneration: (appId, revision) =>
        this.withGuiCutover(appId, () =>
          this.store.promotePendingGeneration(appId, revision)
        ),
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
      guiInfo: (input) => this.guiInfo(input),
      releaseGuiSurface: (input) => this.releaseGuiSurface(input),
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

  migrateDesignProjectWorkspace(evidence: DesignProjectRebindEvidence) {
    return this.designIntegration.migrateProjectWorkspace(evidence);
  }

  async armDesignTurn(input: {
    chatId: string;
    conversationIncarnationId: string;
    turnId: string;
    explicitDesign: boolean;
  }) {
    return this.designIntegration.armTurn(input);
  }

  settleDesignTurn(chatId: string, incarnationId: string, turnId: string) {
    return this.designIntegration.settleTurn(chatId, incarnationId, turnId);
  }

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
        effective: this.gui.liveBinding(appId)?.baseCapabilities ?? [],
      },
    };
  }

  markChatCanonical(appId: string, role: "edit" | "use", chatId: string) {
    return this.chatSlots?.markCanonical(appId, role, chatId) ?? Promise.resolve();
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

  async onAppTurnCompleted(
    appId: string,
    conversationId: string,
    requestId = ""
  ) {
    return this.editTurnLifecycle.completed(appId, conversationId, requestId);
  }

  async onAppTurnFailed(
    appId: string,
    conversationId: string,
    requestId = ""
  ) {
    return this.editTurnLifecycle.failed(appId, conversationId, requestId);
  }

  readReadme(appId: string) { return this.packages.readReadme(this.requireRecord(appId)); }
  isAllowedOrigin(origin: string) { return this.gateway.isRegisteredOrigin(origin); }
  isBaseGuiOrigin(origin: string) { return this.gateway.isBaseGuiOrigin(origin); }
  isAllowedBaseGuiDocumentUrl(value: string) { return this.gateway.isAllowedBaseGuiDocumentUrl(value); }
  configureGuiApi(port: GuiBasePort) { this.gui.configureApi(port); }
  configureWorkspacePreview(port: WorkspacePreviewPort) { this.gui.configureWorkspacePreview(port); }
  configureAppDataMigrations(port: AppDataMigrationPort) { this.dataMigrations.configure(port); }
  reconcileAppDataMigrations() { return this.dataMigrations.reconcileAll(); }

  async syncBaseGuiRoute(appId: string) {
    let migrationFailure: unknown;
    await this.dataMigrations.reconcile(appId).catch((cause) => {
      migrationFailure = cause;
    });
    const result = await this.gui.sync(appId, { resetCapability: true });
    if (migrationFailure) throw migrationFailure;
    return result;
  }

  async guiInfo(input: AppGuiInfoInput): Promise<AppGuiInfo> {
    const surface = await this.requireSurfaceLeases().describe(
      input.appSurfaceLeaseId
    );
    if (surface.appId !== input.appId) {
      throw Object.assign(new Error("App GUI surface lease 与 App 不匹配"), {
        status: 401,
      });
    }
    let migrationError = "";
    await this.dataMigrations.reconcile(input.appId).catch((cause) => {
      migrationError = asError(cause).message;
    });
    const info = await this.gui.info(input);
    return migrationError ? { ...info, error: migrationError } : info;
  }

  releaseGuiSurface(input: AppGuiInfoInput) { return this.gui.release(input); }
  getReactGrabInjection() { return this.gateway.getServerInjectionJavascript(); }

  async shutdown() {
    await this.installer.shutdown();
    await this.runtime.shutdown();
    await this.serverCustody.close();
    await this.processCustody.closeAndFlush();
    await this.dataCutovers.closeAndFlush();
    await this.designIntegration.closeAndFlush();
  }

  closeDeleteAdmission(appId: string) { return this.deleteCoordinator.closeAdmission(appId); }
  revokeDeleteCapabilities(appId: string) { return this.deleteCoordinator.revokeCapabilities(appId); }
  settleDeleteBuilds(appId: string) { return this.deleteCoordinator.settleBuilds(appId); }
  generationDrainCounts(appId: string, generationId: string) {
    return this.deleteCoordinator.generationDrainCounts(appId, generationId);
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

  private withGuiCutover<T>(appId: string, operation: () => Promise<T>) {
    return withGuiCutover(
      {
        runExclusive: (target, run) => this.lifecycleGate.run(target, run),
        gateway: this.gateway,
        gui: this.gui,
      },
      appId,
      operation
    );
  }

  private revokeBaseGuiAccess(appId: string) {
    return revokeBaseGuiAccess({
      appId,
      store: this.store,
      grants: this.baseGuiGrants,
      cutover: (operation) => this.withGuiCutover(appId, operation),
    });
  }

  private async stopApp(appId: string) {
    await this.runtime.stop(appId);
    await this.gui.revoke(appId);
  }

  private remove(appId: string, mode?: RemoveAppMode, requestId = "") {
    return removeApp({
      appId,
      mode,
      requestId,
      store: this.store,
      maintenanceGate: this.maintenanceGate,
      deleteService: this.appDeleteService,
      design: this.design,
      invalidateSkills: () => this.invalidateSkills?.(),
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
    const designTransition =
      event.type === "status" && event.record.presetId === DESIGN_PRESET_ID;
    if (designTransition) this.invalidateSkills?.();
    /* 事件按归属分发,与 chats/projects 同规格:主窗收全量,App 窗只收自己那只
       App 的事件。status 事件整条 AppRecord(dir/manifest/grants/generations)
       随行,绝不能向每个 App 窗广播所有 App 的记录;无 appId 的全局事件
       (agent-visibility/runtime-warning)只落主窗。 */
    let delivered = rendererEventBus.toRole("main", APPS_CHANNEL.event, event);
    if ("appId" in event) {
      delivered += rendererEventBus.toApp(event.appId, APPS_CHANNEL.event, event);
    }
    if (!delivered && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(APPS_CHANNEL.event, event);
    }
  }
}
