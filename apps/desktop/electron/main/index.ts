/**
 * [INPUT]: Depends on Electron lifecycle, Node filesystem, shared five-locale translation, and every main-owned service, including signed-update compatibility, scoped Extensions, Project cleanup/Tools, Agent policy, Chat continuation recovery, coordinator/custody, Apps, Design, browser, and usage
 * [OUTPUT]: Provides the desktop composition root, pre-Project App authority repair, signed candidate preflight, App Query snapshot wiring, scoped inventory and Project Tools wiring, Chat Home/SQLite continuation reconciliation, post-reconciliation external-history sync, the periodic chat-store maintenance gate, cleanup participants, recovery order, windows, and two-phase shutdown
 * [POS]: The root lifecycle owner of the desktop main process
 */
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog } from "electron";
import { AppsService } from "./apps/apps-service";
import { ChatStore } from "./chats/chat-store";
import type { ChatsService } from "./chats/chats-service";
import {
  reopenTitleGenerators,
  shutdownTitleGenerators,
  stopTitleGeneratorAdmission,
} from "./chats/title-generator";
import {
  cancelConversations,
  cancelAgentRequests,
  hasConversationActivity,
  hasActiveImageOccurrence,
  recoverAfterFailedShutdown,
  releaseThreadScopeForConversation,
  seedThreadScope,
  shutdownAllAgents,
} from "./agent-bridge";
import { asError } from "./errors";
import { FileAuthorizationStore } from "./file-authorizations";
import { initializeAgentInputStaging } from "./agent-input";
import {
  SkillsCatalog,
  type WorkspaceResolver,
} from "./skills-catalog";
import {
  createEffectiveWorkspaceResolver,
  createWorkspaceResolver,
} from "./workspace-resolver";
import { WorkspaceFileCatalog } from "./workspace-files";
import { SettingsStore } from "./settings-store";
import { resolveAppLocale } from "../../shared/i18n/locale";
import { resolvePlatformCapabilities } from "../../shared/platform-capabilities";
import { BackendSetupService } from "./setup/backend-setup";
import { runStateResetsThroughV6 } from "./state-reset";
import { ProjectStore } from "./projects/store/project-store";
import { ProjectsService } from "./projects/projects-service";
import { composeProjectsService } from "./projects/composition";
import { RelayLedger } from "./sections/coordinator/relay-ledger";
import type { ConversationCoordinator } from "./sections/coordinator/conversation-coordinator";
import { BaseStore } from "./bases/base-store";
import { BasesService } from "./bases/bases-service";
import { LifecycleIntentStore } from "./lifecycle/intent-store";
import { configureAppMode } from "./apps/app-mode";
import { AgentPluginInventory } from "./extensions/agent-plugin-inventory";
import { sweepAppStaging } from "./apps/staging-sweep";
import { createBuiltinToolsets } from "./builtin-toolsets";
import { BuiltinMcpBridge } from "./tools/bridge";
import type { AgentTurnCustodyJournal } from "./backends/agent-turn-custody-journal";
import type { AgentTurnCustodyRuntime } from "./backends/agent-turn-custody-runtime";
import { BuiltinMcpLeaseStore } from "./tools/lease";
import { BuiltinToolRegistry } from "./tools/registry";
import { UsageService } from "./usage/usage-service";
import type { MemoryService } from "./memory/service/memory-service";
import type { ManagedRuntimeRegistry } from "./memory/runtime/managed-registry";
import type { MemorySettingsOwner } from "./memory/service/settings-owner";
import type { MemoryLifecycleOrchestrator } from "./memory/runtime/control/lifecycle-orchestrator";
import { rotateAcpTraces } from "./backends/acp/trace";
import { configurePermissions } from "./window/security";
import { applyThemeSource } from "./window/native-theme";
import { applyDevelopmentDockIcon } from "./window/app-icon";
import { ChatHomeLedger } from "./chat-home/chat-home-ledger";
import { ChatHomeService } from "./chat-home/chat-home-service";
import { liveChatHomeIntentIds } from "./chat-home/recovery-live-intents";
import type { ArchiveService } from "./archive/archive-service";
import { initializeGalleryRuntime, type GalleryRuntime } from "./gallery/bootstrap";
import { ConversationDeletionCoordinator } from "./deletion/conversation-deletion-coordinator";
import { defaultChromeRoot, installBrowserPanel, type BrowserRuntime } from "./browser/bootstrap";
import type { HistoryImportService } from "./history-import/service";
import { GlobalSearchService } from "./search/job-service";
import { registerAllCatalogs } from "../../shared/i18n/resources";
import { translate } from "../../shared/i18n/runtime";
import {
  createArchiveService,
  createChatsService,
  createConversationCoordinator,
  createManualTurnPreparer,
  reconcileAdoptedContinuationRuntime,
} from "./startup/conversation-runtime";
import { initializeHistoryImportService } from "./startup/history-import-runtime";
import { createUnifiedSkillsService } from "./startup/unified-skills-runtime";
import type { UnifiedSkillsService } from "./skills-management/service";
import { runSkillsCutover } from "./skills-management/cutover";
import { SkillsTurnCustodyStore } from "./skills-management/turn-custody";
import { PreparedSkillReferenceLedger } from "./skills-management/prepared-reference-ledger";
import { configurePreparedSkillReferenceCustody } from "./sections/coordinator/admission/prepared-manual-turn";
import type { ExtensionRegistryStore } from "./extensions/registry-store";
import {
  createMainWindowLauncher,
  installAppGuiE2eDriver,
  installBrowserE2eDriver,
  installDesignE2eDriver,
} from "./startup/main-window-runtime";
import { reopenStoppedChatDependencies, ShutdownRecoveryGate } from "./startup/shutdown-recovery";
import { createDesktopUpdateService } from "./update/composition";
import type { UpdateService } from "./update/service";
import { installApplicationQuit } from "./startup/application-quit";
import { closeTerminalOwnerSequence } from "./startup/terminal-owner-sequence";
import { windowRegistry } from "./window/surfaces/window-registry";
import { surfaceWindowController } from "./window/surfaces/surface-window-controller";
import {
  continueMemoryRebuildRecovery,
  initializeMemoryRuntime,
  recoverAgentTurnCustody,
  reportLifecycleReconciliation,
} from "./startup/recovery-runtime";
import { ProjectToolsRuntime } from "./startup/project-tools-runtime";
import { createBaseFileDialogs } from "./startup/base-file-dialogs";
import { startChatStoreMaintenance, stopChatStoreMaintenance } from "./startup/chat-store-maintenance";
import {
  classifyLegacyBaseNavigation,
  InformationArchitectureStartup,
  runRequiredProjectPlacementGate,
} from "./startup/information-architecture-startup";
import { presentAppAuthorityRepair } from "./startup/app-authority-repair";
import { configureAppBaseRuntime } from "./startup/app-base-runtime";
/* main 无首包预算，故一次性投喂全部五语言，`translate()` 保持同步。
   放在组合根的模块作用域：晚于它的任何 translate 都已有母语目录，早于
   它的则退化为英文而非裸 key——降级方向由 runtime 的英文常驻担保。 */
