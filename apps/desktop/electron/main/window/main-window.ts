/**
 * [INPUT]: Depends on Electron BrowserWindow, business services, workspace/Browser/Gallery, Agent/App/Skills, history import/searchjob, settings/personalization/use/mcp IPC and security
 * [OUTPUT]: Provides createMainWindow, installed Workspace/Browser/Gallery/MCP/Memory/History/Search/Skills/Personalization IPC; The canonical user issues Memory admission and combines Skill with prompt contribution
 * [POS]: The boundary of the window module; index only manages the application lifecycle, and this file manages only the single main window and its renderer capabilities
 */

import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, nativeTheme } from "electron";
import { APP_CHANNEL } from "../../../shared/app-ipc";
import type {
  AgentBackendId,
  AgentSendPayload,
  AgentWorkspaceScope,
} from "../../../shared/agent-ipc";
import { baseToolsAvailability } from "../../../shared/builtin-tools";
import {
  INITIAL_DARK_ARGUMENT,
  INITIAL_LANGUAGE_ARGUMENT,
  SETTINGS_CHANNEL,
} from "../../../shared/settings-ipc";
import { resolveAppLocale } from "../../../shared/i18n/locale";
import { USAGE_CHANNEL } from "../../../shared/usage-ipc";
import { registerAgentBridge } from "../agent-bridge";
import type {
  AgentContext,
  BuiltinTurnToolPolicy,
  TurnProjectionInput,
  TurnOrigin,
} from "../agent/bridge-types";
import type { SkillInventoryIndex } from "../agent/skill-inventory";
import { createFinalTurnProjection } from "../agent/product-context";
import {
  mergeMaterializedExtensionSkills,
  resolveAgentInput,
} from "../agent-input";
import type { AppsService } from "../apps/apps-service";
import type { CodexSkillsService } from "../backends/codex/skills-service";
import { registerUnifiedSkills } from "../skills-management/registrar";
import type { UnifiedSkillsService } from "../skills-management/service";
import type { AppExtensionIntegration } from "../extensions/integration/app-extension-composition";
import { registerExtensions } from "../extensions/extensions-registrar";
import { backendRuntimeRegistry } from "../backends";
import type { BasesService } from "../bases/bases-service";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import type { ChatsService } from "../chats/chats-service";
import { rendererIpc } from "../ipc-registrar";
import type { FileAuthorizationStore } from "../file-authorizations";
import type { ArchiveService } from "../archive/archive-service";
import type { MemoryService } from "../memory/service/memory-service";
import type { ManagedRuntimeRegistry } from "../memory/runtime/managed-registry";
import type { MemorySettingsOwner } from "../memory/service/settings-owner";
import type { ProjectsService } from "../projects/projects-service";
import { registerCoordinatorIpc } from "../sections/coordinator/coordinator-ipc";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { SettingsStore } from "../settings-store";
import { registerSettings } from "../settings-registrar";
import { registerPersonalization } from "../personalization-registrar";
import type { BackendSetupService } from "../setup/backend-setup";
import type { SkillsCatalog, WorkspaceResolver } from "../skills-catalog";
import type { WorkspaceFileCatalog } from "../workspace-files";
import {
  initiatorResultByteBudget,
  type BuiltinMcpLeaseStore,
} from "../tools/lease";
import {
  admittedAmbientTools,
  builtinToolAccess,
  projectBuiltinTools,
  turnKindForOrigin,
} from "../tools/issuance";
import type { UsageService } from "../usage/usage-service";
import { assertUsageRequest } from "../usage/usage-service";
import type { GalleryMediaService } from "../gallery/media-service";
import type { TurnEventsBroker } from "../gallery/turn-events-broker";
import { resolveConversationContext } from "../workspace-resolver";
import {
  lockNavigation,
  openExternalSafely,
} from "./security";
import type { AgentTurnCustodyRuntime } from "../backends/agent-turn-custody-runtime";
import { windowBackgroundColor } from "./native-theme";
import { bindRendererIdentity } from "./renderer-identity";
import type { BrowserRuntime } from "../browser/bootstrap";
import type { ManualMcpServersStore } from "../tools/mcp/store";
import type { HistoryImportService } from "../history-import/service";
import type { GlobalSearchService } from "../search/job-service";
import { registerManualMcpServers } from "../tools/mcp/registrar";
import { buildManualMcpPlan } from "../tools/mcp/planner";
import {
  projectManualMcpServerViews,
  projectPackageMcpServerViews,
} from "../extensions/component-health";
import { digestCanonical } from "../extensions/registry-store";
import { resolveAppIconPath } from "./app-icon";

