/**
 * [INPUT]: Depends on Electron lifecycle, Node filesystem, installation-scoped device identity, on-demand English-plus-active-locale translation, and every main-owned service, including signed-update compatibility, scoped Extensions, Project cleanup/Tools, Agent policy, Chat continuation recovery, coordinator/custody, Apps, Design, browser, local usage history, account quota service seeded from its durable last-known snapshot, presence lifecycle/composition and crash-aware main readiness, and the build-gated cloud account lifecycle with consent restoration, cross-Store cleanup and original-coordinator remote intake.
 * [OUTPUT]: Provides the desktop composition root with parallel pre-window store initialization, the two-phase Chat store open/adopt that spawns the SQLite worker ahead of custody recovery and adopts it alongside, early CLI-discovery warm-up feeding the persisted Agent runtime snapshot that seeds the window's startup snapshot, a post-window maintenance queue that also finishes a window-first folder mount and remounts the Bases its new Chat identities unblock, pre-Project App authority repair, the trust-gated signed candidate preflight, App Query snapshot wiring, scoped inventory and Project Tools wiring, Chat Home/SQLite continuation reconciliation, post-reconciliation external-history sync, the periodic chat-store maintenance gate, cleanup participants, recovery order, windows, and two-phase shutdown, background retention based on actual entry availability, shared quit authorization, and task status startup.
 * [POS]: The root lifecycle owner of the desktop main process; entry files own identity and the V8 compile cache before this module is imported
 */