registerAllCatalogs();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
let appsService: AppsService | null = null;
let chatStore: ChatStore | null = null;
let chatsService: ChatsService | null = null;
let baseStore: BaseStore | null = null;
let basesService: BasesService | null = null;
let projectStore: ProjectStore | null = null;
let projectsService: ProjectsService | null = null;
let projectToolsRuntime: ProjectToolsRuntime | null = null;
let settingsStore: SettingsStore | null = null;
let skillsCatalog: SkillsCatalog | null = null;
let unifiedSkillsService: UnifiedSkillsService | null = null;
let extensionRegistry: ExtensionRegistryStore | null = null;
let skillsTurnCustody: SkillsTurnCustodyStore | null = null;
let fileAuthorizations: FileAuthorizationStore | null = null;
let workspaceResolver: WorkspaceResolver | null = null;
let workspaceFiles: WorkspaceFileCatalog | null = null;
let builtinLeases: BuiltinMcpLeaseStore | null = null;
let builtinBridge: BuiltinMcpBridge | null = null;
let turnCustodyJournal: AgentTurnCustodyJournal | null = null;
let turnCustody: AgentTurnCustodyRuntime | null = null;
let relayLedger: RelayLedger | null = null;
let sectionCoordinator: ConversationCoordinator | null = null;
let usageService: UsageService | null = null;
let memoryService: MemoryService | null = null;
let memoryRuntimes: ManagedRuntimeRegistry | null = null;
let memorySettingsOwner: MemorySettingsOwner | null = null;
let memoryLifecycle: MemoryLifecycleOrchestrator | null = null;
let chatHomeLedger: ChatHomeLedger | null = null;
let chatHomeService: ChatHomeService | null = null;
let archiveService: ArchiveService | null = null;
let galleryEvents: GalleryRuntime["events"] | null = null;
let galleryMediaCache: GalleryRuntime["cache"] | null = null;
let galleryMediaService: GalleryRuntime["media"] | null = null;
let deletionCoordinator: ConversationDeletionCoordinator | null = null;
let browserRuntime: BrowserRuntime | null = null;
let lifecycleIntents: LifecycleIntentStore | null = null;
let historyImport: HistoryImportService | null = null;
let globalSearch: GlobalSearchService | null = null;
let updateService: UpdateService | null = null;
const currentLocale = () => resolveAppLocale(
  settingsStore?.get().language ?? "auto", app.getPreferredSystemLanguages()
);
const setupService = new BackendSetupService(currentLocale);

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const main = windowRegistry.main();
    if (main) windowRegistry.focus(main.windowId);
  });

  void app
    .whenReady()
    .then(async () => {
      applyDevelopmentDockIcon();
      const userData = app.getPath("userData");
      const platformSupport = resolvePlatformCapabilities(process.platform);
      const traceDirectory = join(userData, "debug", "acp-trace");
      try {
        rotateAcpTraces(traceDirectory);
      } catch (cause) {
        console.warn("[acp-trace] startup cleanup unavailable", cause);
      }
      await runStateResetsThroughV6(userData);
      const titleWorkspace = join(userData, "codex-workspace");
      const agentInputStagingRoot = join(userData, "agent-input-staging");
      await mkdir(titleWorkspace, { recursive: true });
      const canonicalUserData = await realpath(userData);
      updateService = createDesktopUpdateService(app, () => safeQuit.prepare("update"), process.env, (matrix) => {
        if (!appsService) throw new Error("GUI_COMPATIBILITY_PREFLIGHT_UNAVAILABLE");
        return appsService.applyCandidateCompatibility(matrix);
      });
      browserRuntime = installBrowserPanel(
        defaultChromeRoot(app.getPath("home"))
      );
      await initializeAgentInputStaging(agentInputStagingRoot);
      appsService = new AppsService(userData);
      appsService.configureLocale(currentLocale);
      usageService = new UsageService(userData, {
        pricingRefreshEnabled: () =>
          settingsStore?.get().usagePricingAutoRefresh ?? true,
      });
      settingsStore = new SettingsStore(userData);
      projectStore = new ProjectStore(userData);
      projectToolsRuntime = await ProjectToolsRuntime.create(userData, projectStore);
      projectsService = composeProjectsService({
        store: projectStore,
        resourceCleanup: projectToolsRuntime.resourceCleanup,
        userData: canonicalUserData,
        apps: () => appsService,
        chats: () => chatsService,
        chatStore: () => chatStore,
        bases: () => basesService,
        memory: () => memoryService,
        deletions: () => deletionCoordinator,
        hasPendingProjectCreation: (projectId) =>
          sectionCoordinator?.hasPendingProjectCreation(projectId) ?? false,
        isProjectOpen: (projectId) =>
          archiveService?.isProjectOpen(projectId) ?? true,
        localDetachReasons: (projectId) => {
          if (!basesService || !settingsStore) {
            throw new Error("Project 移除依赖尚未初始化");
          }
          return [
            ...(basesService.hasProjectBase(projectId)
              ? (["project-base"] as const)
              : []),
            ...(settingsStore.get().memory.sharingMode === "group"
              ? (["group-memory"] as const)
              : []),
          ];
        },
        locale: currentLocale,
      });
      chatStore = new ChatStore(userData, {
        isAppProject: (projectId) =>
          projectStore?.get(projectId)?.workspaceBinding.kind === "app",
        appForProject: (projectId) => {
          const binding = projectStore?.get(projectId)?.workspaceBinding;
          if (binding?.kind !== "app") return null;
          return {
            appId: binding.appId,
            editableSource: Boolean(
              appsService?.store.get(binding.appId)?.editableSource
            ),
          };
        },
      });
      if ((await appsService.initialize()) === "degraded-corrupt")
        return presentAppAuthorityRepair(appsService.store, currentLocale());
      const informationArchitectureMigration =
        await InformationArchitectureStartup.create(userData);
      await informationArchitectureMigration.appFacts(appsService.store.list());
      /* 上一条命的 backend 必须先收敛；否则空的内存引用会误导
         App/Extension 回收仍被活进程使用的 generation。 */
      const recoveredCustody = await recoverAgentTurnCustody({
        userData,
        mainDirectory: __dirname,
        apps: appsService,
        chats: chatStore,
      });
      turnCustodyJournal = recoveredCustody.journal;
      turnCustody = recoveredCustody.runtime;
      const custodyReport = recoveredCustody.report;
      await settingsStore.initialize();
      /* 必须先于建窗：renderer 首个同步脚本读的 matchMedia 就是这里投影的
         结果，先设 themeSource 才有「深色启动不闪白」。 */
      applyThemeSource(settingsStore.get().theme);
      let disabledToolsSignature = settingsStore
        .get()
        .disabledBuiltinTools.join("\0");
      settingsStore.onChanged(({ settings }) => {
        applyThemeSource(settings.theme);
        const nextSignature = settings.disabledBuiltinTools.join("\0");
        if (nextSignature === disabledToolsSignature) return;
        disabledToolsSignature = nextSignature;
        skillsCatalog?.invalidate();
      });
      await projectStore.initialize();
      await informationArchitectureMigration.projects(projectStore.list());
      await projectToolsRuntime.initialize(settingsStore);
      await projectsService.initialize();
      await chatStore.initialize();
      lifecycleIntents = new LifecycleIntentStore(userData);
      await lifecycleIntents.initialize();
      const galleryRuntime = await initializeGalleryRuntime(
        userData,
        chatStore,
        hasActiveImageOccurrence
      );
      galleryMediaCache = galleryRuntime.cache;
      galleryEvents = galleryRuntime.events;
      galleryMediaService = galleryRuntime.media;
      deletionCoordinator = new ConversationDeletionCoordinator(
        join(userData, "deletion-journal")
      );
      chatHomeLedger = new ChatHomeLedger(userData);
      chatHomeService = new ChatHomeService(
        settingsStore,
        chatStore,
        chatHomeLedger
      );
      await chatHomeService.initialize();
      const memoryRuntime = await initializeMemoryRuntime({
        userData,
        platformSupport,
        chats: chatStore,
        settings: settingsStore,
        projects: projectsService,
      });
      memoryRuntimes = memoryRuntime.runtimes;
      memoryService = memoryRuntime.service;
      memorySettingsOwner = memoryRuntime.settingsOwner;
      memoryLifecycle = memoryRuntime.lifecycle;
      historyImport = await initializeHistoryImportService({
        userData,
        home: app.getPath("home"),
        projects: projectsService,
        projectStore,
        chats: chatStore,
        settings: settingsStore,
        memory: memoryService,
        getCoordinator: () => sectionCoordinator,
        getChats: () => chatsService,
      });
      baseStore = new BaseStore(userData);
      await baseStore.initialize(
        new Map(
          chatStore
            .listBaseIdentities()
            .map((identity) => [identity.chatId, identity])
        ),
        new Set(projectStore.list().map((project) => project.id)),
        (meta) => classifyLegacyBaseNavigation(meta, (id) => projectStore!.get(id))
      );
      await informationArchitectureMigration.bases(baseStore.listAll());
      await informationArchitectureMigration.chats(chatStore.list());
      globalSearch = new GlobalSearchService(
        chatStore,
        baseStore,
        (projectId) => projectStore!.get(projectId)?.archivedAt
      );
      basesService = new BasesService(baseStore, {
        getChat: async (chatId) => chatStore!.getChatRef(chatId),
        getProject: (projectId) => projectStore!.get(projectId),
        onRetainedBaseRemoved: async (projectId) => {
          await projectsService!.cleanupBaseCustody(projectId).catch((cause) =>
            console.error(
              `[projects] retained Base custody cleanup (${projectId}) failed; startup will retry`,
              cause
            )
          );
        },
        ...createBaseFileDialogs(dialog, currentLocale),
      });
      await galleryRuntime.connectBases(basesService);
      await configureAppBaseRuntime({
        apps: appsService,
        projects: projectStore,
        bases: basesService,
      });
      const builtinSocket = join(userData, "builtin-tools", "bridge.sock");
      builtinLeases = new BuiltinMcpLeaseStore(
        builtinSocket,
        join(__dirname, "builtin-tools-server.js")
      );
      const activeBuiltinLeases = builtinLeases;
      const resolveEffectiveWorkspace = createEffectiveWorkspaceResolver(
        appsService,
        projectsService,
        chatStore,
        titleWorkspace
      );
      appsService.configureDesignWorkspace(
        resolveEffectiveWorkspace,
        (chatId) => chatStore!.getIncarnationId(chatId)
      );
      workspaceResolver = createWorkspaceResolver(resolveEffectiveWorkspace);
      workspaceFiles = new WorkspaceFileCatalog(resolveEffectiveWorkspace, {
        getChatIncarnation: (chatId) => chatStore!.getIncarnationId(chatId),
      });
      fileAuthorizations = new FileAuthorizationStore();
      /* catalog 构造早于 extensions 装配，所以候选源是懒读的闭包：catalog 不
         认识 Registry，Registry 也不反向持有 catalog。 */
      skillsCatalog = new SkillsCatalog(workspaceResolver, {
        disabledTools: () => settingsStore!.get().disabledBuiltinTools,
        managedSkills: (projectContext) =>
          unifiedSkillsService?.effectiveCandidates(projectContext) ??
          Promise.resolve([]),
        toolPolicyForScope: projectToolsRuntime.skillPolicy(chatStore),
      });
      projectToolsRuntime.connectSkills(skillsCatalog);
      skillsCatalog.setProductSkillGateResolver((path) =>
        appsService!.design.skillEnabledForPath(path)
      );
      chatsService = createChatsService({
        userData,
        titleWorkspace,
        store: chatStore,
        chatHomes: chatHomeService,
        projects: projectsService,
        projectStore,
        apps: appsService,
        bases: basesService,
        browser: browserRuntime,
        galleryCache: galleryMediaCache,
        memory: memoryService,
        settings: settingsStore,
        deletions: deletionCoordinator,
        getCoordinator: () => sectionCoordinator,
        getArchive: () => archiveService,
        getRelayLedger: () => relayLedger,
        getHistoryImport: () => historyImport,
      });
      const prepareManualSubmission = createManualTurnPreparer({
        stagingRoot: agentInputStagingRoot,
        chatHomes: chatHomeService,
        projects: projectsService,
        chatStore,
        chats: chatsService,
        readSectionAttachment: (sectionId, attachmentId) =>
          chatsService!.readSectionAttachment(sectionId, attachmentId),
        resolveWorkspace: workspaceResolver,
        skills: skillsCatalog,
        extensionInventoryVersion: (projectContext) => {
          if (!extensionRegistry) {
            throw new Error("Extension Registry 尚未初始化");
          }
          return extensionRegistry.visibleInventory(projectContext)
            .visibleInventoryVersion;
        },
        files: fileAuthorizations,
        resolveProjectTools: (input) => projectToolsRuntime!.resolver.resolve(input),
        histories: {
          export: (opaqueId) => historyImport!.exportTranscript(opaqueId),
        },
      });
      relayLedger = new RelayLedger(userData);
      sectionCoordinator = createConversationCoordinator({
        ledger: relayLedger,
        chats: chatsService,
        settings: settingsStore,
        memory: memoryService,
        workspaceFiles,
        stagingRoot: agentInputStagingRoot,
        prepareManual: prepareManualSubmission,
        lifecycleIntents,
        projects: projectsService,
        projectStore,
        galleryMedia: galleryMediaService,
        getArchive: () => archiveService,
      });
      await sectionCoordinator.initialize(false);
      const [chatReferences, custodyReferences] = await Promise.all([
        chatStore.adoptionReferenceProjection(),
        relayLedger.adoptionReferenceProjection(),
      ]);
      await historyImport.snapshots.gcAdoptionOrphans({
        complete: chatReferences.complete && custodyReferences.complete,
        refs: new Set([...chatReferences.refs, ...custodyReferences.refs]),
      });
      const appMode = configureAppMode({
        apps: appsService,
        projects: projectsService,
        projectStore,
        chats: chatsService,
        chatStore,
        bases: basesService,
        baseStore,
        intents: lifecycleIntents,
        coordinator: sectionCoordinator,
        skills: skillsCatalog,
        settings: settingsStore,
        locale: currentLocale,
        hasConversationActivity,
        isConversationAvailable: (chatId) =>
          archiveService?.isConversationAvailable(chatId) ?? true,
        cancelConversations,
        cancelAgentRequests,
        skillsTurnCustody: () => skillsTurnCustody,
        bindThreadScope: seedThreadScope,
        releaseThreadScope: releaseThreadScopeForConversation,
      });
      const preparedSkillRefs = new PreparedSkillReferenceLedger(
        userData,
        appMode.extensions.registry
      );
      configurePreparedSkillReferenceCustody({
        acquire: (ownerId, refs) => preparedSkillRefs.prepare(ownerId, refs),
        release: (ownerId, refs) => preparedSkillRefs.release(ownerId, refs),
        assertReady: (ownerId, refs) => preparedSkillRefs.assertReady(ownerId, refs),
      });
      /* Registry/reservation/grant 三本账必须在任何 build、plan 或 lifecycle 恢复
         之前就绪：reconcileRefs 要重新拿住仍被引用的 package generation。 */
      await appMode.extensions.initialize({
        afterRegistryInitialize: async () => {
          await preparedSkillRefs.initialize();
          await preparedSkillRefs.reconcile(
            new Set(
              sectionCoordinator!
                .preparedSkillSelections()
                .map(({ receipt }) => receipt.refOwnerId)
            )
          );
        },
      });
      extensionRegistry = appMode.extensions.registry;
      await projectsService.recoverResourceCleanup();
      await runSkillsCutover({
        userData,
        registry: appMode.extensions.registry,
      });
      unifiedSkillsService = await createUnifiedSkillsService({
        userData,
        userHome: app.getPath("home"),
        env: process.env,
        extensions: appMode.extensions,
        catalog: skillsCatalog,
        custodyReferenced: (packageDirectory) =>
          skillsTurnCustody?.referencesPackageDirectory(packageDirectory) ?? false,
        chooseLocalFolder: async () => {
          const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
          return result.canceled ? null : result.filePaths[0] ?? null;
        },
      });
      skillsTurnCustody = new SkillsTurnCustodyStore(
        userData,
        unifiedSkillsService.library,
        appMode.extensions.registry
      );
      await skillsTurnCustody.initialize();
      await appsService.reconcileThirdPartyMcpPlans(
        new Set(custodyReport.quarantined.map((entry) => entry.turnRequestId))
      );
      /* 启动只等待 journal 扫描与 fence 发布；网络/drain/资源 saga 在后台续跑。
         一个慢 provider 不再把主窗口建成删除任务的进度条。 */
      await chatsService.recoverDeletions(false);
      const liveManualIntentIds = Object.values(
        relayLedger.snapshot().manualIntents
      )
        .filter((intent) =>
          ["queued", "appended", "claimed"].includes(intent.phase)
        )
        .map((intent) => intent.id);
      await chatHomeService.recoverCreations(
        liveChatHomeIntentIds(
          liveManualIntentIds,
          await lifecycleIntents.listPending()
        )
      );
      await reconcileAdoptedContinuationRuntime(
        chatStore, chatHomeService, chatsService, liveManualIntentIds,
      );
      /* 外源同步必须排在续聊对账之后：抢先激活的新代际会让 pending 的
         continuation.finalize 撞上代际围栏，saga 被隔离、Home 变孤儿。 */
      historyImport.startBackgroundSync();
      archiveService = createArchiveService({
        userData,
        chatStore,
        projectStore,
        chatHomes: chatHomeService,
        coordinator: sectionCoordinator,
        chats: chatsService,
        projects: projectsService,
        baseStore,
        memory: memoryService,
        memoryLifecycle,
        settings: settingsStore,
      });
      await archiveService.initialize();
      /* 所有 Project runtime handler 与 retained-resource participant 都已在此刻
         重建；现在自动续跑删除 checkpoint，不等待 renderer 再点一次删除。 */
      for (const failure of await projectsService.cleanupEmptyBaseCustody()) {
        console.error(
          `[projects] empty Base custody cleanup (${failure.projectId}) failed: ${failure.message}`
        );
      }
      for (const failure of await projectsService.recoverResourceCleanup()) {
        console.error(
          `[projects] cleanup ${failure.operation}(${failure.projectId}) 启动恢复失败：${failure.message}`
        );
      }
      const lifecycleReport = await runRequiredProjectPlacementGate({
        recoverLifecycle: () => appMode!.reconciliation.run(),
        appAuthority: () => appsService!.store.authorityState(),
        liveAppIds: () =>
          new Set(appsService!.store.list().map((record) => record.id)),
        reconcile: (liveAppIds) =>
          projectsService!.runExclusive(() =>
            projectsService!.reconcileOrphanAppPlacementsHeld(liveAppIds)
          ),
        publish: (projectIds) =>
          projectsService!.publishProjectUpserts(projectIds),
      });
      reportLifecycleReconciliation(lifecycleReport);
      await informationArchitectureMigration.complete({
        apps: appsService.store.list(),
        projects: projectStore.list(),
        bases: baseStore.listAll(),
        chats: chatStore.list(),
      });
      await appMode.saveAsApp.recoverPendingSkills();
      // probe/share/preset staging 的内存映射不跨进程：pending intent 之外的
      // 一律孤儿（pending 配置副本含 secret），失败只警告不阻断启动
      await sweepAppStaging(userData, lifecycleIntents).catch((cause) =>
        console.warn("[apps] staging 孤儿清扫失败，待下次启动重试", cause)
      );
      await appsService.ensureDesignFactory().catch((cause) =>
        console.error("[design] factory provisioning 未完成，将保持禁用并于下次启动重试", cause)
      );
      sectionCoordinator.reopenAdmission();
      memoryService.completeStartup();
      const activeCoordinator = sectionCoordinator;
      const agentPluginInventory = new AgentPluginInventory(userData);
      const toolRegistry = new BuiltinToolRegistry(
        ...createBuiltinToolsets({
          chatStore,
          chatsService,
          coordinator: activeCoordinator,
          basesService,
          baseStore,
          projectsService,
          appsService,
          archiveService,
          browserService: browserRuntime.service,
          browserHarness: browserRuntime.harness,
          agentPlugins: agentPluginInventory,
          skillsCustody: skillsTurnCustody,
        })
      );
      installBrowserE2eDriver(toolRegistry, (chatId) =>
        chatStore?.getIncarnationId(chatId)
      );
      installAppGuiE2eDriver(appsService);
      installDesignE2eDriver(
        appsService,
        resolveEffectiveWorkspace,
        toolRegistry,
        (chatId) => chatStore?.getIncarnationId(chatId)
      );
      builtinBridge = new BuiltinMcpBridge(
        builtinSocket,
        builtinLeases,
        toolRegistry
      );
      await builtinBridge.start();
      const sweep = await chatsService.sweepAttachments();
      if (sweep.warning) chatStore.pushWarning(sweep.warning);
      for (const binding of chatStore.listBindings()) {
        seedThreadScope(
          binding.session,
          binding.chatId
        );
      }
      configurePermissions(appsService);
      const openMainWindow = createMainWindowLauncher({
        mainDirectory: __dirname,
        apps: appsService,
        extensions: appMode.extensions,
        setup: setupService,
        projects: projectsService,
        projectStore,
        projectToolPolicies: projectToolsRuntime.policies,
        chats: chatsService,
        bases: basesService,
        settings: settingsStore,
        manualMcpServers: projectToolsRuntime.manualMcpServers,
        traceDirectory,
        agentInputStagingRoot,
        skills: skillsCatalog,
        unifiedSkills: unifiedSkillsService,
        skillsCustody: skillsTurnCustody,
        files: fileAuthorizations,
        workspaceFiles,
        resolveWorkspace: workspaceResolver,
        builtinLeases: activeBuiltinLeases,
        turnCustody: turnCustody!,
        coordinator: activeCoordinator,
        usage: usageService,
        memory: memoryService,
        memoryRuntimes,
        memorySettingsOwner,
        chatHomes: chatHomeService,
        archive: archiveService,
        galleryMedia: galleryMediaService,
        galleryEvents,
        browser: browserRuntime,
        historyImport,
        globalSearch,
        update: updateService,
      });
      openMainWindow();
      startChatStoreMaintenance(chatStore);
      updateService.start();
      if (platformSupport.capabilities.memory) {
        continueMemoryRebuildRecovery(memoryService);
      }
      /* 注册这一句本身就是「服务全就绪」的证明：它排在全部装配之后，任何
         中途返回都到不了这里。此前那串十八项 `&&` 因此恒为真——它读起来
         像一道闸门，实际上只是同一件事的第二种说法。 */
      app.on("activate", () => {
        if (!windowRegistry.main()) openMainWindow();
      });
    })
    .catch((cause) => {
      const error = asError(cause);
      console.error("[main] initialization failed", error);
      dialog.showErrorBox(
        translate(currentLocale(), "settings.native.startupFailureTitle"),
        translate(currentLocale(), "settings.native.startupFailureMessage", {
          detail: error.message,
        })
      );
      app.quit();
    });
}

