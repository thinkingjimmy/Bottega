/**
 * [INPUT]: Depends on Electron lifecycle, startup, factory, workspace/readRef, Skills, Browser/Gallery, Deletion, Memory Policy, authorized identity, history, search job, Project, App/Extension, MCP and Usage
 * [OUTPUT]: The main process combination root; Installed with canonical manual, durable adopt, separate external source Memory, historical intent recovery, archiving SearchJob, other product services and security shutdowns
 * [POS]: The root node of the desktop lifecycle; The main-owned Chat Home gate is a key pathway for the slow Provider to never take over the window before any Agent admission is completed
 */

import { randomUUID } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { app, BrowserWindow, dialog, type FileFilter } from "electron";
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
  scanSkillRoots,
  type WorkspaceResolver,
} from "./skills-catalog";
import { SkillInventoryIndex } from "./agent/skill-inventory";
import { systemSkillsPath } from "./system-skills";
import {
  createEffectiveWorkspaceResolver,
  createWorkspaceResolver,
} from "./workspace-resolver";
import { WorkspaceFileCatalog } from "./workspace-files";
import { SettingsStore } from "./settings-store";
import { resolveAppLocale } from "../../shared/i18n/locale";
import { BackendSetupService } from "./setup/backend-setup";
import { runStateResetV3, runStateResetV4 } from "./state-reset";
import { ProjectStore } from "./projects/project-store";
import { ProjectsService } from "./projects/projects-service";
import { composeProjectsService } from "./projects/composition";
import { RelayLedger } from "./sections/coordinator/relay-ledger";
import type { ConversationCoordinator } from "./sections/coordinator/conversation-coordinator";
import { BaseStore } from "./bases/base-store";
import { BasesService } from "./bases/bases-service";
import { LifecycleIntentStore } from "./lifecycle/intent-store";
import { configureAppMode } from "./apps/app-mode";
import type { AppExtensionIntegration } from "./extensions/integration/app-extension-composition";
import { collectExtensionSkillCandidates } from "./extensions/skill-candidates";
import { sweepAppStaging } from "./apps/staging-sweep";
import { createBuiltinToolsets } from "./builtin-toolsets";
import { BuiltinMcpBridge } from "./tools/bridge";
import { AgentTurnCustodyJournal } from "./backends/agent-turn-custody-journal";
import { AgentTurnCustodyRuntime } from "./backends/agent-turn-custody-runtime";
import { BuiltinMcpLeaseStore } from "./tools/lease";
import { BuiltinToolRegistry } from "./tools/registry";
import { ManualMcpServersStore } from "./tools/mcp/store";
import { UsageService } from "./usage/usage-service";
import { MemoryService } from "./memory/service/memory-service";
import { ManagedRuntimeRegistry } from "./memory/runtime/managed-registry";
import { MemorySettingsOwner } from "./memory/service/settings-owner";
import { MemoryLifecycleOrchestrator } from "./memory/runtime/control/lifecycle-orchestrator";
import { rotateAcpTraces } from "./backends/acp/trace";
import { configurePermissions } from "./window/security";
import { applyThemeSource } from "./window/native-theme";
import { applyDevelopmentDockIcon } from "./window/app-icon";
import { ChatHomeLedger } from "./chat-home/chat-home-ledger";
import { ChatHomeService } from "./chat-home/chat-home-service";
import type { ArchiveService } from "./archive/archive-service";
import { initializeGalleryRuntime, type GalleryRuntime } from "./gallery/bootstrap";
import { ConversationDeletionCoordinator } from "./deletion/conversation-deletion-coordinator";
import { defaultChromeRoot, installBrowserPanel, type BrowserRuntime } from "./browser/bootstrap";
import { HistoryImportService } from "./history-import/service";
import { GlobalSearchService } from "./search/job-service";
import { registerAllCatalogs } from "../../shared/i18n/resources";
import type { CodexSkillsService } from "./backends/codex/skills-service";
import {
  createArchiveService,
  createChatsService,
  createConversationCoordinator,
  createManualTurnPreparer,
} from "./startup/conversation-runtime";
import { createCodexSkillsService } from "./startup/codex-skills-runtime";
import { createUnifiedSkillsService } from "./startup/unified-skills-runtime";
import type { UnifiedSkillsService } from "./skills-management/service";
import {
  createMainWindowLauncher,
  installAppGuiE2eDriver,
  installBrowserE2eDriver,
} from "./startup/main-window-runtime";
import { reopenStoppedChatDependencies, ShutdownRecoveryGate } from "./startup/shutdown-recovery";

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
let settingsStore: SettingsStore | null = null;
let manualMcpServersStore: ManualMcpServersStore | null = null;
let skillsCatalog: SkillsCatalog | null = null;
let codexSkillsService: CodexSkillsService | null = null;
let unifiedSkillsService: UnifiedSkillsService | null = null;
let skillInventory: SkillInventoryIndex | null = null;
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
let appExtensions: AppExtensionIntegration | null = null;
let historyImport: HistoryImportService | null = null;
let globalSearch: GlobalSearchService | null = null;
const currentLocale = () => resolveAppLocale(
  settingsStore?.get().language ?? "auto",
  app.getPreferredSystemLanguages()
);
const setupService = new BackendSetupService(currentLocale);