import { recoverOrDefer } from "./persistence/recovery-policy";
import { recoveryNotice } from "./startup/recovery/copy";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { app, dialog, ipcMain } from "electron";
import { waitForMainWindowReady } from "./presence/lifecycle/main-window-readiness";
import { AppsService } from "./apps/apps-service";
import { ChatStore } from "./chats/chat-store";
import { DeviceIdentityStore } from "./chats/device-identity/device-identity";
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
  activity,
  turns,
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
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
import { resolvePlatformCapabilities } from "../../shared/platform-capabilities";
import { BackendSetupService } from "./setup/backend-setup";
import { ProjectStore } from "./projects/store/project-store";
import { ProjectsService } from "./projects/projects-service";
import { composeProjectsService } from "./projects/composition";
import { RelayLedger } from "./sections/coordinator/relay-ledger";
import type { ConversationCoordinator } from "./sections/coordinator/conversation-coordinator";
import { BaseStore } from "./bases/base-store";
import { BasesService } from "./bases/bases-service";
import { LifecycleIntentStore } from "./lifecycle/intent-store";
import { configureAppMode } from "./apps/app-mode";
import { sweepAppStaging } from "./apps/maintenance/staging-sweep";
import { BuiltinMcpBridge } from "./tools/bridge";
import type { AgentTurnCustodyJournal } from "./backends/agent-turn-custody-journal";
import type { AgentTurnCustodyRuntime } from "./backends/agent-turn-custody-runtime";
import { BuiltinMcpLeaseStore } from "./tools/lease";
import type { UsageService } from "./usage/usage-service";
import type { AgentUsageLimitsService } from "./usage-limits/service";
import { composeUsageServices } from "./startup/usage-composition";
import type { MemoryService } from "./memory/service/memory-service";
import type { ManagedRuntimeRegistry } from "./memory/runtime/managed-registry";
import type { MemorySettingsOwner } from "./memory/service/settings-owner";
import type { MemoryLifecycleOrchestrator } from "./memory/runtime/control/lifecycle-orchestrator";
import { configurePermissions } from "./window/security";
import { applyThemeSource } from "./window/native-theme";
import { applyDevelopmentDockIcon } from "./window/app-icon";
import { ChatHomeLedger } from "./chat-home/chat-home-ledger";
import { ChatHomeService } from "./chat-home/chat-home-service";
import { liveChatHomeIntentIds } from "./chat-home/recovery-live-intents";
import type { ArchiveService } from "./archive/archive-service";
import { initializeArtifacts } from "./artifacts/runtime";
import { initializeGalleryRuntime, type GalleryRuntime } from "./gallery/bootstrap";
import { ConversationDeletionCoordinator } from "./deletion/conversation-deletion-coordinator";
import { defaultChromeRoot, installBrowserPanel, type BrowserRuntime } from "./browser/bootstrap";
import type { HistoryImportService } from "./history-import/service";
import { GlobalSearchService } from "./search/job-service";
import { loadCatalog } from "../../shared/i18n/catalogs";
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
import { SkillsTurnCustodyStore } from "./skills-management/turn-custody";
import { PreparedSkillReferenceLedger } from "./skills-management/prepared-reference-ledger";
import { configurePreparedSkillReferenceCustody } from "./sections/coordinator/admission/prepared-skill-reference-custody";
import type { ExtensionRegistryStore } from "./extensions/registry-store";
import { createMainWindowLauncher } from "./startup/main-window-runtime";
import { composeBuiltinTools } from "./startup/builtin-tools-composition";
import { reopenStoppedChatDependencies, ShutdownRecoveryGate } from "./startup/shutdown-recovery";
import { createDesktopUpdateService } from "./update/composition";
import type { UpdateService } from "./update/service";
import { installApplicationQuit } from "./startup/application-quit";
import { closeTerminalOwnerSequence } from "./startup/terminal-owner-sequence";
import type { AgentConnectionRuntime } from "./agent/connection-runtime";
import { startAgentConnections } from "./startup/agent-connections";
import { windowRegistry } from "./window/surfaces/window-registry";
import { surfaceWindowController } from "./window/surfaces/surface-window-controller";
import {
  continueMemoryRebuildRecovery,
  initializeMemoryRuntime,
  recoverAgentTurnCustody,
  reportLifecycleReconciliation,
} from "./startup/recovery-runtime";
import { ProjectToolsRuntime } from "./startup/project-tools-runtime";
import { RuntimeSnapshotStore } from "./startup/runtime-snapshot-store";
import { startupSnapshotArgument } from "../../shared/startup-snapshot";
import { createBaseFileDialogs } from "./startup/base-file-dialogs";
import { startChatStoreMaintenance, stopChatStoreMaintenance } from "./startup/chat-store-maintenance";
import { runRequiredProjectPlacementGate } from "./startup/project-placement-gate";
import { configureAppBaseRuntime } from "./startup/app-base-runtime";
declare const __BOTTEGA_CLOUD_CONFIG__: import("@ai-chat/cloud-protocol").CloudBuildConfig | null;
let cloudRuntime: Awaited<ReturnType<typeof import("./cloud/runtime/composition").createCloudRuntime>> | null = null;
let cloudPrepared: Awaited<ReturnType<typeof import("./cloud/runtime/prepare").prepareCloudRuntime>> | null = null;
let cloudComposition: Promise<typeof import("./cloud/runtime/composition")> | null = null;
import { createPresenceRuntime } from "./presence/composition";
import { createApplicationPresence } from "./presence/lifecycle/application";
import { taskStartFence, uniqueStopOperations } from "./presence/lifecycle/start-fence";
import { agentStopOperations } from "./agent-bridge";
import { backendById, backendRuntimeRegistry } from "./backends";
import { startupTrace } from "./startup/startup-trace";
import { startDeferredMaintenance } from "./startup/deferred-maintenance";
startupTrace.mark("main:module-evaluated");
let presenceRuntime: ReturnType<typeof createPresenceRuntime> | null = null;
const stopOperations = () => uniqueStopOperations([...agentStopOperations(), ...(sectionCoordinator?.pendingStopOperations() ?? [])]);
const presenceLifecycle = createApplicationPresence({ safeQuit: () => safeQuit, locale: () => currentLocale(), snapshot: stopOperations,
  enabled: () => presenceRuntime?.service.snapshot().effectiveDisplayMode != null,
  refresh: () => { void presenceRuntime?.service.refresh(); void cloudRuntime?.refresh(); }, changed: () => presenceRuntime?.service.notifyLifecycle(),
  onProtocolArgs: argv => cloudRuntime?.onProtocolArgs(argv) });
const { loginItem, openedAtLogin, retention: windowRetention, requestQuit: requestUserQuit } = presenceLifecycle;

