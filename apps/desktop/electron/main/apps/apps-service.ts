/**
 * [INPUT]: Depends on service/composition for the assembled collaborator graph and explicit runtime storage mode, plus the shared lifecycle mutation lane, Design/extension/navigation integrations, and the service IPC registrar, and statusError from main/errors
 * [OUTPUT]: Owns App lifecycle, explicit installation Agent checks, cloud-management projections and committed removal notifications, and the Edit-draft supersession a remote Edit Chat causes (U06 Q7-c3). App server guardians run on the bundled Node by default (bundledGuardian, TASK-35). U06-d: remoteApps (navigation plus remote rebuild and extension decline), buildStatus, and the Edit Chat notice writer it is configured with; a window that shows asks any waiting extension decision. A remote rebuild goes through startRemoteRebuild. Composes the availability authority, transient conversation admission guard and committed-only availability reads for persistent services.
 * [POS]: App composition root; owns lifecycle, authority and late-bound collaborators, including the isolated plugin gateway delegate.
 */

import { recoverOrDefer } from "../persistence/recovery-policy";
import { startupTrace } from "../startup/boot/startup-trace";
import { APPS_CHANNEL } from "../../../shared/ipc/apps/apps-ipc";
import type { BrowserWindow } from "electron";
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
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
} from "../../../shared/ipc/apps/apps-ipc";
import type { BaseToolsAvailability } from "../../../shared/builtin-tools";
import type { ExtensionTurnIdentity } from "../../../shared/ipc/settings/extensions-ipc";
import type { TurnProjectContext } from "../../../shared/product/product-resource-scope";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
import { statusError } from "../ipc/errors";
import type { TrustedRendererContext } from "../window/surfaces/trusted-renderer-context";
import type { AppExtensionIntegration } from "../extensions/integration/app-extension-composition";
import type { AppGenerationBuildParticipantRegistry } from "../lifecycle/generation/build-participants";
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
import type { EffectiveWorkspaceResolver } from "../workspace/files/workspace-resolver";
import type { DesignProjectRebindEvidence } from "../design/service";
import { bundledGuardian } from "../runtime";
import type { CustodyRuntimeOptions } from "../custody/attachment";
import type { DeclinedNotice } from "./service/consent/broker";
import { startRemoteRebuild } from "./service/lifecycle/remote-rebuild";
import type { RemoteApps } from "../cloud/remote/resources/apps";


import { AppEnablementService } from "./service/availability/service";
import { assertAppEnabled, isAppEnabled } from "./service/availability/guard";

export { appTurnCompletionAction } from "./service/turn-action";

type AppsRuntime = ReturnType<typeof composeAppsRuntime>;

export class AppsService {
  private readonly parts: AppsRuntime;
  readonly store: AppsRuntime["store"];
  readonly enablement: AppEnablementService;
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
  private declinedNotice: ((notice: DeclinedNotice) => Promise<void>) | null = null;
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
  get compatibilityRequests() { return this.parts.packages.compatibility; }
  get configs() {
    return this.parts.packages.configs;
  }
  publishRemoval(appId: string) {
    if (!this.store.get(appId)) this.emit({ appId, type: "removed" });
  }
  async validateInstallAgent(agent: AgentBackendId) {
    await this.parts.agentOperations.resolveMaintenanceBackend(agent);
  }
  constructor(
    readonly userData: string,
    guardian: CustodyRuntimeOptions["guardian"] = bundledGuardian,
    inspectCapabilityInventory: ((
      appId: string
    ) => Promise<AgentToolInventory | null>) | undefined,
    storageMode: import("../../../shared/local-storage/contracts").RuntimeStorageMode | undefined,
    /** The selected folder. Null only before the first selection, where the catalog reads as empty. */
    libraryRoot: () => string | null
  ) {
    this.parts = composeAppsRuntime({
      userData,
      storageMode,
      libraryRoot,
      guardian,
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
        chatAppId: (conversationId) => this.chatSlots?.appIdOf(conversationId),
        editAppId: (conversationId) =>
          this.chatSlots?.editAppIdOf(conversationId),
        chatRole: (conversationId) =>
          this.chatSlots?.roleOf(conversationId) ?? undefined,
        extensionDeclined: (notice) => this.declinedNotice?.(notice) ?? Promise.resolve(),
      },
    });
    this.store = this.parts.store;
    this.enablement = new AppEnablementService(this.store, id => this.parts.stopApp(id), (id, action) => this.runAppLifecycleMutation(id, action));
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