function continueMemoryRebuildRecovery(memory: MemoryService) {
  setImmediate(() => {
    void memory
      .recoverRebuilds()
      .then((failures) => {
        for (const failure of failures) {
          console.warn(
            `[memory] rebuild ${failure.operationId} 启动恢复失败（${failure.failureKind}/${failure.phase}）：${failure.detail}`
          );
        }
      })
      .catch((cause) => {
        console.warn("[memory] rebuild 后台恢复任务异常", asError(cause));
      });
  });
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  void app
    .whenReady()
    .then(async () => {
      applyDevelopmentDockIcon();
      const userData = app.getPath("userData");
      const traceDirectory = join(userData, "debug", "acp-trace");
      try {
        rotateAcpTraces(traceDirectory);
      } catch (cause) {
        console.warn("[acp-trace] startup cleanup unavailable", cause);
      }
      await runStateResetV3(userData);
      await runStateResetV4(userData);
      const titleWorkspace = join(userData, "codex-workspace");
      const agentInputStagingRoot = join(userData, "agent-input-staging");
      await mkdir(titleWorkspace, { recursive: true });
      const canonicalUserData = await realpath(userData);
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
      manualMcpServersStore = new ManualMcpServersStore(userData);
      await manualMcpServersStore.initialize();
      projectStore = new ProjectStore(userData);
      projectsService = composeProjectsService({
        store: projectStore,
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
      });
      await appsService.initialize();
      /* ============================================================
       * 上一条命的 backend 进程先收敛，才轮到 App/Extension lifecycle。
       *
       * 顺序不能反：内存 BridgeEntry/TurnRegistry 此刻是空的，而空不构成
       * release 证据。先跑 App 恢复就等于用「没人引用」这个假象，把某个
       * 还活着的 backend 正在读的 generation 字节 GC 掉。
       * ============================================================ */
      turnCustodyJournal = new AgentTurnCustodyJournal(userData);
      turnCustody = new AgentTurnCustodyRuntime(turnCustodyJournal, {
        controlRoot: join(userData, "agent-custody"),
        guardianArgs: [join(__dirname, "custody-guardian-entry.js")],
      });
      turnCustody.registerDependencyProbe("app-reference", (dependency) =>
        dependency.kind === "app-reference" &&
        appsService!.isTurnReferenceActive(dependency.journalEntryId)
      );
      turnCustody.registerDependencyProbe("extension-plan", (dependency) =>
        dependency.kind === "extension-plan" &&
        appsService!.isTurnPlanActive(dependency.planInstanceId)
      );
      turnCustody.setOwnerProbe(
        (owner) =>
          owner.kind === "chat-turn"
            ? chatStore!.has(owner.ownerId)
            : owner.kind === "app-internal-turn"
      );
      await turnCustody.initialize();
      const custodyReport = await turnCustody.reconcile();
      /* 只有拿到「进程确已退出」的证据，dependency 才允许释放；quarantine
         的那几条继续钉住 generation，等恢复面收敛。 */
      for (const settled of [
        ...custodyReport.released,
        ...custodyReport.aborted,
      ]) {
        await appsService.releaseTurnApps(settled.turnRequestId);
      }
      for (const held of custodyReport.quarantined) {
        console.error(
          `[custody] ${held.custodyId} 进程状态无法确认，关联能力保持 quarantine（turn ${held.turnRequestId}）`
        );
      }
      turnCustody.openAdmission();
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
      /* 三个 owner 的组装顺序即它们的依赖顺序：
         Managed Runtime（安装事实）→ Delivery（交付事实）→ Settings
         （用户意图）。Settings Owner 拿到 apply 回调后才闭环。 */
      memoryRuntimes = new ManagedRuntimeRegistry(userData);
      memoryService = new MemoryService(userData, {
        readChat: (chatId) => chatStore!.get(chatId),
        readChatRef: (chatId) => chatStore!.getChatRef(chatId),
        listChatSummaries: () => chatStore!.listChatSummaries(),
        runtimes: memoryRuntimes,
      });
      memorySettingsOwner = new MemorySettingsOwner({
        settings: settingsStore,
        runtimes: memoryRuntimes,
        apply: (target, memory) =>
          memoryService!.applyMemoryConfig(target, memory),
        consumeConsentAuthority: (token, target, purpose) =>
          memoryService!
            .consumeConsentAuthority(token, target, purpose)
            .then(() => undefined),
        pause: () => memoryService!.pause(),
        resume: (target, sharingMode) =>
          memoryService!.resume(target, sharingMode),
        revokeConsentForDisable: (providerId) =>
          memoryService!.revokeConsentForDisable(providerId),
        rebuildActive: () => memoryService?.rebuildActive() ?? false,
        lifecycleHeld: (providerId) =>
          memoryLifecycle?.isHeld(providerId) ?? false,
      });
      memoryLifecycle = new MemoryLifecycleOrchestrator({
        runtimes: memoryRuntimes,
        settings: memorySettingsOwner,
        activeProvider: () => settingsStore!.get().memory.provider,
        activeMemory: () => settingsStore!.get().memory,
        consentDestination: (providerId, providerDataInstanceId) =>
          memoryService!.consentDestination(providerId, providerDataInstanceId),
        quiesce: () => memoryService!.quiesce(),
        reopen: () => memoryService!.reopen(),
        authorizeRebuild: (providerId) =>
          memoryService!.authorizeRebuild(providerId),
        rebuild: (providerId) =>
          memoryService!.rebuildWithinLifecycle(providerId),
        reconcileRuntimeConfig: (preview, confirmed) =>
          memoryService!.reconcileRuntimeConfig(preview, confirmed),
        terminalPublish: () => memoryService!.terminalPublish(),
      });
      memoryRuntimes.setLifecycleOrchestrator(memoryLifecycle);
      memoryService.setLifecycleOrchestrator(memoryLifecycle);
      memoryService.setTargetResolver((providerId) =>
        memorySettingsOwner!.resolveTarget({
          ...settingsStore!.get().memory,
          provider: providerId,
        })
      );
      await memoryService.initialize(
        await memorySettingsOwner.resolveTarget(),
        settingsStore.get().memory
      );
      /* 只恢复 Delivery durable fence，使未完成 rebuild 在开放 Memory admission
         前保持 fail-closed；Provider 清理/回灌必须等主窗口创建后再后台续跑。 */
      await memoryService.prepareRebuildRecovery();
      await projectsService.recoverMemoryRebinds();
      historyImport = new HistoryImportService(userData, {
        home: app.getPath("home"),
        listProjects: () => projectStore!.list(),
        getProject: (projectId) => projectStore!.get(projectId),
        prepareProject: () => projectsService!.prepareExternalProject(),
        commitProject: (input) => projectsService!.commitExternalProject(input),
        listSessionBindings: () => chatStore!.listBindings(),
        getAdoptionBinding: (chatId) => chatStore!.getAdoptionBinding(chatId),
        memoryState: () => {
          const memory = settingsStore!.get().memory;
          const status = memoryService!.status();
          const consent = memoryService!.policy.activeConsent();
          return {
            enabled: memory.enabled,
            ready: status.health === "ready" || status.health === "compat",
            sharingMode: memory.sharingMode,
            providerId: status.target?.providerId ?? null,
            providerDataInstanceId: status.target?.providerDataInstanceId ?? null,
            consentEpochId: consent?.id ?? null,
          };
        },
        commitMemory: ({ grantId, snapshots, authorization }) =>
          memoryService!.importForeignHistory({ grantId, snapshots, authorization }),
        previewProductMemory: () => memoryService!.previewExistingProductHistory(),
        commitProductMemory: (grantId, intent) =>
          memoryService!.commitExistingProductHistory(grantId, intent),
        productMemoryCommitted: (grantId) =>
          memoryService!.existingProductHistoryCommitted(grantId),
        adopt: async ({ request, entry, snapshot }) => {
          const coordinator = sectionCoordinator;
          const project = projectStore!.get(entry.projectId);
          if (!coordinator || !project) throw new Error("收养运行时尚未就绪");
          if (request.turnOptions.backend !== entry.sourceKind) {
            throw new Error("续聊 Agent 必须与外源会话同源");
          }
          const id = randomUUID().replaceAll("-", "");
          const chatId = `chat_${id}`;
          const incarnationId = randomUUID().replaceAll("-", "");
          const messageId = `user_${randomUUID().replaceAll("-", "")}`;
          const requestId = `request_${randomUUID().replaceAll("-", "")}`;
          const { submission } = request;
          const content = submission.displayText.trim();
          const session = { backend: entry.sourceKind, id: entry.key.resumeAlias } as const;
          const receipt = await coordinator.submitManualTurn({
            intentId: `adopt_${randomUUID().replaceAll("-", "")}`,
            persistence: {
              kind: "adopt",
              input: {
                id: chatId,
                title: entry.title || "Imported conversation",
                agent: entry.sourceKind,
                projectId: entry.projectId,
                incarnationId,
                session,
                snapshotDigest: snapshot.digest,
                importOrigin: {
                  sourceKind: entry.sourceKind,
                  storageFingerprint: entry.key.storageFingerprint,
                  canonicalNativeId: entry.key.canonicalNativeId,
                  aliases: entry.key.aliases,
                  resumeAlias: entry.key.resumeAlias,
                  originalCwd: entry.cwd,
                  historyRevision: entry.historyRevision,
                  adoptionSnapshotId: snapshot.snapshotId,
                  sourceSize: entry.fingerprint.size,
                  sourceMtimeNs: entry.fingerprint.mtimeNs,
                },
                firstMessage: { id: messageId, role: "user", content, createdAt: Date.now() },
                ...(submission.attachmentPayloads?.length
                  ? { attachmentPayloads: submission.attachmentPayloads }
                  : {}),
              },
            },
            /* 与产品首轮同一张脸：结构化 input、附件与 Plan 都按 renderer 装配的
               原样过桥。这里曾把它们拍平成一条 text——续聊于是天生比产品少一截。 */
            turn: {
              requestId,
              scope: { conversationId: chatId },
              session,
              turnOptions: request.turnOptions,
              ...(submission.planMode ? { planMode: true } : {}),
              input: submission.input,
            },
            content: submission.content,
            precondition: { kind: "absent", proposedIncarnationId: incarnationId },
            workspacePrecondition: { kind: "project", projectId: project.id, membershipRevision: project.membershipRevision },
          });
          if (receipt.phase === "failed") throw new Error("续聊启动失败，未静默创建空会话");
          return { chatId, phase: receipt.phase };
        },
      });
      await historyImport.initialize();
      await historyImport.snapshots.gcAdoptionOrphans(
        new Set(chatStore.listAdoptionSnapshotIds())
      );
      await historyImport.snapshots.gcMemoryOrphans();
      baseStore = new BaseStore(userData);
      await baseStore.initialize(
        new Map(
          chatStore
            .listBaseIdentities()
            .map((identity) => [identity.chatId, identity])
        ),
        new Set(projectStore.list().map((project) => project.id))
      );
      globalSearch = new GlobalSearchService(
        chatStore,
        baseStore,
        (projectId) => projectStore!.get(projectId)?.archivedAt,
        historyImport
      );
      basesService = new BasesService(baseStore, {
        getChat: async (chatId) => chatStore!.getChatRef(chatId),
        getProject: (projectId) => projectStore!.get(projectId),
        chooseExportPath: async (suggestedName, format = "csv") => {
          const filters: Record<"csv" | "json" | "xlsx", FileFilter> = {
            csv: { name: "CSV", extensions: ["csv"] },
            json: { name: "Base JSON", extensions: ["json"] },
            xlsx: { name: "Excel Workbook", extensions: ["xlsx"] },
          };
          const result = await dialog.showSaveDialog({
            defaultPath: suggestedName,
            filters: [filters[format]],
          });
          return result.canceled ? null : result.filePath;
        },
        chooseImportPath: async (format = "json") => {
          const filters: Record<"json" | "xlsx", FileFilter> = {
            json: { name: "Base JSON", extensions: ["json"] },
            xlsx: { name: "Excel Workbook", extensions: ["xlsx"] },
          };
          const result = await dialog.showOpenDialog({
            properties: ["openFile"],
            filters: [filters[format]],
          });
          return result.canceled ? null : result.filePaths[0] ?? null;
        },
      });
      await galleryRuntime.connectBases(basesService);
      /* GUI 只能访问它自己 App 的 Project Base，owner 恒由 Host appId 解析；
         不存在不创建。四个 adapter 共用同一句解析，缺失恒为结构化 404。 */
      const requireProjectOwnerKey = (appId: string) => {
        const project = projectStore?.findByAppId(appId);
        if (!project) {
          throw Object.assign(new Error("该 App 没有可用的 Base"), {
            status: 404,
            code: "base_not_found",
            outcome: "not-committed" as const,
          });
        }
        return `project:${project.id}`;
      };
      appsService.configureGuiApi({
        snapshot: async (appId) => {
          const project = projectStore?.findByAppId(appId);
          if (!project) return null;
          return basesService!.get(`project:${project.id}`);
        },
        insertRows: async (input) =>
          basesService!.insertRowsFromAppGui({
            ownerKey: requireProjectOwnerKey(input.binding.appId),
            ...input,
          }),
        patchRows: async (input) =>
          basesService!.patchRowsFromAppGui({
            ownerKey: requireProjectOwnerKey(input.binding.appId),
            ...input,
          }),
        deleteRows: async (input) =>
          basesService!.deleteRowsFromAppGui({
            ownerKey: requireProjectOwnerKey(input.binding.appId),
            ...input,
          }),
        readAttachment: async (input) =>
          basesService!.readAttachmentForAppGui(
            requireProjectOwnerKey(input.binding.appId),
            input.attachmentId
          ),
      });
      appsService.configureAppDataMigrations({
        apply: async (appId, file) => {
          const project = projectStore?.findByAppId(appId);
          if (!project) throw new Error("App 对应的 Project 不存在");
          await basesService!.applyAppDataMigration(`project:${project.id}`, file);
        },
      });
      const migrationFailures = await appsService.reconcileAppDataMigrations();
      for (const failure of migrationFailures) {
        console.warn(
          `[apps] live Base migration failed for ${failure.appId}: ${failure.message}`
        );
      }
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
      workspaceResolver = createWorkspaceResolver(resolveEffectiveWorkspace);
      workspaceFiles = new WorkspaceFileCatalog(resolveEffectiveWorkspace, {
        getChatIncarnation: (chatId) => chatStore!.getIncarnationId(chatId),
      });
      fileAuthorizations = new FileAuthorizationStore();
      /* catalog 构造早于 extensions 装配，所以候选源是懒读的闭包：catalog 不
         认识 Registry，Registry 也不反向持有 catalog。 */
      skillsCatalog = new SkillsCatalog(workspaceResolver, {
        disabledTools: () => settingsStore!.get().disabledBuiltinTools,
        extensionSkills: async () =>
          appExtensions
            ? collectExtensionSkillCandidates({
                userData,
                inventory: appExtensions.registry.snapshot(),
              })
            : [],
      });
      codexSkillsService = await createCodexSkillsService({
        userData,
        userHome: app.getPath("home"),
        workspace: titleWorkspace,
        catalog: skillsCatalog,
      });
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
        files: fileAuthorizations,
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
        hasConversationActivity,
        isConversationAvailable: (chatId) =>
          archiveService?.isConversationAvailable(chatId) ?? true,
        cancelConversations,
        bindThreadScope: seedThreadScope,
        releaseThreadScope: releaseThreadScopeForConversation,
      });
      /* Registry/reservation/grant 三本账必须在任何 build、plan 或 lifecycle 恢复
         之前就绪：reconcileRefs 要重新拿住仍被引用的 package generation。 */
      appExtensions = appMode.extensions;
      await appMode.extensions.initialize();
      unifiedSkillsService = await createUnifiedSkillsService({
        userData,
        userHome: app.getPath("home"),
        env: process.env,
        extensions: appMode.extensions,
        codex: codexSkillsService,
        chooseLocalFolder: async () => {
          const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
          return result.canceled ? null : result.filePaths[0] ?? null;
        },
      });
      skillInventory = new SkillInventoryIndex({
        loadSystemSkills: () =>
          scanSkillRoots([{ root: systemSkillsPath(), scope: "system" }]),
        loadExtensionSkills: () =>
          collectExtensionSkillCandidates({
            userData,
            inventory: appMode.extensions.registry.snapshot(),
          }),
        subscribeExtensionChanges: (listener) =>
          appMode.extensions.registry.onInventoryChanged(() => listener()),
        debug: (message) => console.debug(message),
      });
      await skillInventory.initialize();
      await appsService.reconcileThirdPartyMcpPlans(
        new Set(custodyReport.quarantined.map((entry) => entry.turnRequestId))
      );
      /* 启动只等待 journal 扫描与 fence 发布；网络/drain/资源 saga 在后台续跑。
         一个慢 provider 不再把主窗口建成删除任务的进度条。 */
      await chatsService.recoverDeletions(false);
      await chatHomeService.recoverCreations(
        new Set(
          Object.values(relayLedger.snapshot().manualIntents)
            .filter((intent) =>
              ["queued", "appended", "claimed"].includes(intent.phase)
            )
            .map((intent) => intent.id)
        )
      );
      archiveService = createArchiveService({
        userData,
        chatStore,
        projectStore,
        chatHomes: chatHomeService,
        coordinator: sectionCoordinator,
        chats: chatsService,
        projects: projectsService,
        baseStore,
        bases: basesService,
        memory: memoryService,
        memoryLifecycle,
        settings: settingsStore,
      });
      await archiveService.initialize();
      const lifecycleReport = await appMode.reconciliation.run();
      if (lifecycleReport.unhandled.length) {
        throw new Error(
          `存在未注册的 lifecycle intent：${lifecycleReport.unhandled
            .map((item) => item.kind)
            .join(", ")}`
        );
      }
      for (const failure of lifecycleReport.projectionFailures) {
        console.warn(
          `[lifecycle] projection ${failure.name} 对账失败，待下次启动重试：${failure.message}`
        );
      }
      // 恢复失败的 saga 会留 pending 下次重试；静默会把「永久卡死」伪装成正常启动
      for (const failure of lifecycleReport.failed) {
        console.error(
          `[lifecycle] intent ${failure.kind}(${failure.intentId}) 恢复失败：${failure.message}`
        );
      }
      /* skipped 从前一行不打——于是「本轮没消费掉」有两种结局（失败/跳过），
         只有一种留下痕迹。stale-settled 是正常收尾，superseded 却意味着这条
         intent 被同资源的对手仲裁掉、本轮没人推进它；一声不吭就等于把「还卡
         着」伪装成「已处理」，事后连该往哪儿查都无从判断。 */
      for (const item of lifecycleReport.skipped) {
        console.warn(
          `[lifecycle] intent ${item.kind}(${item.intentId}) 本轮跳过：${item.why}`
        );
      }
      // consumed 的计数也留一行：全 0 与「根本没 pending」在日志上不该长得一样
      console.info(
        `[lifecycle] 开机对账：恢复 ${lifecycleReport.consumed.length}、跳过 ${lifecycleReport.skipped.length}、失败 ${lifecycleReport.failed.length}、压缩终态 ${lifecycleReport.compactedTerminals}`
      );
      await appMode.saveAsApp.recoverPendingSkills();
      // probe/share/preset staging 的内存映射不跨进程：pending intent 之外的
      // 一律孤儿（pending 配置副本含 secret），失败只警告不阻断启动
      await sweepAppStaging(userData, lifecycleIntents).catch((cause) =>
        console.warn("[apps] staging 孤儿清扫失败，待下次启动重试", cause)
      );
      sectionCoordinator.reopenAdmission();
      memoryService.completeStartup();
      const activeCoordinator = sectionCoordinator;
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
        })
      );
      installBrowserE2eDriver(toolRegistry, (chatId) =>
        chatStore?.getIncarnationId(chatId)
      );
      installAppGuiE2eDriver(appsService);
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
        chats: chatsService,
        bases: basesService,
        settings: settingsStore,
        manualMcpServers: manualMcpServersStore,
        traceDirectory,
        agentInputStagingRoot,
        skills: skillsCatalog,
        codexSkills: codexSkillsService,
        unifiedSkills: unifiedSkillsService,
        skillInventory,
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
      });
      openMainWindow();
      continueMemoryRebuildRecovery(memoryService);
      app.on("activate", () => {
        if (
          BrowserWindow.getAllWindows().length === 0 &&
          appsService &&
          projectsService &&
          chatsService &&
          basesService &&
          settingsStore &&
          manualMcpServersStore &&
          skillsCatalog &&
          codexSkillsService &&
          unifiedSkillsService &&
          skillInventory &&
          fileAuthorizations &&
          workspaceFiles &&
          workspaceResolver &&
          usageService &&
          memoryService &&
          archiveService &&
          galleryMediaService &&
          galleryEvents
        ) {
          openMainWindow();
        }
      });
    })
    .catch((cause) => {
      const error = asError(cause);
      console.error("[main] initialization failed", error);
      dialog.showErrorBox(
        "Bottega 启动失败",
        `主进程初始化失败，应用将安全退出。\n\n${error.message}`
      );
      app.quit();
    });
}