const hasSingleInstanceLock = app.requestSingleInstanceLock({ launchSource: openedAtLogin ? "login" : "user" });
startupTrace.mark("instance-lock");
let appsService: AppsService | null = null;
let chatStore: ChatStore | null = null;
let profileRecovery: import("./startup/recovery/guard").ProfileRecoveryGuard | null = null;
let library: import("./library/service").LibraryService | null = null;
let chatMirrors: import("./library/mirrors/service").ChatMirrorService | null = null;
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
let agentConnections: AgentConnectionRuntime | null = null;
let relayLedger: RelayLedger | null = null;
let sectionCoordinator: ConversationCoordinator | null = null;
let usageService: UsageService | null = null;
let usageLimits: AgentUsageLimitsService | null = null;
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
  presenceLifecycle.bindActivation();

  void app
    .whenReady()
    .then(async () => {
      startupTrace.mark("app:when-ready");
      const userData = app.getPath("userData");
      const { ProfileRecoveryGuard } = await import("./startup/recovery/guard");
      profileRecovery = new ProfileRecoveryGuard(userData, event => { if (event.held || event.category === "settings") chatStore?.pushWarning(recoveryNotice(event.category === "settings" ? "settings" : "custody", currentLocale())); });
      await profileRecovery.initialize();
      const platformSupport = resolvePlatformCapabilities(process.platform);
      const traceDirectory = join(userData, "debug", "acp-trace");
      const titleWorkspace = join(userData, "codex-workspace");
      const agentInputStagingRoot = join(userData, "agent-input-staging");
      settingsStore = new SettingsStore(userData);
      /* Theme/language and the cloud storage mode are the only facts the rest of the
         chain cannot start without; the remaining members are independent I/O. */
      const [, canonicalUserData] = await Promise.all([
        settingsStore.initialize(),
        realpath(userData),
        mkdir(titleWorkspace, { recursive: true }),
        initializeAgentInputStaging(agentInputStagingRoot),
        (async () => {
          if (!__BOTTEGA_CLOUD_CONFIG__) return;
          cloudPrepared = await (
            await import("./cloud/runtime/prepare")
          ).prepareCloudRuntime(__BOTTEGA_CLOUD_CONFIG__);
          /* The 1.1 MB composition chunk is only needed by the last step before the
             window, but compiling it is pure CPU: start it here so it overlaps the
             disk I/O of the stores that follow. */
          cloudComposition = import("./cloud/runtime/composition");
          void cloudComposition.catch(() => {});
        })(),
      ]);
      const { LibraryService } = await import("./library/service");
      library = new LibraryService(settingsStore, await new DeviceIdentityStore(userData).loadOrCreate());
      await library.initialize();
      /* Must happen before window creation: the renderer's first synchronous script
         reads matchMedia, which reflects what this sets — themeSource has to be set
         first for "no white flash on dark startup" to hold. */
      applyThemeSource(settingsStore.get().theme);
      startupTrace.mark("settings:ready");
      /* translate() 是同步的，目录缺席时不会报错——它会静静退回英文，正是
         最难被发现的那种失败。所以主进程只背英文（runtime.ts 里静态常驻）
         加当前语言，而且必须在任何原生菜单、对话框或托盘文案之前把它等到。
         英文用户这一步是零成本：catalogOf("en") 当场命中。 */
      await loadCatalog(currentLocale());
      startupTrace.mark("i18n:registered");
      const storageMode = cloudPrepared?.binding.mode() ?? { kind: "local-only" as const };
      let disabledToolsSignature = settingsStore
        .get()
        .disabledBuiltinTools.join("\0");
      let activeLocale = currentLocale();
      settingsStore.onChanged(({ settings }) => {
        applyThemeSource(settings.theme);
        /* 语言改了才取新目录：注册后 runtime 会作废该语言的缓存实例，下一次
           translate() 自然升级。改语言本就要重开界面，这一次异步加载排在
           renderer 自己的目录切换后面，用户看不到中间态。 */
        const nextLocale = resolveAppLocale(settings.language, app.getPreferredSystemLanguages());
        if (nextLocale !== activeLocale) {
          activeLocale = nextLocale;
          void loadCatalog(nextLocale).catch((cause) =>
            console.warn(`[i18n] 主进程语言目录加载失败，暂用英文：${asError(cause).message}`)
          );
        }
        const nextSignature = settings.disabledBuiltinTools.join("\0");
        if (nextSignature === disabledToolsSignature) return;
        disabledToolsSignature = nextSignature;
        skillsCatalog?.invalidate();
      });
      updateService = createDesktopUpdateService(app, {
        resolveAppRequirement: (requestId) => {
          if (!appsService) throw new Error("APP_COMPATIBILITY_REQUEST_UNAVAILABLE");
          return appsService.compatibilityRequests.require(requestId);
        },
        prepareSafeQuit: (_reason, interactive) => presenceLifecycle.prepareUpdate(updateService?.snapshot().availableVersion ?? null, interactive),
        hasStopOperations: () => stopOperations().length > 0,
        applyCandidateCompatibility: (matrix) => {
          if (!appsService) throw new Error("GUI_COMPATIBILITY_PREFLIGHT_UNAVAILABLE");
          return appsService.applyCandidateCompatibility(matrix);
        },
      });
      browserRuntime = installBrowserPanel(defaultChromeRoot(app.getPath("home")));
      appsService = new AppsService(userData, undefined, undefined, storageMode, () => library?.root ?? null);
      appsService.configureLocale(currentLocale);
      ({ usageLimits, usage: usageService } = await composeUsageServices(
        userData,
        () => settingsStore?.get().usagePricingAutoRefresh ?? true
      ));
      projectStore = new ProjectStore(userData, { storageMode, libraryRoot: () => library?.root ?? null });
      lifecycleIntents = new LifecycleIntentStore(userData);
      await (await import("./startup/recovery/sqlite")).resumeDatabasePreservation(userData);
      chatStore = new ChatStore(userData, {
        storageMode,
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
      /* open() only needs userData, the storage mode and the backend defaults —
         the Project/App closures above are lazy — so the SQLite worker, the
         longest pre-window step, spawns here and overlaps the App/Project I/O
         below and custody recovery. It publishes nothing: adopt() does, further
         down. */
      const chatStoreOpened = chatStore
        .open(settingsStore.get().defaultChatOptionsByBackend)
        .then(() => startupTrace.mark("chat-store:open"));
      /* Nothing between here and the adopt group awaits this promise, so the failure must
         never surface as an unhandled rejection; the adopt group re-throws it onto the
         startup catch path. */
      void chatStoreOpened.catch(() => undefined);
      const [, createdProjectTools] = await Promise.all([
        appsService.initialize(),
        ProjectToolsRuntime.create(userData, projectStore),
        projectStore.initialize(),
        lifecycleIntents.initialize(),
      ]);
      projectToolsRuntime = createdProjectTools;
      projectsService = composeProjectsService({
        store: projectStore,
        resourceCleanup: projectToolsRuntime.resourceCleanup,
        userData: canonicalUserData,
        apps: () => appsService,
        chats: () => chatsService,
        chatStore: () => chatStore,
        chatHomes: () => chatHomeService,
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
      /* Last life's backends must converge first: an empty in-memory reference
         would otherwise mislead App/Extension reclamation into collecting a
         generation a live process still uses. Custody has no ordering contract
         with the Chat store — turns of a previous process life are always
         released (see recovery-runtime's owner probe) — so adopt() publishes the
         store's projection in parallel rather than behind reconciliation. The
         awaited group also re-throws a worker spawn failure onto the startup
         catch path. */
      const chatStoreAdopted = chatStoreOpened.then(async () => {
        await chatStore!.adopt();
        startupTrace.mark("chat-store:ready");
      });
      void chatStoreAdopted.catch(() => undefined);
      const [recoveredCustody] = await Promise.all([
        recoverAgentTurnCustody({ userData, mainDirectory: __dirname, apps: appsService, chats: chatStore }),
        projectsService.initialize(),
        projectToolsRuntime.initialize(settingsStore),
      ]);
      turnCustodyJournal = recoveredCustody.journal;
      turnCustody = recoveredCustody.runtime;
      const custodyReport = recoveredCustody.report;
      /* CLI discovery only needs the in-process Agent supervisor, which admits from
         module evaluation onward, so it has no ordering contract with custody. It still
         starts after it, so last life's process-group cleanup cannot race a probe pid
         we just spawned. Warming it here removes the renderer gate's dependency on when
         Skills discovery happens to run. */
      const runtimeSnapshots = new RuntimeSnapshotStore(userData);
      /* Last launch's confirmed Agents open the renderer gate on its first render;
         this launch's discovery is what keeps that ledger honest, so it subscribes
         before the warm-up call rather than sampling afterwards. */
      const provisionalBackends = runtimeSnapshots.provisionalBackends(
        (backend) => backendById(backend).displayName
      );
      backendRuntimeRegistry.subscribe((backend, snapshot) => {
        if (snapshot.runtimeStatus === "installed") {
          void runtimeSnapshots.record(backend, {
            executable: snapshot.runtime.executable,
            version: snapshot.runtime.version,
            capabilities: snapshot.capabilities,
          });
        } else if (snapshot.runtimeStatus === "missing") {
          void runtimeSnapshots.forget(backend);
        }
      });
      backendRuntimeRegistry.listSnapshots();
      startupTrace.mark("discovery:warm-start");
      /* Adopt is awaited only now: the SQLite worker's spawn and the discovery probes'
         result handling both overlap custody this way instead of queueing behind it. */
      await chatStoreAdopted;
      deletionCoordinator = new ConversationDeletionCoordinator(join(userData, "deletion-journal"));
      chatHomeLedger = new ChatHomeLedger(userData);
      chatHomeService = new ChatHomeService(settingsStore, chatStore, chatHomeLedger, Date.now, library);
      baseStore = new BaseStore(userData, { storageMode, libraryRoot: () => library?.root ?? null });
      const baseIdentities = cloudPrepared ? cloudPrepared.baseIdentities(chatStore) : Promise.resolve(
        new Map(chatStore.listBaseIdentities().map((identity) => [identity.chatId, identity] as const))
      );
      const [galleryRuntime, , , memoryRuntime] = await Promise.all([
        initializeGalleryRuntime(userData, chatStore, hasActiveImageOccurrence),
        initializeArtifacts(join(userData, "chat-artifacts"), chatStore, () => library?.root ?? null),
        chatHomeService.initialize(),
        initializeMemoryRuntime({ userData, platformSupport, chats: chatStore, settings: settingsStore, projects: projectsService }),
      ]);
      memoryRuntimes = memoryRuntime.runtimes;
      const { ChatMirrorService } = await import("./library/mirrors/service");
      chatMirrors = new ChatMirrorService({ library, chats: chatStore, homes: chatHomeService, progress: value => chatHomeService!.reportProgress(value),
        notify: notice => chatStore!.pushWarning(translate(currentLocale(),
          notice.kind === "chats-unreadable" ? "settings.native.libraryChatsUnreadable" : "settings.native.libraryFilesMissing", { count: notice.count })) });
      const libraryRuntime = await import("./startup/library-runtime");
      await libraryRuntime.mountLibraryContent({ library, mirrors: chatMirrors, chats: chatStore, projects: projectStore, bases: baseStore, apps: appsService.store, baseIdentities, locale: currentLocale, remountSkills: () => unifiedSkillsService?.remountFolder() });
      memoryService = memoryRuntime.service;
      memorySettingsOwner = memoryRuntime.settingsOwner;
      memoryLifecycle = memoryRuntime.lifecycle;
      const historyImportReady = initializeHistoryImportService({
        userData, home: app.getPath("home"), projects: projectsService, projectStore, chats: chatStore,
        settings: settingsStore, memory: memoryService,
        getCoordinator: () => sectionCoordinator, getChats: () => chatsService,
      });
      galleryMediaCache = galleryRuntime.cache;
      galleryEvents = galleryRuntime.events;
      galleryMediaService = galleryRuntime.media;
      globalSearch = new GlobalSearchService(chatStore, baseStore, (projectId) => projectStore!.get(projectId)?.archivedAt);
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
      /* Only the ports are wired here; catching up on missed ingestion is post-window. */
      galleryRuntime.connectBases(basesService);
      const appBaseRuntime = configureAppBaseRuntime({ apps: appsService, projects: projectStore, bases: basesService });
      const builtinSocket = join(userData, "builtin-tools", "bridge.sock");
      builtinLeases = new BuiltinMcpLeaseStore(builtinSocket, join(__dirname, "builtin-tools-server.js"));
      const activeBuiltinLeases = builtinLeases;
      const resolveEffectiveWorkspace = createEffectiveWorkspaceResolver(appsService, projectsService, chatStore, titleWorkspace);
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
        userData, titleWorkspace, store: chatStore, chatHomes: chatHomeService, projects: projectsService,
        projectStore, apps: appsService, bases: basesService, browser: browserRuntime, galleryCache: galleryMediaCache,
        memory: memoryService, settings: settingsStore, deletions: deletionCoordinator,
        getCoordinator: () => sectionCoordinator, getArchive: () => archiveService,
        getRelayLedger: () => relayLedger, getHistoryImport: () => historyImport,
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
      relayLedger = new RelayLedger(userData, Date.now, () => Boolean(cloudPrepared?.binding.snapshot()));
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
      const [readyHistoryImport] = await Promise.all([
        historyImportReady,
        sectionCoordinator.initialize(false),
        appBaseRuntime,
      ]);
      historyImport = readyHistoryImport;
      const appMode = configureAppMode({
        apps: appsService, cloudEnabled: Boolean(cloudPrepared),
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
      const preparedSkillRefs = new PreparedSkillReferenceLedger(userData, appMode.extensions.registry);
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
      unifiedSkillsService = await createUnifiedSkillsService({
        userData, libraryRoot: () => library!.root,
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
      skillsTurnCustody = new SkillsTurnCustodyStore(userData, unifiedSkillsService.library, appMode.extensions.registry);
      await skillsTurnCustody.initialize();
      await cloudPrepared?.attach({ chats: chatStore, bases: baseStore, projects: projectStore, apps: appsService.store, homes: chatHomeService }, lifecycleIntents, appMode.gate, { save: appMode.saveAsApp, promotion: appMode.promotion, rescue: appMode.rescue }, { configs: appsService.configs, extensions: appMode.extensions.installer, reconciliation: appMode.reconciliation, removal: appMode.localRemoval, validateAgent: appsService.validateInstallAgent.bind(appsService), removed: appsService.publishRemoval.bind(appsService) });
      /* 启动只等待 journal 扫描与 fence 发布；网络/drain/资源 saga 在后台续跑。
         一个慢 provider 不再把主窗口建成删除任务的进度条。 */
      await recoverOrDefer(async () => { await chatsService!.recoverDeletions(false); });
      const liveManualIntentIds = Object.values(
        relayLedger.snapshot().manualIntents
      )
        .filter((intent) =>
          ["queued", "appended", "claimed"].includes(intent.phase)
        )
        .map((intent) => intent.id);
      await recoverOrDefer(async () => chatHomeService!.recoverCreations(
        liveChatHomeIntentIds(
          liveManualIntentIds,
          await lifecycleIntents!.listPending()
        )
      ));
      /* 外源同步必须排在续聊对账之后：抢先激活的新代际会让 pending 的
         continuation.finalize 撞上代际围栏，saga 被隔离、Home 变孤儿。
         后者现在住在 post-window 队列里，这条边因此天然成立。 */
      await recoverOrDefer(() => reconcileAdoptedContinuationRuntime(
        chatStore!, chatHomeService!, chatsService!, liveManualIntentIds,
      ));
      archiveService = createArchiveService({
        userData, chatStore, projectStore, chatHomes: chatHomeService, coordinator: sectionCoordinator,
        chats: chatsService, projects: projectsService, baseStore, memory: memoryService, memoryLifecycle,
        settings: settingsStore,
      });
      await archiveService.initialize();
      await recoverOrDefer(async () => {
      const lifecycleReport = await runRequiredProjectPlacementGate({
        recoverLifecycle: () => appMode!.reconciliation.run(),
        appAuthority: () => appsService!.store.authorityState(),
        liveAppIds: () => appsService!.store.knownAppIds(),
        reconcile: (liveAppIds) =>
          projectsService!.runExclusive(() => projectsService!.reconcileOrphanAppPlacementsHeld(liveAppIds)),
        publish: (projectIds) => projectsService!.publishProjectUpserts(projectIds),
      });
      reportLifecycleReconciliation(lifecycleReport);
      await appMode!.saveAsApp.recoverPendingSkills();
      await sweepAppStaging(userData, lifecycleIntents!).catch((cause) =>
        console.warn("[apps] staging orphan sweep failed; next startup retries", cause)
      );
      });
      await recoverOrDefer(async () => { sectionCoordinator!.reopenAdmission(); memoryService!.completeStartup(); });
      const activeCoordinator = sectionCoordinator;
      const toolRegistry = composeBuiltinTools({
        userData, resolveEffectiveWorkspace,
        incarnationOf: (chatId) => chatStore?.getIncarnationId(chatId),
        services: {
          chatStore, chatsService, coordinator: activeCoordinator, basesService, baseStore, projectsService,
          appsService, archiveService, browserService: browserRuntime.service, browserHarness: browserRuntime.harness,
          skillsCustody: skillsTurnCustody,
        },
      });
      builtinBridge = new BuiltinMcpBridge(builtinSocket, builtinLeases, toolRegistry);
      await builtinBridge.start();
      for (const binding of chatStore.listBindings()) seedThreadScope(binding.session, binding.chatId);
      configurePermissions(appsService);
      if (cloudPrepared) cloudRuntime = await (await cloudComposition!).createCloudRuntime(cloudPrepared, () => windowRetention.open(),
        { activity, skills: unifiedSkillsService, events: { chats: chatsService, projects: projectsService, bases: basesService }, gallery: galleryRuntime.media, turns: { ledger: relayLedger!, turns }, remote: { workspaceReferences: { files: workspaceFiles, resolve: resolveEffectiveWorkspace, library: unifiedSkillsService.library, skills: skillsCatalog }, coordinator: activeCoordinator, settings: settingsStore, quota: () => usageLimits!.snapshot(), quotaDemand: active => usageLimits?.setRemoteDemand(active), workspace: () => workspaceResolver!({ kind: "default" }).workspace, publishRecord: record => chatsService?.publishRecord(record) }, projectGate: projectsService, saveAsApp: appMode!.saveAsApp, promotion: appMode!.promotion, rescue: appMode!.rescue });
      startupTrace.mark("services:composed");
      /* Built at window creation, not here: the envelope handed over must be the
         one main holds at that instant, and the renderer trusts it for the
         onboarding gate only. */
      const restoredBackends = await provisionalBackends;
      const startupSnapshotArguments = () => {
        const built = startupSnapshotArgument({
          settings: settingsStore!.envelope(),
          setup: { backends: restoredBackends },
        });
        startupTrace.mark(
          "snapshot:ready",
          `${built.encodedLength}B backends=${restoredBackends.length}${built.dropped ? ` dropped=${built.dropped}` : ""}`
        );
        if (built.dropped) console.warn(`[startup] snapshot exceeds the launch-argument budget; dropped ${built.dropped}`);
        return built.launchArguments;
      };
      /* 池的寿命与 main 相同：它持有真实进程，custody 按 main 的一条命对账。 */
      const activeAgentConnections = (agentConnections = startAgentConnections({
        enabled: () => settingsStore!.get().agentConnectionsEnabled,
        leases: activeBuiltinLeases, custody: turnCustody!,
      }));
      const openMainWindow = createMainWindowLauncher({
        mainDirectory: __dirname, apps: appsService, extensions: appMode.extensions, setup: setupService,
        startupSnapshotArguments,
        projects: projectsService, projectStore, projectToolPolicies: projectToolsRuntime.policies,
        chats: chatsService, bases: basesService, settings: settingsStore, traceDirectory, agentInputStagingRoot,
        manualMcpServers: projectToolsRuntime.manualMcpServers, skills: skillsCatalog, unifiedSkills: unifiedSkillsService,
        skillsCustody: skillsTurnCustody, files: fileAuthorizations, workspaceFiles, resolveWorkspace: workspaceResolver,
        builtinLeases: activeBuiltinLeases, turnCustody: turnCustody!, connections: activeAgentConnections,
        coordinator: activeCoordinator,
        usage: usageService, usageLimits, memory: memoryService, memoryRuntimes, memorySettingsOwner,
        chatHomes: chatHomeService, archive: archiveService, galleryMedia: galleryMediaService, galleryEvents,
        browser: browserRuntime, historyImport, globalSearch, update: updateService, cloud: cloudRuntime ?? undefined,
      });
      startupTrace.registerRenderer(ipcMain, () => windowRegistry.main()?.webContentsId ?? null);
      windowRetention.configure(async () => {
        startupTrace.mark("window:create");
        const record = await waitForMainWindowReady(openMainWindow(), windowRegistry);
        startupTrace.mark("window:ready-to-show");
        return record;
      });
      surfaceWindowController.configurePresence({ beforeAppClose: (record) => windowRetention.beforeAppClose(record),
        ensureMain: () => windowRetention.ensureMain(), closeFailure: () => dialog.showErrorBox(translate(currentLocale(), "settings.presence.title"), translate(currentLocale(), "settings.presence.closeFailed")) });
      presenceRuntime = createPresenceRuntime({ mainDirectory: __dirname, settings: settingsStore, chats: chatsService,
        update: updateService, coordinator: activeCoordinator, login: loginItem, retention: windowRetention, locale: currentLocale, quitting: () => safeQuit.requested, quit: () => { void requestUserQuit(); } });
      await presenceRuntime.initialize();
      const restartHidden = await presenceLifecycle.consumeRestartPresentation();
      /* A silent start still builds the window, so both branches reach this line with
         main readiness settled — that is the only precondition deferred work has. */
      await windowRetention.initialize((restartHidden || (openedAtLogin && settingsStore.get().launchAtLogin)) && presenceRuntime.service.snapshot().effectiveDisplayMode !== null);
      startupTrace.mark("window:shown");
      for (const category of profileRecovery.notices) chatStore.pushWarning(recoveryNotice(category, currentLocale()));
      profileRecovery.sealStartup();
      /* Copies this profile has never seen are opened now, not before the window: below the folder
         threshold the first frame is worth more than a complete Chat list, and the list fills in
         behind it. A Base whose owner only exists after that pass is reloaded in the same breath. */
      libraryRuntime.finishLibraryMount({ chats: chatStore, mirrors: chatMirrors, projects: projectStore, bases: baseStore, baseIdentities,
        settled: () => startupTrace.mark("library:deferred"), publish: (event) => basesService?.publishEvent(event) });
      /* Decoration only, and decoding the PNG costs ~60 ms of main thread; it waits
         until the window is up instead of delaying the first I/O continuations. */
      applyDevelopmentDockIcon();
      presenceLifecycle.bindPower();
      startChatStoreMaintenance(chatStore, (failure) => chatsService?.publishStorageFailure(failure));
      updateService.start();
      if (platformSupport.capabilities.memory) {
        continueMemoryRebuildRecovery(memoryService);
      }
      startupTrace.persist(userData);
      startDeferredMaintenance({
        traceDirectory, apps: appsService, archive: archiveService, chats: chatsService, chatStore,
        gallery: galleryRuntime, historyImport, projects: projectsService, relayLedger,
        cancelled: () => safeQuit.requested, libraryRoot: () => library?.root ?? null, settings: settingsStore,
        quarantinedTurnRequestIds: () => new Set(custodyReport.quarantined.map((entry) => entry.turnRequestId)),
      });
    })
    .catch(async (cause) => {
      const error = asError(cause);
      console.error("[main] initialization failed", error);
      stopChatAdmission();
      const { recoverStartupFailure } = await import("./startup/recovery/interface");
      await recoverStartupFailure({ error, userData: app.getPath("userData"), locale: currentLocale(), settings: settingsStore,
        closeDatabase: async () => { await shutdownAllAgents(); await chatMirrors?.close(); await chatStore?.closeAndFlush(); await library?.close(); } });
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
  presenceRuntime?.close(); presenceLifecycle.close();
  if (cloudRuntime) await cloudRuntime.close(); else { await cloudPrepared?.scope?.close(); await cloudPrepared?.binding.close(); }
  await closeTerminalOwnerSequence({
    irreversible: () => shutdownRecovery.runIrreversible(() => {
      chatsService?.closeAdmission(); basesService?.closeAdmission();
      skillsCatalog?.clear(); workspaceFiles?.clear(); fileAuthorizations?.clear();
    }),
    memory: memoryService, skillsTurnCustody, unifiedSkills: unifiedSkillsService,
    projects: projectsService, historyImport, shutdownTitles: shutdownTitleGenerators,
    chats: chatsService, browser: browserRuntime, bases: basesService,
    relay: relayLedger, archive: archiveService, lifecycleIntents,
    chatStore, chatHome: chatHomeLedger, projectStore, settings: settingsStore, chatMirrors, library, profileRecovery,
    usage: usageService, usageLimits, setup: setupService, apps: appsService,
    agentConnections, turnCustody, turnCustodyJournal, builtinBridge, update: updateService,
  });
}

const safeQuit = installApplicationQuit(app, dialog, {
  requestUserQuit: presenceLifecycle.requestBeforeQuit,
  acquireStartHold: () => taskStartFence.acquire(),
  snapshotStopOperations: stopOperations,
  stopAdmission: stopChatAdmission,
  settleWindows: () => surfaceWindowController.settleAll(),
  quiesceAgents: async () => { await Promise.all([shutdownAllAgents(), sectionCoordinator?.drainDispatches()]); },
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