  revokeAppSurfaces(appId: string) { this.surfaceLeases?.revokeApp(appId); }
  assertEnabled(appId: string) { assertAppEnabled(this.store.get(appId)); }
  conversationEnabled(chatId: string, options: { committedOnly?: boolean } = {}) {
    const appId = this.chatSlots?.appIdOf(chatId);
    if (!appId) return true;
    const app = this.store.get(appId);
    return options.committedOnly ? Boolean(app && app.enabled !== false) : isAppEnabled(app);
  }
  assertConversationEnabled(chatId: string) {
    const appId = this.chatSlots?.appIdOf(chatId);
    if (appId) this.assertEnabled(appId);
  }
  configureLocale(locale: () => AppLocale) { this.locale = locale; }
  async initialize() {
    await this.store.inspectAuthority();
    await Promise.all([
      this.buildLedger.initialize(),
      this.referenceJournal.initialize(),
      this.thirdPartyMcpPlans.initialize(),
      this.dataCutovers.initialize(),
      this.dataArchives.initialize(),
      this.baseGuiGrants.initialize(),
      this.store.initializeAppGuiCompiler(),
      startupTrace.span("apps:design-integration", () => this.parts.designIntegration.initialize()),
      startupTrace.span("apps:gui-runtime", () => this.parts.guiRuntime.initialize()),
    ]);
    await this.serverCustody.initialize();
    await this.store.load();
    this.parts.buildTracker.start();
    /* C-17: only the generations still in use keep Base GUI records — each App's active and pending one and every
       unfinished build; everything else, deleted Apps included, is compacted away (consent follows the App). */
    const inUse = new Set<string>();
    for (const record of this.store.list()) {
      for (const generationId of [record.generationBinding.active?.generationId, record.generationBinding.pending?.generationId]) {
        if (generationId) inUse.add(`${record.id}\u0000${generationId}`);
      }
    }
    for (const operation of this.buildLedger.listNonTerminal()) inUse.add(`${operation.appId}\u0000${operation.appGenerationId}`);
    await this.baseGuiGrants.compact(inUse);
    await recoverOrDefer(async () => {
      await startupTrace.span("apps:gui-cutovers", () => this.parts.guiRuntime.recoverCutovers());
      await startupTrace.span("apps:server-reconcile", () => this.parts.serverLifecycle.reconcile());
    });
    await this.parts.gateway.start();
    await recoverOrDefer(async () => {
      await startupTrace.span("apps:installer", () => this.parts.installer.initialize()); await this.store.normalizeStartupStates();
    });
    return this.store.authorityState();
  }
  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    // U06-d: an extension decision nobody could be asked (no window, or a hidden one) is asked once a window shows.
    const ask = () => this.parts.consent.windowOpened();
    window.on("show", ask); ask();
    const stopCompatibility = this.compatibilityRequests.onChanged(() => {
      if (!window.isDestroyed()) window.webContents.send(APPS_CHANNEL.compatibilityChanged);
    });
    window.once("closed", stopCompatibility);
    registerAppsIpc(window, rendererUrl, {
      enablement: this.enablement,
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
      checkAgentTools: async (appId) => { await this.parts.runtime.inspectToolInventory(appId); },
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
        integration.registry.lifecycle.acquireGenerationRefs(refs, owner),
      releaseMany: (refs, owner) =>
        integration.registry.lifecycle.releaseGenerationRefs(refs, owner),
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
  async markChatCanonical(appId: string, role: "edit" | "use", chatId: string, origin: "local" | "remote" = "local") {
    const superseded = await this.chatSlots?.markCanonical(appId, role, chatId, origin);
    if (superseded) this.emit({ appId, type: "edit-draft-superseded", chatId, ...superseded });
  }
  configureNavigation(service: AppNavigationService) {
    if (this.navigationService) throw new Error("App navigation 已配置");
    this.navigationService = service;
  }
  runAppLifecycleMutation<T>(appId: string, operation: () => Promise<T>) {
    return this.lifecycleMutations.run(appId, operation);
  }
  /** The navigation service and the remote build operations once App mode configured it; null before (remote App commands are then refused). */
  remoteApps(): RemoteApps | null {
    const navigation = this.navigationService;
    return navigation && {
      disableImpact: appId => this.enablement.impact(appId),
      setEnabled: input => this.enablement.setEnabled(input),
      openUseChatRemotely: (...args) => navigation.openUseChatRemotely(...args),
      latestEditorChat: (appId) => navigation.latestEditorChat(appId),
      editorAvailability: (appId) => navigation.editorAvailability(appId),
      remoteRebuild: (appId) => this.remoteRebuild(appId),
      declineExtension: (appId, requestId, deviceName) => this.declineExtension(appId, requestId, deviceName),
    };
  }
  /** U06-d: the Edit Chat notice writer for an extension declined from another device or by the time limit. */
  configureDeclinedNotice(writer: (notice: DeclinedNotice) => Promise<void>) { this.declinedNotice = writer; }
  /** U06-d: every App's build status, for the owner's cloud projection. */
  buildStatus() { return this.parts.buildTracker; }
  /** U06-d: a remote device's only extension decision. */
  declineExtension(appId: string, requestId: string, deviceName: string) { return this.parts.consent.decline(appId, requestId, deviceName); }
  /** U06-d: a remote "Try again" retries a failed after-edit build in the background (its progress is the build status); never Repair. */
  remoteRebuild(appId: string) {
    const navigation = this.requireNavigation();
    startRemoteRebuild(appId, { availability: (id) => navigation.rebuildAvailability(id), locked: (id) => this.parts.maintenanceGate.isLocked(id),
      retry: (id) => this.parts.installer.retryUpdate(id), report: (cause) => console.warn(`[apps] remote rebuild of ${appId} failed`, cause) });
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
  configureArtifacts(artifacts: import("../artifacts/render/gateway-route").ArtifactGateway) { this.parts.gateway.configureArtifacts(artifacts); }
  configurePluginSurfaces(gateway: import("../plugins/surface-runtime/gateway").PluginSurfaceGateway) { this.parts.gateway.configurePluginSurfaces(gateway); }
  isAllowedOrigin(origin: string) { return this.parts.gateway.isRegisteredOrigin(origin); }
  isBaseGuiOrigin(origin: string) { return this.parts.gateway.isBaseGuiOrigin(origin); }
  isAllowedBaseGuiDocumentUrl(value: string) { return this.parts.gateway.isAllowedBaseGuiDocumentUrl(value); }
  configureGuiApi(port: GuiBasePort) { this.parts.guiRuntime.configureApi(port); }
  configureAppDataMigrations(port: AppDataMigrationPort) { this.parts.dataMigrations.configure(port); }
  reconcileAppDataMigrations() { return this.parts.dataMigrations.reconcileAll(); }
  async guiInfo(input: AppGuiInfoInput, renderer: TrustedRendererContext): Promise<AppGuiInfo> {
    const surface = await this.requireSurfaceLeases().describe(
      input.appSurfaceLeaseId
    );
    if (surface.appId !== input.appId) {
      throw statusError(401, "App GUI surface lease 与 App 不匹配");
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
    // An open waiting out a cutover settles now; no waiter or timer outlives quit.
    this.admission.app.dispose();
    // A build waiting for an extension decision must not hold the installer's shutdown open.
    this.parts.consent.close(); this.parts.buildTracker.close();
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
      ...(this.store.portable.isCloudManaged(record.id) ? { cloudManaged: true as const } : {}),
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