const shutdownRecovery = new ShutdownRecoveryGate();
let quitRequested = false, shutdownFinished = false;

function stopChatAdmission() {
  /* 先关准入再 flush：退出链里绝不能再产生新的 dispatch，否则 flush 完成之后
     还会有一个刚起来的 backend 进程拿着已经写完的账本。 */
  sectionCoordinator?.stopAdmission();
  builtinBridge?.stopAdmission();
  basesService?.stopAdmission();
  chatsService?.stopAdmission();
  projectsService?.stopAdmission();
  stopTitleGeneratorAdmission();
  memoryService?.stopAdmission();
  turnCustody?.closeAdmission();
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

app.on("before-quit", (event) => {
  if (shutdownFinished) return;
  event.preventDefault();
  if (quitRequested) return;
  quitRequested = true;
  stopChatAdmission();
  void shutdownAllAgents()
    .then(() =>
      shutdownRecovery.runIrreversible(() => {
        chatsService?.closeAdmission();
        basesService?.closeAdmission();
        skillInventory?.close();
        skillsCatalog?.clear();
        workspaceFiles?.clear();
        fileAuthorizations?.clear();
      })
    )
    .then(() => memoryService?.shutdown())
    .then(() => unifiedSkillsService?.shutdown())
    .then(() => codexSkillsService?.shutdown())
    .then(() => projectsService?.closeAndFlush())
    .then(() => historyImport?.closeAndFlush())
    .then(() => shutdownTitleGenerators())
    .then(() => chatsService?.awaitTitleJobs())
    .then(() => browserRuntime?.shutdown())
    .then(() => basesService?.closeAndFlush())
    .then(() => relayLedger?.closeAndFlush())
    .then(() => memoryService?.closeAndFlush())
    .then(() => archiveService?.closeAndFlush())
    .then(() => lifecycleIntents?.closeAndFlush())
    .then(() => chatStore?.closeAndFlush())
    .then(() => chatHomeLedger?.closeAndFlush())
    .then(() => projectStore?.closeAndFlush())
    .then(() => settingsStore?.closeAndFlush())
    .then(() => usageService?.shutdown())
    .then(() => setupService.shutdown())
    .then(() => appsService?.shutdown())
    .then(() => turnCustody?.close())
    .then(() => turnCustodyJournal?.closeAndFlush())
    .then(() => builtinBridge?.close())
    .then(() => {
      shutdownFinished = true;
      app.quit();
    })
    .catch(async (error) => {
      quitRequested = false;
      console.error("[codex] shutdown failed", error);
      const recovered = await shutdownRecovery.recover(
        reopenChatDependencies,
        recoverAfterFailedShutdown,
        () => sectionCoordinator?.reopenAdmission(),
        (cause) => console.error("[shutdown] recovery failed", cause)
      );
      if (!recovered) stopChatAdmission();
      dialog.showErrorBox(
        "无法安全退出",
        recovered
          ? "退出流程发生错误，应用已恢复运行，聊天功能仍可使用。请稍后重试退出。"
          : "退出链未能安全恢复。应用保持运行，但为避免产生未落盘会话或更多残留进程，聊天与标题生成已禁用；请处理残留 Codex 进程后重试退出，必要时手动强制退出应用。"
      );
    });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