const shutdownRecovery = new ShutdownRecoveryGate();

function stopChatAdmission() {
  /* 先关准入再 flush：退出链里绝不能再产生新的 dispatch，否则 flush 完成之后
     还会有一个刚起来的 backend 进程拿着已经写完的账本。 */
  stopChatStoreMaintenance();
  sectionCoordinator?.stopAdmission();
  builtinBridge?.stopAdmission();
  basesService?.stopAdmission();
  chatsService?.stopAdmission();
  projectsService?.stopAdmission();
  stopTitleGeneratorAdmission();
  memoryService?.stopAdmission();
  turnCustody?.closeAdmission();
  surfaceWindowController.stopAdmission();
}

async function reopenChatDependencies() {
  await reopenStoppedChatDependencies(
    [memoryService],
    reopenTitleGenerators,
    projectsService,
    [chatsService, basesService, builtinBridge],
    turnCustody
  );
}

async function closeTerminalOwners() {
  await closeTerminalOwnerSequence({
    irreversible: () => shutdownRecovery.runIrreversible(() => {
      chatsService?.closeAdmission(); basesService?.closeAdmission();
      skillsCatalog?.clear(); workspaceFiles?.clear(); fileAuthorizations?.clear();
    }),
    memory: memoryService, skillsTurnCustody, unifiedSkills: unifiedSkillsService,
    projects: projectsService, historyImport, shutdownTitles: shutdownTitleGenerators,
    chats: chatsService, browser: browserRuntime, bases: basesService,
    relay: relayLedger, archive: archiveService, lifecycleIntents,
    chatStore, chatHome: chatHomeLedger, projectStore, settings: settingsStore,
    usage: usageService, setup: setupService, apps: appsService, turnCustody,
    turnCustodyJournal, builtinBridge, update: updateService,
  });
}

const safeQuit = installApplicationQuit(app, dialog, {
  stopAdmission: stopChatAdmission,
  settleWindows: () => surfaceWindowController.settleAll(),
  quiesceAgents: () => shutdownAllAgents(),
  closeOwners: closeTerminalOwners,
  recover: (reason) =>
    shutdownRecovery.recover(
      reopenChatDependencies,
      recoverAfterFailedShutdown,
      () => {
        sectionCoordinator?.reopenAdmission();
        surfaceWindowController.reopenAdmission();
      },
      (cause) => console.error(`[shutdown:${reason}] recovery failed`, cause)
    ),
  report: (reason, phase, cause) =>
    console.error(`[shutdown:${reason}] ${phase} phase failed`, cause),
}, currentLocale);
