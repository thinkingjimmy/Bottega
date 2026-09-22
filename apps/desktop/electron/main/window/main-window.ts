/**
 * [INPUT]: Depends on Electron BrowserWindow, canonical Project/Extension authorities, durable Project Tools/Skills receipts, history/quota services, Apps, Update, MCP, and window security, and the build-gated cloud account lifecycle.
 * [OUTPUT]: Creates the main window, derives canonical turn authority, records actual session prompt hashes, admits saved-history fresh-session recovery before the original user boundary and registers Project/Extension/App IPC.
 * [POS]: Interactive main-window authority boundary; renderer identities are routing hints and main re-derives every Project lifecycle fact
 */
import { prepareSessionRecovery } from "../library/sessions/runtime";
import { libraryReadOnlyRoots } from "../library/sandbox";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";
import { INITIAL_DARK_ARGUMENT, INITIAL_LANGUAGE_ARGUMENT } from "../../../shared/settings-ipc";
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
import { registerArtifactIpc } from "../artifacts/ipc";
import { artifactRuntime } from "../artifacts/runtime";
import { startupTrace } from "../startup/startup-trace";
import { registerAgentBridge, resetThreadServiceTierEffective } from "../agent-bridge";
import type { AgentContext, BuiltinTurnToolPolicy } from "../agent/bridge-types";
import { projectTurnAllowedActions } from "../agent/turn-actions";
import { mergeMaterializedExtensionSkills, resolveAgentInput } from "../agent-input";
import type { AppsService } from "../apps/apps-service";
import { registerUnifiedSkills } from "../skills-management/registrar";
import type { UnifiedSkillsService } from "../skills-management/service";
import type { SkillsTurnCustodyStore } from "../skills-management/turn-custody";
import type { AppExtensionIntegration } from "../extensions/integration/app-extension-composition";
import { ClaudePluginProjection } from "../extensions/claude-plugin-projection";
import { AgentPluginInventory } from "../extensions/agent-plugin-inventory";
import { registerExtensions } from "../extensions/extensions-registrar";
import type { BasesService } from "../bases/bases-service";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import type { ChatsService } from "../chats/chats-service";
import type { FileAuthorizationStore } from "../file-authorizations";
import type { ArchiveService } from "../archive/archive-service";
import type { MemoryService } from "../memory/service/memory-service";
import type { ManagedRuntimeRegistry } from "../memory/runtime/managed-registry";
import type { MemorySettingsOwner } from "../memory/service/settings-owner";
import type { ProjectsService } from "../projects/projects-service";
import type { ProjectStore } from "../projects/store/project-store";
import { registerCoordinatorIpc } from "../sections/coordinator/coordinator-ipc";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { SettingsStore } from "../settings-store";
import { registerSettings } from "../settings-registrar";
import { registerPersonalization } from "../personalization-registrar";
import { registerProjectPersonalization } from "../project-personalization";
import type { BackendSetupService } from "../setup/backend-setup";
import type { SkillsCatalog, WorkspaceResolver } from "../skills-catalog";
import type { WorkspaceFileCatalog } from "../workspace-files";
import { initiatorResultByteBudget, type BuiltinMcpLeaseStore } from "../tools/lease";
import type { UsageService } from "../usage/usage-service";
import type { AgentUsageLimitsService } from "../usage-limits/service";
import type { GalleryMediaService } from "../gallery/media-service";
import type { TurnEventsBroker } from "../gallery/turn-events-broker";
import { resolveConversationContext } from "../workspace-resolver";
import { lockNavigation } from "./security";
import type { AgentTurnCustodyRuntime } from "../backends/agent-turn-custody-runtime";
import type { AgentConnectionRuntime } from "../agent/connection-runtime";
import { chatConnectionClaimPort } from "../agent/connection-wiring";
import { agentConnectionWarmSink } from "../agent/connection-warm";
import { registerAgentConnections } from "../agent-connections-registrar";
import type { AgentBridgeOptions } from "../agent/bridge-types";
import { bindWindowTheme, windowBackgroundColor } from "./native-theme";
import type { BrowserRuntime } from "../browser/bootstrap";
import type { ManualMcpServersStore } from "../tools/mcp/store";
import type { HistoryImportService } from "../history-import/service";
import type { GlobalSearchService } from "../search/job-service";
import { registerManualMcpServers } from "../tools/mcp/registrar";
import { buildManualMcpPlan } from "../tools/mcp/planner";
import { registerProjectTools } from "../tools/project/registrar";
import { projectBuiltinInventory } from "../tools/project/resolver";
import type { ProjectToolPolicyStore } from "../tools/project/store";
import { projectManualMcpServerViews } from "../extensions/component-health";
import { digestCanonical } from "../extensions/registry-canonical";
import { resolveAppIconPath } from "./app-icon";
import type { UpdateService } from "../update/service";
import { resolvePlatformCapabilities } from "../../../shared/platform-capabilities";
import { WINDOW_ID_ARGUMENT, WINDOW_ROLE_ARGUMENT } from "../../../shared/window-surfaces-ipc";
import { configureWindowSurfaces } from "./surfaces/bootstrap";
import { registerAppBridge } from "./surfaces/app-bridge";
import { finalizeSkillsTurnProjection } from "./skills-turn-projection";
import {
  projectBuiltinBackendSupport,
  projectManualMcpBackendSupport,
} from "./project-tools-runtime";
import { historyLookupAvailability } from "../agent/history/availability";
import { buildHandoff } from "../agent/history/builder";
import { createExtensionSessionHandoff } from "./extension-session-handoff";
import {
  acquireTurnAppsForPolicy,
  chatBuiltinMcpIssuer,
  freezeBuiltinPolicy,
  turnProjectionInput,
} from "./turn-policy";
import {
  assertManagedWorktreePermission,
  resolveManagedWorktreeAccess,
} from "./managed-worktree-access";
import { registerUsage } from "./usage-registration";
type MainWindowDependencies = {
  mainDirectory: string;
  apps: AppsService;
  extensions: AppExtensionIntegration;
  setup: BackendSetupService;
  projects: ProjectsService;
  projectStore: ProjectStore;
  projectToolPolicies: ProjectToolPolicyStore;
  chats: ChatsService;
  bases: BasesService;
  settings: SettingsStore;
  manualMcpServers: ManualMcpServersStore;
  traceDirectory: string;
  agentInputStagingRoot: string;
  skills: SkillsCatalog;
  unifiedSkills: UnifiedSkillsService;
  skillsCustody: SkillsTurnCustodyStore;
  files: FileAuthorizationStore;
  workspaceFiles: WorkspaceFileCatalog;
  resolveWorkspace: WorkspaceResolver;
  builtinLeases: BuiltinMcpLeaseStore;
  turnCustody: AgentTurnCustodyRuntime;
  /** Lab 开关关闭时它恒返回 undefined，chat 走今天的冷路径。 */
  connections: AgentConnectionRuntime;
  coordinator: ConversationCoordinator;
  usage: UsageService;
  usageLimits: AgentUsageLimitsService;
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
  update: UpdateService;
  cloud?: { register(window: BrowserWindow, rendererUrl: string): void };
  /** Built by the composition root at creation time; empty when the payload does not fit. */
  startupSnapshotArguments?: () => readonly string[];
};
export function createMainWindow({
  mainDirectory,
  apps,
  extensions,
  setup,
  projects,
  projectStore,
  projectToolPolicies,
  chats,
  bases,
  settings,
  manualMcpServers,
  traceDirectory,
  agentInputStagingRoot,
  skills,
  unifiedSkills,
  skillsCustody,
  files,
  workspaceFiles,
  resolveWorkspace,
  builtinLeases,
  turnCustody,
  connections,
  coordinator,
  usage,
  usageLimits,
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
  update,
  cloud,
  startupSnapshotArguments,
}: MainWindowDependencies) {
  const preload = join(mainDirectory, "../preload/index.js");
  const productionEntry = join(mainDirectory, "../renderer/index.html");
  const rendererUrl =
    process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(productionEntry).href;
  const platformSupport = resolvePlatformCapabilities(process.platform);
  const window = new BrowserWindow({
    show: false,
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
      nodeIntegrationInSubFrames: true,
      /* 首帧主题必须同步到达 renderer：任何 IPC 都晚于第一次绘制，
         建窗参数是唯一「preload 未跑一行业务代码就能读」的通道。 */
      additionalArguments: [
        `${INITIAL_DARK_ARGUMENT}${nativeTheme.shouldUseDarkColors}`,
        `${INITIAL_LANGUAGE_ARGUMENT}${resolveAppLocale(
          settings.get().language,
          app.getPreferredSystemLanguages()
        )}`,
        `${WINDOW_ROLE_ARGUMENT}main`,
        `${WINDOW_ID_ARGUMENT}main`,
        /* Same reason, second half: settings and the last launch's confirmed
           Agents arrive synchronously, so the onboarding gate settles on the
           first render instead of waiting for two IPC round trips. */
        ...(startupSnapshotArguments?.() ?? []),
        ...startupTrace.rendererArguments(),
      ],
    },
  });
  // 主窗口领域清理器是固定装配，不是动态订阅；显式预算避免 Node 的 10 项启发式误报（当前 26 个 closed 监听器）。
  window.setMaxListeners(32);
  configureWindowSurfaces({
    window,
    rendererUrl,
    mainDirectory,
    apps,
    chats,
    projects,
    settings,
    files,
    resolveWorkspace,
  });
  bindWindowTheme(window);
  const artifacts = artifactRuntime();
  if (artifacts) { apps.configureArtifacts(artifacts.gateway); registerArtifactIpc(window, rendererUrl, artifacts, bases); }
  lockNavigation(window, rendererUrl, apps);
  browser.register(window, rendererUrl);
  registerAppBridge(window, rendererUrl, files, resolveWorkspace);
  apps.register(window, rendererUrl);
  setup.register(window, rendererUrl);
  projects.register(window, rendererUrl);
  registerProjectTools(
    window,
    rendererUrl,
    projectStore,
    projectToolPolicies,
    (policy) => projectBuiltinInventory({
      globalDisabledTools: settings.get().disabledBuiltinTools,
      policy,
      backendSupport: projectBuiltinBackendSupport,
    })
  );
  chats.register(window, rendererUrl);
  bases.register(window, rendererUrl);
  historyImport.register(window, rendererUrl);
  globalSearch.register(rendererUrl);
  update.register(window, rendererUrl);
  cloud?.register(window, rendererUrl);
  galleryMedia.register(window, rendererUrl);
  registerSettings(window, rendererUrl, settings, resolveWorkspace, memorySettingsOwner,
    chatHomes, platformSupport, resetThreadServiceTierEffective, chats);
  registerPersonalization(rendererUrl);
  registerProjectPersonalization(rendererUrl, projects);
  const publishMcpServers = registerManualMcpServers(
    window,
    rendererUrl,
    manualMcpServers,
    (servers) =>
      projectManualMcpServerViews(
        servers.map(projectManualMcpBackendSupport),
        extensions.health.snapshot()
      ),
    { projects: projectStore, policies: projectToolPolicies }
  );
  const agentPluginInventory = new AgentPluginInventory(app.getPath("userData"));
  registerExtensions(window, rendererUrl, {
    registry: extensions.registry,
    installer: extensions.installer,
    convergence: extensions.convergence,
    uninstall: extensions.uninstall,
    agentPlugins: agentPluginInventory,
    projects,
    onChanged: (scope) => {
      try {
        skills.invalidateProject(
          scope.kind === "project" ? scope.projectId : null
        );
      } catch (cause) {
        console.warn("[extensions] Skills invalidation failed", cause);
      }
      try {
        publishMcpServers();
      } catch (cause) {
        console.warn("[extensions] MCP projection invalidation failed", cause);
      }
    },
  });
  registerUsage(window, rendererUrl, usage, usageLimits);
  if (platformSupport.capabilities.memory) {
    memory.register(window, rendererUrl);
    memoryRuntimes.register(window, rendererUrl);
  }
  archive.register(window, rendererUrl);
  skills.register(window, rendererUrl);
  registerUnifiedSkills(window, rendererUrl, unifiedSkills);
  workspaceFiles.register(rendererUrl);
  const invalidateWorkspaceFiles = () => workspaceFiles.invalidateAll();
  window.on("focus", invalidateWorkspaceFiles);
  window.once("closed", () =>
    window.off("focus", invalidateWorkspaceFiles)
  );
  registerCoordinatorIpc(window, rendererUrl, coordinator);
  const claudePluginProjection = new ClaudePluginProjection(app.getPath("userData"));
  const incarnationOf = (id: string) => chats.store.getIncarnationId(id);
  const agentBridgeOptions: AgentBridgeOptions = {
    ...chatConnectionClaimPort({ connections, incarnationOf }),
    platformSupport,
    traceDirectory,
    freezeBackendSessionConfig: async (backend) => {
      if (backend !== "claude") return undefined;
      const projection = await claudePluginProjection.build(
        extensions.registry.snapshot()
      );
      try {
        const claudeDisabledPluginIds =
          await agentPluginInventory.disabledClaudePluginIds();
        return projection.paths.length || claudeDisabledPluginIds.length
          ? {
              claudePluginPaths: projection.paths,
              claudeDisabledPluginIds,
              releaseClaudePluginProjection: projection.release,
            }
          : undefined;
      } catch (cause) {
        await projection.release();
        throw cause;
      }
    },
    onTurnItem: (_conversationId, item) => {
      if (item.kind === "file-change") workspaceFiles.invalidateAll();
    },
    withConversationAdmission: (_conversationId, register) =>
      projects.runExclusive(register),
    resolveContext: async (
      conversationId,
      payload,
      origin,
      preparedProjectTools
    ) => {
      if (!chats.store.has(conversationId)) {
        throw new Error("聊天不存在，无法启动 Agent");
      }
      if (!archive.isConversationAvailable(conversationId)) {
        throw new Error("ARCHIVED: 归档聊天不能启动 Agent");
      }
      /* 停用收敛未完成前不得启动**新的**产品会话：新会话会从尚未撤干净的
         ambient 投影里重新发现该包，并把它留到会话结束。已绑定 session 的
         续轮不受影响——它们由收敛自己的 drain/restart 负责。 */
      if (!chats.store.getMetadata(conversationId)?.session) {
        const projectId = chats.store.getProjectId(conversationId) ?? null;
        extensions.convergence.assertProductSessionAdmission(
          projectId
            ? {
                projectId,
                projectLifecycleRevision:
                  projects.getProjectLifecycleRevision(projectId) ?? null,
              }
            : { projectId: null, projectLifecycleRevision: null }
        );
      }
      const builtinToolPolicy = payload
        ? freezeBuiltinPolicy(
            payload.turnOptions.backend,
            preparedProjectTools?.receipt.builtinIntent.disabledTools ??
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
      const preparedSkillSelection = payload?.preparedSkillSelection;
      if (preparedSkillSelection) {
        const canonicalProjectContext = context.projectContext ?? {
          projectId: null,
          projectLifecycleRevision: null,
        };
        if (
          origin?.kind !== "manual" ||
          preparedSkillSelection.backend !== payload?.turnOptions.backend ||
          preparedSkillSelection.planMode !== Boolean(payload?.planMode) ||
          preparedSkillSelection.projectContext.projectId !==
            canonicalProjectContext.projectId ||
          preparedSkillSelection.projectContext.projectLifecycleRevision !==
            canonicalProjectContext.projectLifecycleRevision
        ) {
          throw new Error("Prepared Skills selection receipt 与 canonical turn 冲突");
        }
      }
      const canonicalChat = chats.store.getMetadata(conversationId);
      const managedWorktree = await resolveManagedWorktreeAccess(
        canonicalChat,
        context.workspace,
        chatHomes
      );
      if (
        preparedProjectTools &&
        preparedProjectTools.receipt.projectContext.projectId !==
          canonicalChat?.projectId
      ) {
        throw new Error("PROJECT_TOOLS_CANONICAL_CONTEXT_MISMATCH");
      }
      const candidateUser = origin?.kind === "manual"
        ? await chats.store.getNativeMessage(conversationId, {
            kind: "id",
            messageId: origin.userMessageId,
          })
        : null;
      const canonicalUser = candidateUser?.role === "user"
        ? candidateUser
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
      const chatReadOnlyRoots = [
        ...libraryReadOnlyRoots(chatHomes.libraryRoot, context.workspace),
        ...(settings.get().allowCrossChatRead ? chatHomes.readOnlyRoots(context.workspace) : []),
      ];
      /* 没有 origin 的 turn 不是「manual 的默认值」，而是 headless：turnClass 只能
         按已知证据收窄，不能按方便放宽。 */
      const acquisition = projectionInput;
      const attached = acquisition && builtinToolPolicy
        ? await acquireTurnAppsForPolicy(
            apps,
            acquisition,
            builtinToolPolicy,
            context.projectContext ?? {
              projectId: null,
              projectLifecycleRevision: null,
            }
          )
        : {
            referenceEntryIds: [],
            readOnlyRoots: [],
            instructions: "",
            extensionExclusions: [],
            mcpServers: [],
            extensionDiscoveryBindings: [],
          };
      return {
        ...context,
        ...(managedWorktree.active ? { managedWorktree: true } : {}),
        ...(preparedSkillSelection ? { preparedSkillSelection } : {}),
        ...(builtinToolPolicy ? { builtinToolPolicy } : {}),
        ...(preparedProjectTools ? { preparedProjectTools } : {}),
        ...(projectionInput ? { turnProjectionInput: projectionInput } : {}),
        ...(acquisition ? { turnAppAcquisition: acquisition } : {}),
        packageMcpEntries: attached.mcpServers,
        extensionDiscoveryBindings: attached.extensionDiscoveryBindings,
        ...(memoryAdmission ? { memory: memoryAdmission } : {}),
        onSessionPrompt: payload && canonicalChat && origin?.kind === "manual" ? (sessionId, texts) => chats.store.library.sessions.recordPrompt({
          chatId: conversationId, incarnationId: canonicalChat.incarnationId, userMessageId: origin.userMessageId,
          backend: payload.turnOptions.backend, sessionId, texts }) : undefined,
        sessionRecovery: payload && canonicalChat && origin?.kind === "manual" ? await prepareSessionRecovery(chats, {
          chatId: conversationId, incarnationId: canonicalChat.incarnationId, userMessageId: origin.userMessageId,
          workspace: context.workspace, backend: payload.turnOptions.backend, coverage: payload.handoff?.coverage,
        }) : undefined,
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
            ...managedWorktree.readOnlyRoots,
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
        const attached = await acquireTurnAppsForPolicy(
          apps,
          acquisition,
          next,
          context.projectContext ?? {
            projectId: null,
            projectLifecycleRevision: null,
          }
        );
        const {
          appReferenceRequestId: _requestId,
          appReferenceEntryIds: _entryIds,
          attachedAppInstructions: _instructions,
          packageMcpEntries: _mcpEntries,
          extensionDiscoveryBindings: _discoveryBindings,
          finalTurnProjection: _projection,
          ...base
        } = context;
        projected = {
          ...base,
          builtinToolPolicy: next,
          packageMcpEntries: attached.mcpServers,
          extensionDiscoveryBindings: attached.extensionDiscoveryBindings,
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
      return finalizeSkillsTurnProjection({
        context: projected,
        policy: next,
        catalog: skills,
        custody: skillsCustody,
      });
    },
    releaseContext: async (context) => {
      await Promise.all([
        context.appReferenceRequestId
          ? apps.releaseTurnApps(context.appReferenceRequestId)
          : undefined,
        skillsCustody.release(context.skillsCustodyId),
      ]);
    },
    beginTurnCustody: (input) => turnCustody.begin(input),
    resolveAppEnvironment: (appId) =>
      apps.resolveAgentEnvironment(appId),
    onAppTurnCompleted: (appId, conversationId, requestId) =>
      apps.onAppTurnCompleted(appId, conversationId, requestId),
    onAppTurnFailed: (appId, conversationId, requestId) =>
      apps.onAppTurnFailed(appId, conversationId, requestId),
    assertChatBackend: (conversationId, backend) =>
      chats.store.assertBackend(conversationId, backend),
    conversationIncarnation: (conversationId) => chats.store.getIncarnationId(conversationId),
    assertTurnAdmission: (payload, authority) => {
      const chat = chats.store.getMetadata(payload.scope.conversationId);
      assertManagedWorktreePermission(chat, payload.turnOptions.permissionMode);
      if (!chat || (payload.agentRevision !== undefined && chat.agentRevision !== payload.agentRevision) || chat.agent !== payload.turnOptions.backend) throw new Error("AGENT_REVISION_STALE");
      if (
        payload.turnOptions.permissionMode === "full-access" &&
        (authority ? !authority.fullAccessFor?.(chat.id, chat.incarnationId) : settings.get().fullAccessAcknowledgedAt === null)
      ) {
        throw new Error("FULL_ACCESS_ACK_REQUIRED: 请先确认 Full Access 风险");
      }
    },
    prepareFreshRetry: async (payload, userMessageId) => {
      const chat = chats.store.getMetadata(payload.scope.conversationId);
      if (!chat || (payload.agentRevision !== undefined && chat.agentRevision !== payload.agentRevision)) throw new Error("AGENT_REVISION_STALE");
      if (payload.handoff) return { ...payload.handoff, binding: { ...payload.handoff.binding,
        view: { ...payload.handoff.binding.view, nativeMessageRevision: chat.chatMessageRevision } } };
      const user = userMessageId ? await chats.store.getNativeMessage(chat.id, { kind: "id", messageId: userMessageId }) : null;
      if (userMessageId && user?.role !== "user") throw new Error("CHAT_HISTORY_UNAVAILABLE");
      const history = await chats.store.prepareHistory(chat.id, user?.seq ?? chat.nextSeq);
      if (!history) throw new Error("CHAT_HISTORY_UNAVAILABLE");
      return buildHandoff(history, payload.input, historyLookupAvailability(payload.turnOptions.backend, settings.get().disabledBuiltinTools));
    },
    reserveAssistantSequence: async (conversationId) =>
      (await chats.store.reserveSequences(conversationId, 1))[0]!,
    steer: (input) => coordinator.steer(input),
    decideSteer: (input) => coordinator.decideSteer(input),
    ackSteerIntents: (outboxRefs) =>
      coordinator.ackSteerIntents(outboxRefs),
    steerSnapshot: (conversationId) =>
      coordinator.steerSnapshot(conversationId),
    conversationForOutboxRef: (outboxRef) =>
      coordinator.residenceIndex().steerOutbox(outboxRef),
    ...createExtensionSessionHandoff({ apps, extensions, chats }),
    projectTurnSnapshot: (_conversationId, snapshot) => projectTurnAllowedActions(snapshot),
    resolveInput: (payload, workspace, capabilities, context) =>
      resolveAgentInput(
        payload.input,
        workspace,
        skills,
        files,
        agentInputStagingRoot,
        {
          conversationId: payload.scope.conversationId,
          get: (chatId) => chats.store.getConversation(chatId),
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
        },
        context.projectContext
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
      (await chats.store.getNativeSubagents(conversationId)) ?? {},
    issueBuiltinMcp: chatBuiltinMcpIssuer({ builtinLeases, incarnationOf }),
    resolveThirdPartyMcpPlan: ({
      backendId,
      backendRuntimeIdentity,
      planMode,
      origin,
      context,
    }) =>
      buildManualMcpPlan({
        candidates: context.preparedProjectTools?.candidates ?? [],
        projectContext:
          context.preparedProjectTools?.receipt.projectContext ?? {
            projectId: null,
            projectLifecycleRevision: null,
          },
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
    onTurnStarted: async (event) => {
      const conversationIncarnationId = chats.store.getIncarnationId(
        event.conversationId
      );
      if (!conversationIncarnationId) return;
      await apps.armDesignTurn({
        chatId: event.conversationId,
        conversationIncarnationId,
        turnId: event.requestId,
        explicitDesign: event.explicitDesign,
      }).catch((cause) =>
        console.warn("[design] turn watcher arm failed", cause)
      );
    },
    onTurnSettled: async (event) => {
      const conversationIncarnationId = chats.store.getIncarnationId(
        event.conversationId
      );
      if (conversationIncarnationId) {
        await apps
          .settleDesignTurn(
            event.conversationId,
            conversationIncarnationId,
            event.requestId
          )
          .catch((cause) =>
            console.warn("[design] turn watcher settle failed", cause)
          );
      }
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
  };
  registerAgentBridge(window, rendererUrl, agentBridgeOptions);
  registerAgentConnections(window, rendererUrl, agentConnectionWarmSink(agentBridgeOptions, {
    connections, incarnationOf, disabledTools: () => settings.get().disabledBuiltinTools,
    turnOptionsFor: (id, backend) => chats.store.getMetadata(id)?.options ?? settings.getBackendDefaults(backend),
    artifactDirectoryFor: async (id) => artifactRuntime()?.directory(id),
  }));
  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(productionEntry);
  }
  return window;
}