type MainWindowDependencies = {
  mainDirectory: string;
  apps: AppsService;
  extensions: AppExtensionIntegration;
  setup: BackendSetupService;
  projects: ProjectsService;
  chats: ChatsService;
  bases: BasesService;
  settings: SettingsStore;
  manualMcpServers: ManualMcpServersStore;
  traceDirectory: string;
  agentInputStagingRoot: string;
  skills: SkillsCatalog;
  codexSkills: CodexSkillsService;
  unifiedSkills: UnifiedSkillsService;
  skillInventory: SkillInventoryIndex;
  files: FileAuthorizationStore;
  workspaceFiles: WorkspaceFileCatalog;
  resolveWorkspace: WorkspaceResolver;
  builtinLeases: BuiltinMcpLeaseStore;
  turnCustody: AgentTurnCustodyRuntime;
  coordinator: ConversationCoordinator;
  usage: UsageService;
  memory: MemoryService;
  memoryRuntimes: ManagedRuntimeRegistry;
  memorySettingsOwner: MemorySettingsOwner;
  chatHomes: ChatHomeService;
  archive: ArchiveService;
  galleryMedia: GalleryMediaService;
  galleryEvents: TurnEventsBroker;
  browser: BrowserRuntime;
  historyImport: HistoryImportService;
  globalSearch: GlobalSearchService;
};

function registerAppBridge(
  window: BrowserWindow,
  rendererUrl: string,
  files: FileAuthorizationStore,
  resolveWorkspace: WorkspaceResolver,
  locale: () => ReturnType<typeof resolveAppLocale>
) {
  rendererIpc(window, rendererUrl, "拒绝非主窗口的应用级请求")
    .handle(APP_CHANNEL.openExternal, async (rawUrl) => {
      if (typeof rawUrl !== "string") throw new Error("外链格式无效");
      await openExternalSafely(window, rawUrl, locale());
    })
    .handle(APP_CHANNEL.writeClipboard, (text) => {
      if (typeof text !== "string") throw new Error("剪贴板内容格式无效");
      clipboard.writeText(text);
    })
    .handle(APP_CHANNEL.authorizeFile, async (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new Error("文件授权参数无效");
      }
      const input = raw as {
        path?: unknown;
        name?: unknown;
        mediaType?: unknown;
        scope?: unknown;
      };
      if (
        typeof input.path !== "string" ||
        typeof input.name !== "string" ||
        typeof input.mediaType !== "string"
      ) {
        throw new Error("文件授权参数无效");
      }
      const scope = input.scope as AgentWorkspaceScope;
      const { workspace } = resolveWorkspace(scope);
      return files.authorize(
        { path: input.path, name: input.name, mediaType: input.mediaType, scope },
        workspace
      );
    })
    .handle(APP_CHANNEL.releaseFile, (fileRef) => {
      if (typeof fileRef !== "string") throw new Error("文件授权引用无效");
      files.release(fileRef);
    });
}

function registerUsage(
  window: BrowserWindow,
  rendererUrl: string,
  usage: UsageService
) {
  usage.attachWindow(window);
  rendererIpc(window, rendererUrl, "拒绝非主窗口的用量请求")
    .handle(USAGE_CHANNEL.getSummary, (rawTarget, rawOptions) => {
      const request = assertUsageRequest(rawTarget, rawOptions);
      return usage.getSummary(request.target, {
        forceRefresh: request.forceRefresh,
      });
    })
    .handle(USAGE_CHANNEL.replayProgress, () => usage.replayProgress());
  window.once("closed", () => usage.detachWindow(window));
}

