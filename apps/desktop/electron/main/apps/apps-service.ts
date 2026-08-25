/**
 * [INPUT]: Depends on the Apps store/runtime/installer, generation/reference/data/custody durable ledgers, Base GUI grant/API/data migration, App×Extension integration, and IPC/turn/delete/agent sorting of the service sub-modules
 * [OUTPUT]: Provides AppsService to stabilize the front and back of the app with appTurnCompletionAction, unify installation, grant/surface, generation-bound GUI, Agent turn, run and delete the input, and connect the AppStore generation publish to the GUI drain
 * [POS]: The composition root of the apps module; Install only dependent, maintaining stable API and assigning long processes to single responsibility modules under service/
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import type { AgentBackendId } from "../../../shared/agent-ipc";
import type {
  AppCapabilitiesSnapshot,
  AppExtensionStatus,
  AppGuiInfo,
  AppInstallEvent,
  AppRecord,
  AppRuntimeStatus,
  EnsureAppChatSlotInput,
  RemoveAppMode,
  RenameAppInput,
} from "../../../shared/apps-ipc";
import { APPS_CHANNEL } from "../../../shared/apps-ipc";
import type { BaseToolsAvailability } from "../../../shared/builtin-tools";
import type { ExtensionTurnIdentity } from "../../../shared/extensions-ipc";
import type { AppLocale } from "../../../shared/i18n/locale";
import { asError } from "../errors";
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
import {
  shouldMarkDeleteFailed,
  type AppDeleteService,
} from "./app-delete";
import { AppGenerationBuildLedger } from "./app-generation-build-ledger";
import { AppGateway } from "./app-gateway";
import { AppInstaller } from "./app-installer";
import { AppInstructionContributorRegistry } from "./app-instruction-contributors";
import { BaseAppRenamer } from "./app-rename";
import { AppReferenceJournal } from "./app-reference-journal";
import { AppRuntime } from "./app-runtime";
import { AppServerDataCutover } from "./app-server-cutover";
import {
  completeBaseAppSkill,
  failBaseAppSkill,
} from "./app-skill-status";
import { AppStore } from "./app-store";
import type { AppAttachmentFence } from "./attachments/attachment-fence";
import type { AppGrantAuthority } from "./attachments/grant-authority";
import type { AppManagementLeaseRegistry } from "./attachments/management-leases";
import type { AppAttachmentSurfaceLeaseRegistry } from "./attachments/surface-leases";
import { AppGuiProjection } from "./gui-projection";
import type { GuiBasePort } from "./gui-api";
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
import { registerAppsIpc } from "./service/ipc";
import { AppTurnCoordinator } from "./service/turn-coordinator";
import { appTurnCompletionAction } from "./service/turn-action";
import { AppPackageController } from "./share/app-package-controller";
import type { ShareFlow } from "./share/share-flow";
import { projectAppExtensionStatus } from "./app-extension-status";
import { updateAndEmitStatus } from "./support";

function defaultGuardianArgs() {
  if (typeof __dirname !== "string") return [] as const;
  return [join(__dirname, "custody-guardian-entry.js")] as const;
}

function isCreateSkillTurn(record: AppRecord | undefined, requestId: string) {
  return Boolean(
    record?.manifest?.kind === "base" &&
      record.skillStatus?.state === "pending" &&
      requestId === `${record.skillStatus.turnIntentId}-request`
  );
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
      (appId, dataEpochId) => this.serverCutover.epochRoot(appId, dataEpochId)
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
  }

  configureLocale(locale: () => AppLocale) {
    this.locale = locale;
  }

  async initialize() {
    await Promise.all([
      this.buildLedger.initialize(),
      this.referenceJournal.initialize(),
      this.thirdPartyMcpPlans.initialize(),
      this.dataCutovers.initialize(),
      this.dataArchives.initialize(),
      this.baseGuiGrants.initialize(),
    ]);
    await this.serverCustody.initialize();
    await this.store.load();
    await this.serverLifecycle.reconcile();
    await this.gateway.start();
    await this.installer.initialize();
    await this.store.normalizeInterrupted();
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
      runtimeStatus: (appId) => this.runtimeStatus(appId),
      originWithoutStart: (appId) => this.originWithoutStart(appId),
      extensionStatus: (appId) => this.extensionStatus(appId),
      capabilities: (appId) => this.capabilities(appId),
      resolveExtensionConsent: (appId, granted) =>
        this.store.resolvePendingConsent(appId, granted),
      resolveBaseGuiConsent: (appId, granted) =>
        this.store.resolvePendingBaseGuiConsent(appId, granted),
      revokeBaseGuiAccess: (appId) => this.revokeBaseGuiAccess(appId),
      revokeExtensionGrant: (appId) => this.revokeExtensionGrant(appId),
      promoteGeneration: (appId, revision) =>
        this.withGuiCutover(appId, () =>
          this.store.promotePendingGeneration(appId, revision)
        ),
      rebuildExtensionGeneration: (appId) =>
        this.rebuildExtensionGeneration(appId),
      remove: (appId, mode, requestId) =>
        this.remove(appId, mode, requestId),
      readLogTail: (appId) => this.agentOperations.readLogTail(appId),
      setAgent: (input) => this.agentOperations.setAgent(input),
      rename: (input) => this.rename(input),
      ensureChatSlot: (input) => this.ensureChatSlot(input),
      guiInfo: (appId) => this.guiInfo(appId),
      resolveMaintenanceBackend: (agent) =>
        this.agentOperations.resolveMaintenanceBackend(agent),
      resolvePresetAgent: () => this.agentOperations.resolvePresetAgent(),
      onClosed: () => {
        this.window = null;
      },
    });
  }

  resolveApp(appId: string) {
    const record = this.store.get(appId);
    return record?.state === "ready"
      ? { dir: record.dir, name: record.manifest?.name ?? record.displayName }
      : undefined;
  }

  resolveAppForBinding(appId: string) {
    const record = this.store.get(appId);
    const pendingGeneration = record?.generations.find(
      (generation) =>
        generation.generationId === record.generationBinding.pending?.generationId
    );
    return record &&
      (record.state === "ready" ||
        (record.state === "creating" &&
          (record.manifest?.kind === "base" ||
            pendingGeneration?.manifest.kind === "base")))
      ? {
          dir: record.dir,
          name:
            record.manifest?.name ??
            pendingGeneration?.manifest.name ??
            record.displayName,
        }
      : undefined;
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
      publish: (record) => this.publishStatus(record),
      syncBase: options.renameBase,
      warn: (message, cause) => console.warn(`[apps] ${message}`, cause),
    });
    this.invalidateSkills = options.invalidateSkills;
  }

  configureAppDelete(service: AppDeleteService) {
    if (this.appDeleteService) throw new Error("App delete 已配置");
    this.appDeleteService = service;
  }

  async markDeleteStalled(appId: string, message: string) {
    if (!this.store.get(appId)) return;
    await updateAndEmitStatus(
      this.store,
      (event) => this.emit(event),
      appId,
      (value) => ({
        ...value,
        state: "delete-failed",
        lastError: { phase: "delete", message },
      })
    );
  }

  configureChatSlots(service: AppChatSlots) {
    if (this.chatSlots) throw new Error("App chat slots 已配置");
    this.chatSlots = service;
  }

  configureGrantAuthority(authority: AppGrantAuthority) {
    if (this.grantAuthority) throw new Error("App grant authority 已配置");
    this.grantAuthority = authority;
  }

  configureAttachmentFence(fence: AppAttachmentFence) {
    if (this.attachmentFence) throw new Error("App attachment fence 已配置");
    this.attachmentFence = fence;
  }

  configureSurfaceLeases(registry: AppAttachmentSurfaceLeaseRegistry) {
    if (this.surfaceLeases) throw new Error("App surface leases 已配置");
    this.surfaceLeases = registry;
  }

  configureManagementLeases(registry: AppManagementLeaseRegistry) {
    if (this.managementLeases) throw new Error("App management leases 已配置");
    this.managementLeases = registry;
  }

  describeManagementLease(managementLeaseId: string) {
    return this.requireManagementLeases().describe(managementLeaseId);
  }

  effectiveGrant(conversationId: string, appId: string) {
    return this.requireGrantAuthority().effectiveGrant(conversationId, appId);
  }

  describeSurface(surfaceLeaseId: string) {
    return this.requireSurfaceLeases().describe(surfaceLeaseId);
  }

  configureExtensions(
    integration: AppExtensionIntegration,
    participants: AppGenerationBuildParticipantRegistry
  ) {
    if (this.extensions) throw new Error("App extension integration 已配置");
    this.extensions = integration;
    this.buildParticipants = participants;
    this.thirdPartyMcpPlans.configure({
      acquire: (ref, owner) => integration.registry.acquireGenerationRef(ref, owner),
      release: (ref, owner) => integration.registry.releaseGenerationRef(ref, owner),
    });
    this.store.configureExtensionComposition(participants, integration.port);
    this.packages.configureExtensions(integration);
  }

  reconcileThirdPartyMcpPlans(activeRequestIds: ReadonlySet<string>) {
    return this.thirdPartyMcpPlans.reconcile(activeRequestIds);
  }

  extensionStatus(appId: string): AppExtensionStatus {
    const record = this.requireRecord(appId);
    if (!this.extensions) throw new Error("App extension integration 尚未配置");
    return projectAppExtensionStatus(
      record,
      this.extensions.registry,
      this.extensions.grants
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
    const record = this.store.get(appId);
    return Boolean(record && record.state !== "delete-failed");
  }

  listAppDirs() {
    return this.store.list().map((record) => record.dir);
  }

  async onAppTurnCompleted(
    appId: string,
    conversationId: string,
    requestId = ""
  ) {
    const record = this.store.get(appId);
    const action = appTurnCompletionAction(
      record?.domainIdentity ?? null,
      this.chatSlots?.roleOf(conversationId),
      isCreateSkillTurn(record, requestId)
    );
    if (action === "none") return;
    if (this.maintenanceGate.isLocked(appId)) {
      throw new Error("App 修复中，暂时不能应用编辑");
    }
    if (action === "rebuild") return this.installer.rebuildAfterEdit(appId);
    await this.syncBaseGuiRoute(appId).catch((cause) =>
      console.warn("[apps] base-gui route 同步失败", asError(cause))
    );
    this.emit({ appId, type: "gui" });
    return completeBaseAppSkill(appId, requestId, {
      store: this.store,
      publish: (saved) => this.publishStatus(saved),
      invalidate: this.invalidateSkills ?? undefined,
    });
  }

  async onAppTurnFailed(
    appId: string,
    conversationId: string,
    requestId = ""
  ) {
    const record = this.store.get(appId);
    const action = appTurnCompletionAction(
      record?.domainIdentity ?? null,
      this.chatSlots?.roleOf(conversationId),
      isCreateSkillTurn(record, requestId)
    );
    if (action !== "skill") return;
    return failBaseAppSkill(appId, requestId, {
      store: this.store,
      publish: (saved) => this.publishStatus(saved),
    });
  }

  readReadme(appId: string) {
    return this.packages.readReadme(this.requireRecord(appId));
  }

  publishStatus(record: AppRecord) {
    this.emit({ appId: record.id, type: "status", record });
  }

  isAllowedOrigin(origin: string) {
    return this.gateway.isRegisteredOrigin(origin);
  }

  isBaseGuiOrigin(origin: string) {
    return this.gateway.isBaseGuiOrigin(origin);
  }

  configureGuiApi(port: GuiBasePort) {
    this.gui.configureApi(port);
  }

  configureAppDataMigrations(port: AppDataMigrationPort) {
    this.dataMigrations.configure(port);
  }

  reconcileAppDataMigrations() {
    return this.dataMigrations.reconcileAll();
  }

  async syncBaseGuiRoute(appId: string) {
    let migrationFailure: unknown;
    await this.dataMigrations.reconcile(appId).catch((cause) => {
      migrationFailure = cause;
    });
    const result = await this.gui.sync(appId, { resetCapability: true });
    if (migrationFailure) throw migrationFailure;
    return result;
  }

  async guiInfo(appId: string): Promise<AppGuiInfo> {
    let migrationError = "";
    await this.dataMigrations.reconcile(appId).catch((cause) => {
      migrationError = asError(cause).message;
    });
    const info = await this.gui.info(appId);
    return migrationError ? { ...info, error: migrationError } : info;
  }

  guiPagesForApp(appId: string) {
    return this.gui.pagesForApp(appId);
  }

  getReactGrabInjection() {
    return this.gateway.getServerInjectionJavascript();
  }

  async shutdown() {
    await this.installer.shutdown();
    await this.runtime.shutdown();
    await this.serverCustody.close();
    await this.processCustody.closeAndFlush();
    await this.dataCutovers.closeAndFlush();
  }

  closeDeleteAdmission(appId: string) {
    return this.deleteCoordinator.closeAdmission(appId);
  }

  revokeDeleteCapabilities(appId: string) {
    return this.deleteCoordinator.revokeCapabilities(appId);
  }

  settleDeleteBuilds(appId: string) {
    return this.deleteCoordinator.settleBuilds(appId);
  }

  generationDrainCounts(appId: string, generationId: string) {
    return this.deleteCoordinator.generationDrainCounts(appId, generationId);
  }

  settleDeleteData(record: AppRecord, mode: RemoveAppMode) {
    return this.deleteCoordinator.settleData(record, mode);
  }

  removeBaseShell(record: AppRecord) {
    return this.deleteCoordinator.removeBaseShell(record);
  }

  acquireTurnApps(input: {
    conversationId: string;
    requestId: string;
    backendId: AgentBackendId;
    backendRuntimeIdentity: string;
    turnClass: ExtensionTurnIdentity["turnClass"];
    planMode: boolean;
    toolAccess: "none" | "read" | "mutate";
    baseToolsAvailability?: BaseToolsAvailability;
  }) {
    return this.turnCoordinator.acquire(input);
  }

  turnExtensionSkills(requestId: string) {
    return this.turnCoordinator.skills(requestId);
  }

  turnExtensionMcpServers(requestId: string) {
    return this.turnCoordinator.mcpServers(requestId);
  }

  turnCustodyDependencies(requestId: string) {
    return this.turnCoordinator.custodyDependencies(requestId);
  }

  isTurnReferenceActive(journalEntryId: string) {
    return this.referenceJournal.isActive(journalEntryId);
  }

  isTurnPlanActive(planInstanceId: string) {
    return this.thirdPartyMcpPlans.isActive(planInstanceId);
  }

  releaseTurnApps(requestId: string) {
    return this.turnCoordinator.release(requestId);
  }

  /**
   * generation/capability 的共同切换点：先撤 route/关新请求，再等所有 handler
   * Promise（包括已经进入 BaseStore 的 commit）归零，最后才 durable CAS 与重签。
   */
  private withGuiCutover<T>(appId: string, operation: () => Promise<T>) {
    return this.lifecycleGate.run(appId, async () => {
      this.gateway.requestLeases.closeAdmission(appId);
      try {
        await this.gui.revoke(appId);
        const deadline = Date.now() + 30_000;
        while (this.gateway.requestLeases.countApp(appId) > 0) {
          if (Date.now() >= deadline) {
            throw Object.assign(new Error("APP_GUI_DRAIN_TIMEOUT"), {
              status: 409,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        const result = await operation();
        await this.gui.sync(appId, { resetCapability: true });
        return result;
      } catch (cause) {
        await this.gui.sync(appId, { resetCapability: true }).catch(() => {});
        throw cause;
      } finally {
        this.gateway.requestLeases.reopenAdmission(appId);
      }
    });
  }

  private async revokeBaseGuiAccess(appId: string) {
    const record = this.requireRecord(appId);
    const generationId = record.generationBinding.active?.generationId;
    const generation = record.generations.find(
      (item) => item.generationId === generationId
    );
    if (!generationId || generation?.manifest.kind !== "base") {
      throw new Error("App 没有 active Base GUI generation");
    }
    return this.withGuiCutover(appId, async () => {
      await this.baseGuiGrants.revoke(appId, generationId);
      return this.store.advanceLifecycle(appId);
    });
  }

  private async revokeExtensionGrant(appId: string) {
    const record = this.requireRecord(appId);
    const generationId = record.generationBinding.active?.generationId;
    if (!generationId || !this.extensions) {
      throw new Error("App 没有 active extension generation");
    }
    await this.extensions.grants.revoke(appId, generationId);
    return this.extensionStatus(appId);
  }

  private async rebuildExtensionGeneration(appId: string) {
    const saved = await this.store.migrateGeneration(appId, randomUUID());
    this.publishStatus(saved);
    return saved;
  }

  private async stopApp(appId: string) {
    await this.runtime.stop(appId);
    await this.gui.revoke(appId);
  }

  private runtimeStatus(appId: string): AppRuntimeStatus {
    const record = this.requireRecord(appId);
    const generationId = record.generationBinding.active?.generationId ?? null;
    const generation = record.generations.find(
      (item) => item.generationId === generationId
    );
    const running = this.runtime.isRunning(appId);
    return {
      appId,
      state: record.state,
      lifecycleRevision: record.lifecycleRevision,
      generationId,
      contentDigest: generation?.contentDigest ?? null,
      runtime: running
        ? "running"
        : record.lastError?.phase === "start"
          ? "crashed"
          : "stopped",
      activationId:
        running && generationId
          ? `activation:${appId}:${generationId}`
          : null,
      origin: running ? this.runtime.getOrigin(appId) : null,
      quarantined: record.state === "quarantined",
    };
  }

  private originWithoutStart(appId: string) {
    if (!this.runtime.isRunning(appId)) return null;
    const generationId =
      this.requireRecord(appId).generationBinding.active?.generationId;
    return {
      origin: this.runtime.getOrigin(appId),
      ...(generationId
        ? {
            generationId,
            activationId: `activation:${appId}:${generationId}`,
          }
        : {}),
    };
  }

  private async remove(appId: string, mode?: RemoveAppMode, requestId = "") {
    if (this.maintenanceGate.isLocked(appId)) {
      throw new Error("App 修复中，暂时不能删除");
    }
    this.requireRecord(appId);
    const service = this.appDeleteService;
    if (!service) throw new Error("App delete 尚未初始化");
    if (!mode || !requestId) throw new Error("App 删除参数不完整");
    try {
      await service.remove({ appId, mode, requestId });
    } catch (cause) {
      const status = (cause as { status?: number }).status;
      const stalled =
        status === 409 && (await service.residual(appId)) !== null;
      if (
        shouldMarkDeleteFailed({
          status,
          state: this.store.get(appId)?.state,
          hasResidual: stalled,
        })
      ) {
        await this.markDeleteStalled(
          appId,
          stalled
            ? "上一次删除中断后未收尾，用「重试删除残留」续跑同一事务"
            : asError(cause).message
        );
      }
      throw cause;
    }
  }

  private rename(input: RenameAppInput) {
    if (!this.renamer) throw new Error("Base App 改名尚未初始化");
    return this.renamer.rename(input);
  }

  private ensureChatSlot(input: EnsureAppChatSlotInput) {
    if (!this.chatSlots) throw new Error("App chat slots 尚未初始化");
    return this.chatSlots.ensure(input);
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
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(APPS_CHANNEL.event, event);
    }
  }
}
