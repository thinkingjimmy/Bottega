/**
 * [INPUT]: Depends on service/composition for the assembled collaborator graph, plus the shared lifecycle mutation lane, Design/extension/navigation integrations, and the service IPC registrar
 * [OUTPUT]: Provides authority-gated AppsService startup, source-fenced Edit turns, Use/Edit navigation, compiled GUI cohort cutover, signed-update compatibility, Studio authorization, file export, renderer cleanup, convergent deletion, Design integration, and one durable status forwarder
 * [POS]: The composition root of the apps module; it owns lifecycle, authority, and the late-bound collaborators while service/composition.ts assembles the object graph
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
import type { AppGenerationBuildParticipantRegistry } from "../lifecycle/app-generation-build-participants";
import type { AppNavigationService } from "./turn/app-navigation";
import type { AppChatSlots } from "./turn/app-chat-slots";
import type { AppDataMigrationPort } from "./maintenance/app-data-migrations";
import type { AppDeleteService } from "./conversion/app-delete";
import { BaseAppRenamer } from "./conversion/app-rename";
import { AppMutationCoordinator } from "./source/app-source-coordinator";
import type { AppAttachmentFence } from "./attachments/attachment-fence";
import {
  studioSurfaceReady,
  type AppGrantAuthority,
} from "./attachments/grant-authority";
import type { AppAttachmentSurfaceLeaseRegistry } from "./attachments/surface-leases";
import type { GuiBasePort } from "./generation/gui-api";
import type { WorkspacePreviewPort } from "./base-gui/workspace-preview";
import type { BaseAppImporter } from "./install/import-base-app";
import type { AgentToolInventory } from "./runtime/agent-tools";
import type { SaveAsAppService } from "./conversion/save-as-app";
import { publishAppEvent } from "./service/app-event-publisher";
import {
  composeAppsRuntime,
  requireConfigured,
} from "./service/composition";
import { applyCandidateCompatibility } from "./service/lifecycle/update-compatibility";
import { registerAppsIpc } from "./service/ipc";
import { resolveBindableApp, resolveRunnableApp } from "./service/lifecycle/app-resolution";
import {
  authorizeStudioAccess,
  declineStudioAccess,
  rebuildExtensionGeneration,
  removeApp,
  revokeExtensionGrant,
} from "./service/lifecycle/runtime-operations";
import type { ShareFlow } from "./share/share-flow";
import { projectAppExtensionStatus } from "./turn/app-extension-status";
import type { EffectiveWorkspaceResolver } from "../workspace-resolver";
import type { DesignProjectRebindEvidence } from "../design/service";

function defaultGuardianArgs() {
  if (typeof __dirname !== "string") return [] as const;
  return [join(__dirname, "custody-guardian-entry.js")] as const;
}

export { appTurnCompletionAction } from "./service/turn-action";

type AppsRuntime = ReturnType<typeof composeAppsRuntime>;

export class AppsService {
  private readonly parts: AppsRuntime;
  readonly store: AppsRuntime["store"];
  readonly processCustody: AppsRuntime["processCustody"];
  readonly serverCustody: AppsRuntime["serverCustody"];
  readonly serverCutover: AppsRuntime["serverCutover"];
  readonly buildLedger: AppsRuntime["buildLedger"];
  readonly referenceJournal: AppsRuntime["referenceJournal"];
  readonly dataCutovers: AppsRuntime["dataCutovers"];
  readonly dataArchives: AppsRuntime["dataArchives"];
  readonly admission: AppsRuntime["admission"];
  readonly instructionContributors: AppsRuntime["instructionContributors"];
  readonly thirdPartyMcpPlans: AppsRuntime["thirdPartyMcpPlans"];
  readonly baseGuiGrants: AppsRuntime["baseGuiGrants"];
  readonly design: AppsRuntime["designIntegration"]["service"];

  private readonly lifecycleMutations = new AppMutationCoordinator();

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
    return this.parts.gateway.requestLeases;
  }
  get attachments() {
    return this.attachmentFence;
  }
  get configs() {
    return this.parts.packages.configs;
  }
  constructor(
    readonly userData: string,
    guardianArgs: readonly string[] = defaultGuardianArgs(),
    inspectCapabilityInventory?: (
      appId: string
    ) => Promise<AgentToolInventory | null>
  ) {
    this.parts = composeAppsRuntime({
      userData,
      guardianArgs,
      inspectCapabilityInventory,
      host: {
        emit: (event) => this.emit(event),
        projectRecord: (record) => this.projectRecord(record),
        reportGatewayWarning: (message) => {
          this.gatewayWarning = message;
          this.emit({ type: "runtime-warning", message });
        },
        window: () => this.window,
        locale: () => this.locale(),
        invalidateSkills: () => this.invalidateSkills?.(),
        grantAuthority: () => this.grantAuthority,
        surfaceLeases: () => this.surfaceLeases,
        extensions: () => this.extensions,
        buildParticipants: () => this.buildParticipants,
        editAppId: (conversationId) =>
          this.chatSlots?.editAppIdOf(conversationId),
        chatRole: (conversationId) =>
          this.chatSlots?.roleOf(conversationId) ?? undefined,
      },
    });
    this.store = this.parts.store;
    this.processCustody = this.parts.processCustody;
    this.serverCustody = this.parts.serverCustody;
    this.serverCutover = this.parts.serverCutover;
    this.buildLedger = this.parts.buildLedger;
    this.referenceJournal = this.parts.referenceJournal;
    this.dataCutovers = this.parts.dataCutovers;
    this.dataArchives = this.parts.dataArchives;
    this.admission = this.parts.admission;
    this.instructionContributors = this.parts.instructionContributors;
    this.thirdPartyMcpPlans = this.parts.thirdPartyMcpPlans;
    this.baseGuiGrants = this.parts.baseGuiGrants;
    this.design = this.parts.designIntegration.service;
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
      this.parts.designIntegration.initialize(),
      this.parts.guiRuntime.initialize(),
    ]);
    await this.serverCustody.initialize();
    await this.store.load();
    if (this.store.authorityState() === "degraded-corrupt") return "degraded-corrupt";
    await this.parts.guiRuntime.recoverCutovers();
    await this.parts.serverLifecycle.reconcile();
    await this.parts.gateway.start();
    await this.parts.installer.initialize();
    await this.store.normalizeStartupStates();
    return this.store.authorityState();
  }
  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    registerAppsIpc(window, rendererUrl, {
      store: this.store,
      runtime: this.parts.runtime,
      installer: this.parts.installer,
      packages: this.parts.packages,
      lifecycleGate: this.lifecycleGate,
      gatewayWarning: () => this.gatewayWarning,
      grantAuthority: () => this.requireGrantAuthority(),
      surfaceLeases: () => this.requireSurfaceLeases(),
      saveAsApp: () => this.saveAsAppService,
      appDelete: () => this.appDeleteService,
      emit: (event) => this.emit(event),
      requireRecord: (appId) => this.requireRecord(appId),
      stop: (appId) => this.parts.stopApp(appId),
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
      readLogTail: (appId) => this.parts.agentOperations.readLogTail(appId),
      setAgent: (input) => this.parts.agentOperations.setAgent(input),
      rename: (input) => {
        if (!this.renamer) throw new Error("Base App 改名尚未初始化");
        return this.renamer.rename(input);
      },
      ensureChatSlot: (input) => {
        if (!this.chatSlots) throw new Error("App chat slots 尚未初始化");
        return this.chatSlots.ensure(input);
      },
      navigation: () => this.requireNavigation(),
      guiInfo: (input, context) => this.guiInfo(input, context),
      guiReady: (input) => this.guiReady(input),
      releaseGuiSurface: (input, context) => this.releaseGuiSurface(input, context),
      guiRuntime: this.parts.guiRuntime,
      design: this.parts.designIntegration,
      resolveMaintenanceBackend: (agent) =>
        this.parts.agentOperations.resolveMaintenanceBackend(agent),
      resolvePresetAgent: () => this.parts.agentOperations.resolvePresetAgent(),
      onClosed: () => {
        this.window = null;
      },
    });
  }
  resolveApp(appId: string) { return resolveRunnableApp(this.store, appId); }
  resolveAppForBinding(appId: string) { return resolveBindableApp(this.store, appId); }
  resolveAppData(appId: string) { return this.parts.designIntegration.resolveAppData(appId); }
  readDesignCanvasForTool(chatId: string, incarnationId: string, relativePath: string) {
    return this.parts.designIntegration.readCanvasForTool(chatId, incarnationId, relativePath);
  }
  configureDesignWorkspace(
    resolver: EffectiveWorkspaceResolver,
    getConversationIncarnation: (chatId: string) => string | undefined
  ) {
    this.parts.designIntegration.configureWorkspace(resolver, getConversationIncarnation);
  }
  migrateDesignProjectWorkspace(evidence: DesignProjectRebindEvidence) { return this.parts.designIntegration.migrateProjectWorkspace(evidence); }
  async armDesignTurn(input: {
    chatId: string;
    conversationIncarnationId: string;
    turnId: string;
    explicitDesign: boolean;
  }) {
    return this.parts.designIntegration.armTurn(input);
  }
  settleDesignTurn(chatId: string, incarnationId: string, turnId: string) { return this.parts.designIntegration.settleTurn(chatId, incarnationId, turnId); }
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
    this.parts.designIntegration.configureSurfaceLeases(registry);
    this.parts.guiRuntime.configureSurfaceLeases(registry);
    this.parts.gateway.configureBaseGuiSurfaceValidator((surfaceLeaseId) =>
      registry.describe(surfaceLeaseId)
    );
  }
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
    this.parts.packages.configureExtensions(integration);
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
      this.parts.agentOperations.capabilities(appId),
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
        effective: this.parts.guiRuntime.liveBinding(appId)?.baseCapabilities ?? [],
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
  runAppLifecycleMutation<T>(appId: string, operation: () => Promise<T>) {
    return this.lifecycleMutations.run(appId, operation);
  }
  private requireNavigation() {
    return requireConfigured(this.navigationService, "App navigation");
  }
  configurePackageFlows(importer: BaseAppImporter, shareFlow: ShareFlow) {
    this.parts.packages.configure(importer, shareFlow);
    this.parts.designIntegration.configureFactory({
      importer,
      grants: this.requireGrantAuthority(),
      resolveAgent: () => this.parts.agentOperations.resolvePresetAgent(),
    });
    this.parts.packages.configureFactoryPreset(
      this.parts.designIntegration.factoryPresetFlow()
    );
  }

  ensureDesignFactory() { return this.parts.designIntegration.ensureFactory(); }
  finalizeDelete(appId: string) {
    return this.parts.designIntegration.finalizeFactoryDeletion(appId);
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
    return this.parts.packages.environment(appId, record);
  }
  isProjectAvailable(appId: string) {
    const record = this.store.get(appId); return Boolean(record && record.state !== "delete-failed");
  }
  listAppDirs() { return this.store.list().map((record) => record.dir); }
  async onAppTurnCompleted(appId: string, conversationId: string, requestId = "") {
    return this.parts.editTurnLifecycle.completed(appId, conversationId, requestId);
  }
  async onAppTurnFailed(appId: string, conversationId: string, requestId = "") {
    return this.parts.editTurnLifecycle.failed(appId, conversationId, requestId);
  }
  isAllowedOrigin(origin: string) { return this.parts.gateway.isRegisteredOrigin(origin); }
  isBaseGuiOrigin(origin: string) { return this.parts.gateway.isBaseGuiOrigin(origin); }
  isAllowedBaseGuiDocumentUrl(value: string) { return this.parts.gateway.isAllowedBaseGuiDocumentUrl(value); }
  configureGuiApi(port: GuiBasePort) { this.parts.guiRuntime.configureApi(port); }
  configureWorkspacePreview(port: WorkspacePreviewPort) { this.parts.guiRuntime.configureWorkspacePreview(port); }
  configureAppDataMigrations(port: AppDataMigrationPort) { this.parts.dataMigrations.configure(port); }
  reconcileAppDataMigrations() { return this.parts.dataMigrations.reconcileAll(); }
  async syncBaseGuiRoute(appId: string) {
    return this.parts.guiRuntime.sync(appId, () => this.parts.dataMigrations.reconcile(appId));
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
    return this.parts.guiRuntime.info(input, () => this.parts.dataMigrations.reconcile(input.appId), renderer);
  }
  async releaseGuiSurface(input: AppGuiInfoInput, renderer: TrustedRendererContext) {
    if (!this.parts.guiRuntime.rendererOwns(input, renderer)) return;
    await this.parts.guiRuntime.release(input);
  }
  guiReady(input: AppGuiReadyInput) { return this.parts.guiRuntime.ready(input); }
  getReactGrabInjection() { return this.parts.gateway.getServerInjectionJavascript(); }
  applyCandidateCompatibility(matrix: Parameters<typeof applyCandidateCompatibility>[2]) { return applyCandidateCompatibility(this.store, this.parts.guiRuntime, matrix); }

  async shutdown() {
    this.parts.turnCoordinator.releaseAllSourceMutations();
    await this.parts.installer.shutdown();
    await this.lifecycleMutations.drain();
    /* 记录写队列排在最后一笔变更之后：不排空就等于把最后一次 state 变更
       留在内存里，下次启动读到的是上上个真相。 */
    await this.store.closeAndFlush();
    await this.parts.runtime.shutdown();
    await this.serverCustody.close();
    await this.processCustody.closeAndFlush();
    await this.dataCutovers.closeAndFlush();
    await this.parts.designIntegration.closeAndFlush();
    await this.parts.guiRuntime.shutdown();
  }
  closeDeleteAdmission(appId: string) { return this.parts.deleteCoordinator.closeAdmission(appId); }
  revokeDeleteCapabilities(appId: string) { return this.parts.deleteCoordinator.revokeCapabilities(appId); }
  settleDeleteBuilds(appId: string) { return this.parts.deleteCoordinator.settleBuilds(appId); }
  generationDrainCounts(appId: string, generationId: string) {
    return this.parts.deleteCoordinator.generationDrainCounts(appId, generationId);
  }
  configureGenerationRetirement(
    proof: (input: { appId: string; generationId: string }) => Promise<unknown>
  ) {
    this.parts.guiRuntime.configureGenerationRetirement(proof);
  }
  settleDeleteData(record: AppRecord, mode: RemoveAppMode) {
    return this.parts.deleteCoordinator.settleData(record, mode);
  }
  removeBaseShell(record: AppRecord) { return this.parts.deleteCoordinator.removeBaseShell(record); }
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
    return this.parts.turnCoordinator.acquire(input);
  }
  turnExtensionSkills(id: string) { return this.parts.turnCoordinator.skills(id); }
  turnCustodyDependencies(id: string) { return this.parts.turnCoordinator.custodyDependencies(id); }
  isTurnReferenceActive(id: string) { return this.referenceJournal.isActive(id); }
  isTurnPlanActive(id: string) { return this.thirdPartyMcpPlans.isActive(id); }
  releaseTurnApps(id: string) { return this.parts.turnCoordinator.release(id); }
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
    return this.parts.guiRuntime.cutover(appId, operation);
  }
  /** 一次动作批准同一 frozen generation 的全部声明，并在 promotion 前落 Studio grant。 */
  private authorizeStudioAccess(appId: string) {
    return authorizeStudioAccess({
      appId,
      store: this.store,
      cutover: (operation) => this.withGuiCutover(appId, operation),
    });
  }
  private remove(appId: string, mode?: RemoveAppMode, requestId = "") {
    return removeApp({
      appId,
      mode,
      requestId,
      store: this.store,
      maintenanceGate: this.parts.maintenanceGate,
      deleteService: this.appDeleteService,
      markDeleteStalled: (message) => this.markDeleteStalled(appId, message),
    });
  }
  private requireGrantAuthority() {
    return requireConfigured(this.grantAuthority, "App grant authority");
  }
  private requireSurfaceLeases() {
    return requireConfigured(this.surfaceLeases, "App surface leases");
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