export function createMainWindow({
  mainDirectory,
  apps,
  extensions,
  setup,
  projects,
  chats,
  bases,
  settings,
  manualMcpServers,
  traceDirectory,
  agentInputStagingRoot,
  skills,
  codexSkills,
  unifiedSkills,
  skillInventory,
  files,
  workspaceFiles,
  resolveWorkspace,
  builtinLeases,
  turnCustody,
  coordinator,
  usage,
  memory,
  memoryRuntimes,
  memorySettingsOwner,
  chatHomes,
  archive,
  galleryMedia,
  galleryEvents,
  browser,
  historyImport,
  globalSearch,
}: MainWindowDependencies) {
  const preload = join(mainDirectory, "../preload/index.js");
  const productionEntry = join(mainDirectory, "../renderer/index.html");
  const rendererUrl =
    process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(productionEntry).href;
  const window = new BrowserWindow({
    icon: resolveAppIconPath(),
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: windowBackgroundColor(),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      /* 首帧主题必须同步到达 renderer：任何 IPC 都晚于第一次绘制，
         建窗参数是唯一「preload 未跑一行业务代码就能读」的通道。 */
      additionalArguments: [
        `${INITIAL_DARK_ARGUMENT}${nativeTheme.shouldUseDarkColors}`,
        `${INITIAL_LANGUAGE_ARGUMENT}${resolveAppLocale(
          settings.get().language,
          app.getPreferredSystemLanguages()
        )}`,
      ],
    },
  });

  // ---------------------------------------------------------------------------
  // 主窗口领域清理器是固定装配，不是动态订阅；显式预算避免 Node 的 10 项启发式误报。
  // ---------------------------------------------------------------------------
  window.setMaxListeners(25);

  /* renderer 会话身份由窗口模块拥有，随窗口生命周期无条件绑定。 */
  bindRendererIdentity(window.webContents);

  /* 一条监听同时覆盖「用户切主题」与「系统外观变化」两路：两者都以
     nativeTheme updated 到达，底色与 renderer 因此都不需要第二个分支。
     renderer 收到的是解析好的布尔——themeSource 实测改不动它的
     prefers-color-scheme，让它自己感知就会永远停在系统那一档。 */
  const syncTheme = () => {
    window.setBackgroundColor(windowBackgroundColor());
    window.webContents.send(
      SETTINGS_CHANNEL.themeResolved,
      nativeTheme.shouldUseDarkColors
    );
  };
  nativeTheme.on("updated", syncTheme);
  window.on("closed", () => nativeTheme.off("updated", syncTheme));

  const currentLocale = () =>
    resolveAppLocale(
      settings.get().language,
      app.getPreferredSystemLanguages()
    );
  lockNavigation(window, rendererUrl, apps, currentLocale);
  browser.register(window, rendererUrl);
  registerAppBridge(
    window,
    rendererUrl,
    files,
    resolveWorkspace,
    currentLocale
  );
  apps.register(window, rendererUrl);
  setup.register(window, rendererUrl);
  projects.register(window, rendererUrl);
  chats.register(window, rendererUrl);
  bases.register(window, rendererUrl);
  historyImport.register(window, rendererUrl);
  globalSearch.register(window, rendererUrl);
  galleryMedia.register(window, rendererUrl);
  registerSettings(
    window,
    rendererUrl,
    settings,
    resolveWorkspace,
    memorySettingsOwner,
    chatHomes
  );
  registerPersonalization(window, rendererUrl);
  const publishMcpServers = registerManualMcpServers(
    window,
    rendererUrl,
    manualMcpServers,
    () => {
      const inventory = extensions.health.inventory(
        extensions.registry.snapshot()
      );
      return {
        inventoryRevision: inventory.revision,
        servers: projectPackageMcpServerViews(inventory),
      };
    },
    (servers) =>
      projectManualMcpServerViews(servers, extensions.health.snapshot())
  );
  registerExtensions(window, rendererUrl, {
    registry: extensions.registry,
    installer: extensions.installer,
    convergence: extensions.convergence,
    uninstall: extensions.uninstall,
    onChanged: () => {
      skills.invalidate();
      publishMcpServers();
    },
  });
  registerUsage(window, rendererUrl, usage);
  memory.register(window, rendererUrl);
  memoryRuntimes.register(window, rendererUrl);
  archive.register(window, rendererUrl);
  skills.register(window, rendererUrl);
  registerUnifiedSkills(window, rendererUrl, unifiedSkills);
  workspaceFiles.register(window, rendererUrl);
  const invalidateWorkspaceFiles = () => workspaceFiles.invalidateAll();
  window.on("focus", invalidateWorkspaceFiles);
  window.once("closed", () =>
    window.off("focus", invalidateWorkspaceFiles)
  );
  registerCoordinatorIpc(window, rendererUrl, coordinator);
  const freezeBuiltinPolicy = (
    backend: AgentBackendId,
    disabledTools: readonly string[]
  ): BuiltinTurnToolPolicy => ({
    disabledTools: [...disabledTools],
    builtinTools: runtimeBuiltinTools(backend),
    backendRuntimeIdentity: backendRuntimeIdentity(backend),
  });

  const acquireTurnAppsForPolicy = (
    acquisition: TurnProjectionInput,
    policy: BuiltinTurnToolPolicy
  ) => {
    const issuance = {
      builtinTools: policy.builtinTools,
      backend: acquisition.backendId,
      planMode: acquisition.planMode,
      origin: acquisition.origin,
      disabledTools: policy.disabledTools,
    };
    return apps.acquireTurnApps({
      conversationId: acquisition.conversationId,
      requestId: acquisition.requestId,
      backendId: acquisition.backendId,
      backendRuntimeIdentity: policy.backendRuntimeIdentity,
      turnClass: acquisition.origin?.kind ?? "headless",
      planMode: acquisition.planMode,
      toolAccess: builtinToolAccess(issuance),
      baseToolsAvailability: baseToolsAvailability(
        admittedAmbientTools(issuance)
      ),
    });
  };

  const turnProjectionInput = (
    conversationId: string,
    payload: AgentSendPayload,
    origin: TurnOrigin | undefined
  ): TurnProjectionInput => ({
    conversationId,
    requestId: payload.requestId,
    backendId: payload.turnOptions.backend,
    origin,
    planMode: Boolean(payload.planMode),
  });

  registerAgentBridge(window, rendererUrl, {
    acceptRendererSend: false,
    traceDirectory,
    freezeBackendSessionConfig: (backend) =>
      backend === "codex"
        ? { codexSkillRules: codexSkills.freezeRules() }
        : undefined,
    onTurnItem: (_conversationId, item) => {
      if (item.kind === "file-change") workspaceFiles.invalidateAll();
    },
    withConversationAdmission: (_conversationId, register) =>
      projects.runExclusive(register),
    resolveContext: async (conversationId, payload, origin) => {
      if (!chats.store.has(conversationId)) {
        throw new Error("聊天不存在，无法启动 Agent");
      }
      if (!archive.isConversationAvailable(conversationId)) {
        throw new Error("ARCHIVED: 归档聊天不能启动 Agent");
      }
      /* 停用收敛未完成前不得启动**新的**产品会话：新会话会从尚未撤干净的
         ambient 投影里重新发现该包，并把它留到会话结束。已绑定 session 的
         续轮不受影响——它们由收敛自己的 drain/restart 负责。 */
      if (!(await chats.store.get(conversationId))?.session) {
        extensions.convergence.assertProductSessionAdmission();
      }
      const builtinToolPolicy = payload
        ? freezeBuiltinPolicy(
            payload.turnOptions.backend,
            settings.get().disabledBuiltinTools
          )
        : undefined;
      const projectionInput = payload
        ? turnProjectionInput(conversationId, payload, origin)
        : undefined;
      const context = resolveConversationContext(
        conversationId,
        projects,
        chats.store
      );
      const canonicalChat = await chats.store.get(conversationId);
      const canonicalUser =
        origin?.kind === "manual"
          ? canonicalChat?.messages.find(
              (message) =>
                message.id === origin.userMessageId && message.role === "user"
            )
          : undefined;
      const memoryAdmission =
        payload && origin?.kind === "manual" && canonicalChat && canonicalUser
          ? await memory.prepareAdmission({
              requestId: payload.requestId,
              origin: "manual",
              planMode: Boolean(payload.planMode),
              chatId: canonicalChat.id,
              incarnationId: canonicalChat.incarnationId,
              projectId: canonicalChat.projectId,
              userCreatedAt: canonicalUser.createdAt,
              workspace: context.workspace,
            })
          : null;
      const chatReadOnlyRoots = settings.get().allowCrossChatRead
        ? chatHomes.readOnlyRoots(context.workspace)
        : [];
      /* 没有 origin 的 turn 不是「manual 的默认值」，而是 headless：turnClass 只能
         按已知证据收窄，不能按方便放宽。 */
      const acquisition = projectionInput;
      const attached = acquisition && builtinToolPolicy
        ? await acquireTurnAppsForPolicy(acquisition, builtinToolPolicy)
        : {
            referenceEntryIds: [],
            readOnlyRoots: [],
            instructions: "",
            extensionExclusions: [],
            mcpServers: [],
          };
      return {
        ...context,
        ...(builtinToolPolicy ? { builtinToolPolicy } : {}),
        ...(projectionInput ? { turnProjectionInput: projectionInput } : {}),
        ...(acquisition ? { turnAppAcquisition: acquisition } : {}),
        packageMcpEntries: attached.mcpServers,
        ...(memoryAdmission ? { memory: memoryAdmission } : {}),
        baseReadOnlyRoots: chatReadOnlyRoots,
        ...(attached.referenceEntryIds.length
          ? {
              appReferenceRequestId: payload?.requestId,
              appReferenceEntryIds: attached.referenceEntryIds,
              attachedAppInstructions: attached.instructions,
            }
          : {}),
        /* 由 AppsService 一处产出：它同时是 reference journal 与 plan lease
           的 owner，组合根再拼一次只会拼漏，而漏掉的那条正是「进程还活着，
           generation 已被 GC」的路径。 */
        custodyDependencies: payload
          ? apps.turnCustodyDependencies(payload.requestId)
          : [],
        filesystemAccess: {
          workspace: context.workspace,
          readOnlyRoots: [
            ...chatReadOnlyRoots,
            ...attached.readOnlyRoots,
          ],
          controlRoot: dirname(chatHomes.ledger.filePath),
        },
      };
    },
    finalizeContextForRuntime: async (context, snapshot) => {
      const current = context.builtinToolPolicy;
      if (!current) return context;
      if (snapshot.runtimeStatus !== "installed") {
        throw new Error("已确认 runtime 在 context 重投影前失效");
      }
      const next: BuiltinTurnToolPolicy = {
        disabledTools: current.disabledTools,
        builtinTools: snapshot.capabilities.builtinTools,
        backendRuntimeIdentity: `${context.turnProjectionInput?.backendId ?? "unknown"}@${snapshot.runtime.version}`,
      };
      let projected: AgentContext = { ...context, builtinToolPolicy: next };
      const capabilityChanged =
        current.builtinTools !== next.builtinTools ||
        current.backendRuntimeIdentity !== next.backendRuntimeIdentity;
      const acquisition = context.turnAppAcquisition;
      if (capabilityChanged && acquisition) {
        await apps.releaseTurnApps(acquisition.requestId);
        const attached = await acquireTurnAppsForPolicy(acquisition, next);
        const {
          appReferenceRequestId: _requestId,
          appReferenceEntryIds: _entryIds,
          attachedAppInstructions: _instructions,
          packageMcpEntries: _mcpEntries,
          finalTurnProjection: _projection,
          ...base
        } = context;
        projected = {
          ...base,
          builtinToolPolicy: next,
          packageMcpEntries: attached.mcpServers,
          ...(attached.referenceEntryIds.length
            ? {
                appReferenceRequestId: acquisition.requestId,
                appReferenceEntryIds: attached.referenceEntryIds,
                attachedAppInstructions: attached.instructions,
              }
            : {}),
          custodyDependencies: apps.turnCustodyDependencies(
            acquisition.requestId
          ),
          filesystemAccess: context.filesystemAccess
            ? {
                ...context.filesystemAccess,
                readOnlyRoots: [
                  ...(context.baseReadOnlyRoots ?? []),
                  ...attached.readOnlyRoots,
                ],
              }
            : undefined,
        };
      }
      const input = projected.turnProjectionInput;
      if (!input) return projected;
      const allowedTools = projectBuiltinTools({
        builtinTools: next.builtinTools,
        backend: input.backendId,
        planMode: input.planMode,
        origin: input.origin,
        disabledTools: next.disabledTools,
      });
      return {
        ...projected,
        finalTurnProjection: createFinalTurnProjection({
          turnKind: turnKindForOrigin(input.origin),
          allowedTools,
          appInstructions: projected.attachedAppInstructions ?? "",
          skills: skillInventory.snapshot(allowedTools),
        }),
      };
    },
    releaseContext: (context) =>
      context.appReferenceRequestId
        ? apps.releaseTurnApps(context.appReferenceRequestId)
        : undefined,
    beginTurnCustody: (input) => turnCustody.begin(input),
    resolveAppEnvironment: (appId) =>
      apps.resolveAgentEnvironment(appId),
    onAppTurnCompleted: (appId, conversationId, requestId) =>
      apps.onAppTurnCompleted(appId, conversationId, requestId),
    onAppTurnFailed: (appId, conversationId, requestId) =>
      apps.onAppTurnFailed(appId, conversationId, requestId),
    assertChatBackend: (conversationId, backend) =>
      chats.store.assertBackend(conversationId, backend),
    assertTurnAdmission: (payload) => {
      if (
        payload.turnOptions.permissionMode === "full-access" &&
        settings.get().fullAccessAcknowledgedAt === null
      ) {
        throw new Error("FULL_ACCESS_ACK_REQUIRED: 请先确认 Full Access 风险");
      }
    },
    reserveAssistantSequence: async (conversationId) =>
      (await chats.store.reserveSequences(conversationId, 1))[0]!,
    steer: (input) => coordinator.steer(input),
    decideSteer: (input) => coordinator.decideSteer(input),
    ackSteerIntents: (outboxRefs) =>
      coordinator.ackSteerIntents(outboxRefs),
    steerSnapshot: (conversationId) =>
      coordinator.steerSnapshot(conversationId),
    onSessionBound: (conversationId, value) =>
      chats.handleSessionBound({ conversationId }, value),
    replaceSession: (conversationId, expected, next) =>
      chats.replaceSession({ conversationId }, expected, next),
    assertRetryWithoutSession: (conversationId) => {
      if (chats.store.getImportOrigin(conversationId)) {
        throw new Error("IMPORTED_RESUME_REQUIRED: 收养会话不能丢弃原生 Session 后重试；请修复来源 CLI 登录或恢复能力后再试");
      }
    },
    resolveInput: (payload, workspace, capabilities) =>
      resolveAgentInput(
        payload.input,
        workspace,
        skills,
        files,
        agentInputStagingRoot,
        {
          conversationId: payload.scope.conversationId,
          get: (chatId) => chats.store.get(chatId),
          readAttachment: (sectionId, attachmentId) =>
            chats.readSectionAttachment(sectionId, attachmentId),
          imageInput: capabilities.imageInput,
        },
        {
          export: (opaqueId) => historyImport.exportTranscript(opaqueId),
        },
        {
          backend: payload.turnOptions.backend,
          planMode: Boolean(payload.planMode),
        }
      ),
    mergeLateInput: (resolved, requestId) =>
      mergeMaterializedExtensionSkills(
        resolved,
        apps.turnExtensionSkills(requestId)
      ),
    recallMemory: (input) => memory.recall(input),
    prepareMemoryContribution: (admission, projection) =>
      memory.prepareContribution(admission, projection),
    assertPlanAvailable: (requested, workspace, backend) =>
      skills.assertPlanAvailable(requested, workspace, backend),
    appendTurnResult: (conversationId, input) =>
      chats.appendTurnResult(conversationId, input),
    loadSubagents: async (conversationId) =>
      (await chats.store.get(conversationId))?.subagents ?? {},
    issueBuiltinMcp: (payload, generation, _origin, context) => {
      const allowedTools = context.finalTurnProjection?.allowedTools ?? [];
      if (!allowedTools.length) return undefined;
      const incarnationId = chats.store.getIncarnationId(
        payload.scope.conversationId
      );
      if (!incarnationId) {
        throw new Error("聊天不存在，无法签发内置工具 lease");
      }
      return builtinLeases.issue({
        chatId: payload.scope.conversationId,
        incarnationId,
        requestId: payload.requestId,
        generation,
        allowedTools: [...allowedTools],
        initiatorBackend: payload.turnOptions.backend,
        resultByteBudget: initiatorResultByteBudget(
          payload.turnOptions.backend
        ),
      });
    },
    resolveThirdPartyMcpPlan: ({
      backendId,
      backendRuntimeIdentity,
      planMode,
      origin,
      context,
    }) =>
      buildManualMcpPlan({
        store: manualMcpServers,
        backendId,
        backendRuntimeIdentity,
        planMode,
        origin,
        packageEntries: context.packageMcpEntries,
      }),
    observeThirdPartyMcpProtocol: (observation) => {
      const evidenceDigest = digestCanonical({
        outcome: observation.outcome,
        evidence: observation.evidence,
      });
      if (observation.outcome === "success") {
        extensions.health.observeProtocolSuccess(
          observation.subject,
          evidenceDigest
        );
      } else {
        extensions.health.observeProtocolFailure(
          observation.subject,
          evidenceDigest
        );
      }
      publishMcpServers();
    },
    /* App reference/plan lease 的释放归 finalizer 的 custody 收口那一步，
       不在这里：dependency 早于进程退出被释放，等于允许一个还活着的 backend
       读到已经被 GC 的 generation 字节。 */
    onTurnSettled: async (event) => {
      const memoryAuthorized = await coordinator.onTurnSettled(event);
      /* Memory 是 degraded subsystem：任何 store/provider 异常都不能改写
         Chat persist/trace 终态，也不能阻断下一轮。 */
      await memory.onTurnSettled(event, memoryAuthorized).catch(() => undefined);
    },
    onTurnPrepared: (event) => coordinator.onTurnPrepared(event),
    onSteerFenceTimeout: (event) =>
      coordinator.finalizeSteerFenceTimeout(event.requestId, event.opEpochs),
    onCompletedImage: async (event) => {
      const incarnationId = chats.store.getIncarnationId(event.conversationId);
      if (!incarnationId || !event.item.detail) return;
      await galleryEvents.complete({
        sourceRef: {
          kind: "transcript",
          chatId: event.conversationId,
          incarnationId,
          assistantSeq: event.assistantSeq,
          itemId: event.item.itemId,
        },
        savedPath: event.item.detail,
        workspaceRoot: event.workspaceRoot,
        messageId: event.messageId,
        itemOrdinal: event.itemOrdinal,
      });
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(productionEntry);
  }
}

/* App instructions 与 tool lease 必须读同一份 runtime capability，否则会出现
   「工具只读、文案说可写」的自相矛盾授权叙述。 */
function runtimeBuiltinTools(backend: AgentBackendId) {
  const snapshot = backendRuntimeRegistry.current(backend);
  return snapshot?.runtimeStatus === "installed"
    ? snapshot.capabilities.builtinTools
    : ("none" as const);
}

/* capability snapshot 必须绑定具体 runtime 版本；未安装/未探测时给 unknown，
   让 planner 以 backend-capability-mismatch 排除，而不是假装同一台运行时。 */
function backendRuntimeIdentity(backend: AgentBackendId) {
  const snapshot = backendRuntimeRegistry.current(backend);
  return snapshot?.runtimeStatus === "installed"
    ? `${backend}@${snapshot.runtime.version}`
    : `${backend}@unknown`;
}
