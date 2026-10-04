/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts and Chat/Project/App/Memory/Gallery/Browser services, the History Import handle, canonical Project Tools resolver, scoped Extension inventory, Skills selection authority, manual staging, RelayLedger, and backend bridge
 * [OUTPUT]: Composes runtime-only admission, scoped retries, queue pausing and single-backend title generation/recovery — headless job or one-shot Agent turn — qualified against the same configured model and workspace; a package Provider's turn resolves no Project tools and names the Provider from the catalog when it fails. Refuses closed App submissions and keeps their queued messages undispatched.
 * Workflow preparation narrows Skills and MCP candidates before their receipts enter custody.
 * [POS]: The conversation-domain startup composition module; the external-history half lives in history-import-runtime.ts and assembles dependencies without holding global lifecycle state
 */

import { requireProvider } from "../../backends";
import { join } from "node:path";
import { workflowSkillSelection, workflowToolSelection } from "../../agent-configs/selection";
import { workflowTurnPolicyFor } from "../../workflows/turn-policy";
import type { AgentBackendId, AgentWorkspaceScope, BackendCapabilities } from "../../../../shared/ipc/agent/agent-ipc";
import type { TurnProjectContext } from "../../../../shared/product/product-resource-scope";

import { ownerFromKey } from "@ai-chat/base-core/model/owner-key";
import { PROJECT_UNAVAILABLE } from "../../../../shared/ipc/workspace/projects-ipc";
import type { TrustedManualTurnSubmission as ManualTurnSubmission } from "../../../../shared/ipc/content/sections-ipc";
import {
  cancelAgentTurn,
  cancelConversations,
  hasConversationActivity,
  conversationSwitchActivityReason,
  registerAgentSteerOperation,
  releaseConversations,
  releaseThreadScopeForConversation,
  seedThreadScope,
  startAgentPayload,
  steerAgentTurn,
} from "../../agent/bridge/agent-bridge";
import type { AppsService } from "../../apps/apps-service";
import { ArchiveService } from "../../archive/archive-service";
import { TitleEligibilityDeferred } from "../../chats/projection/chat-title-jobs";
import { assertAgentAvailable, assertInstalledRuntime } from "../../agent/admission/runtime-gate";
import { backendById, backendRuntimeRegistry, providerDisplayName } from "../../backends";
import { builtinAgent } from "../../../../shared/chat-agent/options";
import { agentProcessSafetyLock } from "../../agent-process-supervisor";
import type { BaseStore } from "../../bases/base-store";
import type { BasesService } from "../../bases/bases-service";
import type { BrowserRuntime } from "../../browser/bootstrap";
import type { ChatHomeService } from "../../chat-home/chat-home-service";
import { PurgeJournal } from "../../chat-home/purge-journal";
import type { ChatStore } from "../../chats/chat-store";
import { ChatsService } from "../../chats/service/chats-service";
import { reconcileAdoptedContinuations } from "../../chats/lifecycle/adopted-chat";
import { generateTitle, generateTitleWithTurn } from "../../chats/projection/title-generator";
import type { ConversationDeletionCoordinator } from "../../deletion/conversation-deletion-coordinator";
import type { FileAuthorizationStore } from "../../workspace/files/file-authorizations";
import type { GalleryRuntime } from "../../gallery/bootstrap";
import type { HistoryImportService } from "../../history-import/service";
import { assertTrustedGallerySubmission } from "../../gallery/submission-authority";
import type { LifecycleIntentStore } from "../../lifecycle/intent-store";
import type { MemoryLifecycleOrchestrator } from "../../memory/runtime/control/lifecycle-orchestrator";
import type { MemoryService } from "../../memory/service/memory-service";
import type { ProjectStore } from "../../projects/store/project-store";
import type { ProjectsService } from "../../projects/projects-service";
import {
  prepareManualTurn,
  reconcilePreparedStaging,
  releasePreparedStaging,
  type PreparedManualTurn,
} from "../../sections/coordinator/admission/prepared-manual-turn";
import type { ProjectToolsPreparationSnapshot } from "../../sections/coordinator/admission/prepared-project-tools";
import { ConversationCoordinator } from "../../sections/coordinator/conversation-coordinator";
import type { RelayLedger } from "../../sections/coordinator/relay-ledger";
import type { SettingsStore } from "../../settings/settings-store";
import type { SkillsCatalog, WorkspaceResolver } from "../../skills/catalog/skills-catalog";
import { importedWorkspace, resolveConversationContext } from "../../workspace/files/workspace-resolver";
import type { WorkspaceFileCatalog } from "../../workspace/files/workspace-files";
import { resolveProjectToolsRuntimeIdentity } from "../../sections/coordinator/admission/prepared/hydration";

/**
 * Kimi and OpenCode run chat turns fine but declare no headless purpose at all
 * (print mode dies under the fence), so their titles come from one ordinary
 * Agent turn instead of a headless job.
 */
const usesOneShotTitles = (snapshot: { capabilities: BackendCapabilities }, providerId: string) =>
  !requireProvider(providerId).headless || !snapshot.capabilities.headless.includes("title");

type ChatsRuntimeDependencies = {
  userData: string;
  titleWorkspace: string;
  store: ChatStore;
  chatHomes: ChatHomeService;
  projects: ProjectsService;
  projectStore: ProjectStore;
  apps: AppsService;
  bases: BasesService;
  browser: BrowserRuntime;
  galleryCache: GalleryRuntime["cache"];
  memory: MemoryService;
  settings: SettingsStore;
  deletions: ConversationDeletionCoordinator;
  getCoordinator: () => ConversationCoordinator | null;
  getArchive: () => ArchiveService | null;
  getRelayLedger: () => RelayLedger | null;
  getHistoryImport: () => HistoryImportService | null;
};

export function createChatsService({
  userData,
  titleWorkspace,
  store,
  chatHomes,
  projects,
  projectStore,
  apps,
  bases,
  browser,
  galleryCache,
  memory,
  settings,
  deletions,
  getCoordinator,
  getArchive,
  getRelayLedger,
  getHistoryImport,
}: ChatsRuntimeDependencies) {
  const titlePlan = (backend: string, preferences = settings.get()) => ({
    cwd: titleWorkspace, ignoreUserConfig: true, model: preferences.titleModelByBackend[backend] ?? undefined,
  });
  return new ChatsService(store, {
    recoverTitleJobs: true,
    chatHomes,
    isConversationTransitioning: (chatId) =>
      getCoordinator()?.isTransitioning(chatId) ?? Promise.resolve(false),
    isProjectArchived: (projectId) =>
      Boolean(projectStore.get(projectId)?.archivedAt),
    libraryRoot: () => settings.get().libraryRoot ?? null,
    exportsRoot: join(userData, "exports"),
    resolveAppAgent: (appId, projectId) =>
      projects.isAppBinding(projectId, appId)
        ? apps.resolveInteractiveAgent(appId)
        : undefined,
    isAppProject: (projectId) =>
      projectStore.get(projectId)?.workspaceBinding.kind === "app",
    resolveProjectWorkspace: (projectId) =>
      projects.resolveCodexContext(projectId).workspace,
    onAppChatCreated: async ({ appId, appRole, chatId, origin }) => {
      await apps
        .markChatCanonical(appId, appRole, chatId, origin)
        .catch((cause) =>
          console.warn("[apps] canonical chat 槽位回填等待启动对账", cause)
        );
    },
    onAdoptedSessionBound: (session, chatId) => seedThreadScope(session, chatId),
    assertAgentReady: async (agent, operation) => {
      const descriptor = backendById(agent);
      const snapshot = await backendRuntimeRegistry.resolve(agent);
      const target = operation ? await backendRuntimeRegistry.executionTarget(agent, snapshot, operation) : undefined;
      assertAgentAvailable(snapshot, descriptor.displayName, operation && target ? { ...operation, target } : undefined);
    },
    subscribeTitleEligibility: (wake) => {
      const seen = new Map<string, string>();
      const pending = new Map<string, number>();
      let revision = 0;
      let closed = false;
      const releaseRuntime = backendRuntimeRegistry.subscribe((backend, snapshot) => {
        if (backend !== settings.get().titleAgent) return;
        const request = ++revision;
        pending.set(backend, request);
        void backendRuntimeRegistry.operationEligibility(backend, "title", titlePlan(backend), snapshot).then((eligibility) => {
          if (closed || pending.get(backend) !== request) return;
          /* A backend without a headless title purpose is never eligible by that
             measure, so authentication is the only fact that can wake its jobs. */
          const signature = JSON.stringify([snapshot.runtimeStatus, snapshot.generation, eligibility,
            ...(usesOneShotTitles(snapshot, backend) ? [snapshot.authStatus] : [])]);
          if (seen.get(backend) === signature) return;
          seen.set(backend, signature);
          wake();
        }).catch((cause) => console.warn("[titles] Eligibility observation failed", cause));
      });
      let titleSettings = JSON.stringify([settings.get().titleAgent, settings.get().titleModelByBackend]);
      const releaseSettings = settings.onChanged(() => {
        const next = JSON.stringify([settings.get().titleAgent, settings.get().titleModelByBackend]);
        if (next === titleSettings) return;
        titleSettings = next;
        pending.clear();
        seen.clear();
        wake();
      });
      return () => { closed = true; releaseRuntime(); releaseSettings(); };
    },
    /* One configured backend, no fallback chain: a backend that cannot answer
       fails outright and the Chat keeps the user's own first message. */
    generateTitle: async (firstMessage, context) => {
      const preferences = settings.get();
      const descriptor = requireProvider(preferences.titleAgent);
      const model = preferences.titleModelByBackend[descriptor.id] ?? null;
      const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
      if (snapshot.runtimeStatus !== "installed") {
        throw new Error(`${descriptor.displayName} 未安装，无法生成标题`);
      }
      if (!usesOneShotTitles(snapshot, descriptor.id) && descriptor.headless) {
        const eligibility = await backendRuntimeRegistry.operationEligibility(
          descriptor.id, "title", titlePlan(descriptor.id, preferences), snapshot);
        if (eligibility.decision === "wait") throw new TitleEligibilityDeferred();
        if (eligibility.decision !== "allow") {
          throw new Error(`${descriptor.displayName} 当前不可用于标题生成`);
        }
        return generateTitle(backendById(descriptor.id as AgentBackendId), titleWorkspace, firstMessage, model, context);
      }
      /* The one-shot route has no purpose eligibility to consult, so it reads the
         authentication conclusion directly: a confirmed "no" is a hard failure, a
         check still in flight is worth waiting for, and an answer the probe can
         never give (OpenCode proves only the handshake) must not block forever. */
      if (snapshot.authStatus === "unauthenticated") {
        throw new Error(`${descriptor.displayName} 未登录，无法生成标题`);
      }
      if (snapshot.authStatus === "checking") throw new TitleEligibilityDeferred();
      return generateTitleWithTurn(
        descriptor, snapshot.runtime, titleWorkspace, firstMessage, model, context);
    },
    withProject: (projectId, task) =>
      projects.runExclusive(async () => {
        if (!getArchive()?.isProjectOpen(projectId)) {
          throw new Error("ARCHIVED: Project 不接受新 chat 或成员绑定");
        }
        if (!projects.isUsable(projectId)) {
          throw new Error(`${PROJECT_UNAVAILABLE}: Project 不存在或文件夹已丢失`);
        }
        return task();
      }),
    withConversationLifecycle: (task) => projects.runExclusive(task),
    cancelConversations,
    releaseConversations,
    validateDeletionFence: (record) => {
      if (record.projectId) projects.assertNoMemoryRebind(record.projectId);
    },
    fenceConversation: async (record) => {
      await galleryCache.fenceConversation(record.id, record.incarnationId);
      await getRelayLedger()?.tombstoneConversation({
        chatId: record.id,
        incarnationId: record.incarnationId,
      });
    },
    memoryDeletion: {
      snapshot: (record, operationId) => {
        if (record.projectId) projects.assertNoMemoryRebind(record.projectId);
        return memory.destructive.snapshotChatDeletion(record, operationId);
      },
      applyPolicy: (intent) => memory.destructive.applyChatTombstone(intent),
      drain: (intent) => memory.destructive.drainChatDeletion(intent),
      applyDelivery: (intent) => memory.destructive.applyChatCleanup(intent),
      verifyReceipts: (intent, policyDigest, deliveryDigests, mode) =>
        memory.destructive.verifyChatDeletionReceipts(
          intent,
          policyDigest,
          deliveryDigests,
          mode
      ),
    },
    admitDeletion: (records) => chatHomes.assertDeletionAdmissible(records),
    deletionPreResources: [
      {
        id: "managed-worktree",
        release: (record) => chatHomes.releaseWorktreeForDeletion(record),
      },
    ],
    deletionResources: [
      {
        id: "relay",
        release: async (record) => {
          const staging = await getRelayLedger()?.releaseConversationResources({
            chatId: record.id,
            incarnationId: record.incarnationId,
          });
          for (const prepared of staging ?? []) {
            await releasePreparedStaging(prepared as PreparedManualTurn);
          }
        },
      },
      {
        id: "gallery",
        release: (record, _attachments, proof) =>
          galleryCache.releaseConversation(
            record.id,
            record.incarnationId,
            proof
          ),
      },
      { id: "base", release: (record) => bases.removeForChat(record) },
      {
        id: "browser",
        release: async (record) => {
          browser.service.releaseChat(record.id);
        },
      },
      {
        /* Chat 一走，指向它的 canonical 路由就是断链：当场作废。 */
        id: "history-route",
        release: async (record) => getHistoryImport()?.onChatRemoved(record.id),
      },
      {
        id: "chat-home",
        release: (record, _attachments, _proof, operationId) =>
          chatHomes.releaseHomeForDeletion(record, operationId),
      },
    ],
    onTitleChanged: (record) => bases.renameForChat(record),
    deletionCoordinator: deletions,
  });
}

export function reconcileAdoptedContinuationRuntime(
  store: ChatStore,
  homes: ChatHomeService,
  chats: ChatsService,
  live: (intentId: string) => boolean
) {
  return reconcileAdoptedContinuations({
    store,
    homes,
    withProject: (_projectId, task) => task(),
    commitWithAttachments: (payloads, commit, chatId) =>
      chats.commitWithAttachments(payloads, commit, chatId),
    publish: () => undefined,
    onSessionBound: (session, chatId) => seedThreadScope(session, chatId),
  }, live);
}


type ManualPrepareDependencies = {
  stagingRoot: string;
  chatHomes: ChatHomeService;
  projects: ProjectsService;
  chatStore: ChatStore;
  chats: ChatsService;
  readSectionAttachment?(sectionId: string, attachmentId: string): Promise<string>;
  resolveWorkspace: WorkspaceResolver;
  skills: SkillsCatalog;
  extensionInventoryVersion(projectContext: TurnProjectContext): string;
  files: FileAuthorizationStore;
  /** Main composition freezes canonical Project/global policy before any staging. */
  resolveProjectTools?: (input: Readonly<{
    projectId: string | null;
    workspace: string;
    /** Built-ins only: a package Provider's turn carries no Project tools. */
    backend: import("../../../../shared/ipc/agent/agent-ipc").AgentBackendId;
    builtinTools: "none" | "read" | "mutate";
    planMode: boolean;
  }>) => Promise<ProjectToolsPreparationSnapshot> | ProjectToolsPreparationSnapshot;
  histories?: {
    export(opaqueId: string): Promise<{ title: string; transcript: string } | null>;
  };
};

export function createManualTurnPreparer({
  stagingRoot,
  chatHomes,
  projects,
  chatStore,
  chats,
  readSectionAttachment,
  resolveWorkspace,
  skills,
  extensionInventoryVersion,
  files,
  resolveProjectTools,
  histories,
}: ManualPrepareDependencies) {
  return async (submission: ManualTurnSubmission) => {
    const runtime = await backendRuntimeRegistry.resolve(
      submission.turn.turnOptions.backend
    );
    const persistence = submission.persistence;
    const stagingScope: AgentWorkspaceScope =
      persistence.kind === "append"
        ? {
            kind: "conversation",
            conversationId: persistence.input.chatId,
          }
        : persistence.kind === "create-app"
          ? { kind: "app", appId: persistence.input.appId }
          : persistence.input.projectId
            ? { kind: "project", projectId: persistence.input.projectId }
            : { kind: "default" };
    const creationChatId =
      persistence.kind === "append" ? undefined : persistence.input.id;
    const creationIdentity = creationChatId
      ? chatHomes.identityForCreation(creationChatId)
      : undefined;
    const projectId = persistence.kind === "append"
      ? undefined
      : persistence.input.projectId ?? null;
    const lifecycleProjectId =
      persistence.kind === "append"
        ? chatStore.getMetadata(persistence.input.chatId)?.projectId ?? null
        : projectId ?? null;
    const resolved = creationIdentity
      ? resolveConversationContext(creationChatId!, projects, chatStore, {
          homeDir: creationIdentity.homeDir,
          projectId,
        })
      : resolveWorkspace(stagingScope);
    const workspace = persistence.kind === "adopt"
      ? importedWorkspace(persistence.input.importOrigin.originalCwd, resolved.workspace) ?? resolved.workspace
      : resolved.workspace;
    const backend = submission.turn.turnOptions.backend;
    const target = await backendRuntimeRegistry.executionTarget(backend, runtime, {
      cwd: workspace, model: submission.turn.turnOptions.model ?? undefined,
    });
    if (submission.authenticationRetry) backendRuntimeRegistry.evidence.bindRetry(
      submission.turn.scope.conversationId, submission.turn.requestId, target
    );
    assertAgentAvailable(runtime, providerDisplayName(backend), {
      conversationId: submission.turn.scope.conversationId, requestId: submission.turn.requestId, target,
    });
    const projectContext = lifecycleProjectId
      ? {
          projectId: lifecycleProjectId,
          projectLifecycleRevision: requireProjectLifecycleRevision(
            projects,
            lifecycleProjectId
          ),
        }
      : { projectId: null, projectLifecycleRevision: null };
    /* A package Provider's turn carries no Project tools (no package has proved MCP support; d4b follow-up slice 2). */
    const toolsBackend = builtinAgent(submission.turn.turnOptions.backend);
    const resolvedTools = !toolsBackend ? undefined : await resolveProjectTools?.({
      projectId: lifecycleProjectId,
      workspace,
      backend: toolsBackend,
      builtinTools: runtime.capabilities.builtinTools,
      planMode: Boolean(submission.turn.planMode),
    });
    const workflowPolicy = workflowTurnPolicyFor(submission.turn.requestId);
    const projectTools = submission.workflow && resolvedTools ? workflowToolSelection(resolvedTools, workflowPolicy) : resolvedTools;
    if (
      projectTools &&
      (projectTools.projectContext.projectId !== projectContext.projectId ||
        projectTools.projectContext.projectLifecycleRevision !==
          projectContext.projectLifecycleRevision)
    ) {
      throw new Error("PROJECT_TOOLS_CANONICAL_CONTEXT_MISMATCH");
    }
    return prepareManualTurn(submission, {
      workspace,
      workspaceScope: stagingScope,
      backend: submission.turn.turnOptions.backend,
      planMode: Boolean(submission.turn.planMode),
      stagingRoot,
      skills,
      files,
      lifecycleProjectId,
      ...(projectTools ? { projectTools } : {}),
      projectContext,
      freezeSkillSelection: async (input) => {
        const before = extensionInventoryVersion(input.projectContext);
        const receipt = await skills.prepareSelectionReceipt({
          ...input,
          visibleInventoryVersion: before,
        });
        const after = extensionInventoryVersion(input.projectContext);
        if (before !== after) {
          throw Object.assign(
            new Error("Extension inventory changed during manual turn preparation"),
            { status: 409 }
          );
        }
        return submission.workflow ? workflowSkillSelection(receipt, workflowPolicy) : receipt;
      },
      sections: {
        conversationId: submission.turn.scope.conversationId,
        get: (chatId) => chatStore.getConversation(chatId),
        readAttachment: readSectionAttachment,
        imageInput: runtime.capabilities.imageInput,
      },
      histories,
      attachments: {
        readRevision: (chatId, messageId) =>
          chats.revisionAttachmentPayloads(chatId, messageId),
      },
    });
  };
}

function requireProjectLifecycleRevision(
  projects: ProjectsService,
  projectId: string
) {
  const revision = projects.getProjectLifecycleRevision(projectId);
  if (!revision) throw new Error("Project lifecycle 记录不存在");
  return revision;
}

type CoordinatorRuntimeDependencies = {
  apps: AppsService;
  ledger: RelayLedger;
  chats: ChatsService;
  settings: SettingsStore;
  memory: MemoryService;
  workspaceFiles: WorkspaceFileCatalog;
  stagingRoot: string;
  prepareManual: ReturnType<typeof createManualTurnPreparer>;
  lifecycleIntents: LifecycleIntentStore;
  projects: ProjectsService;
  projectStore: ProjectStore;
  galleryMedia: GalleryRuntime["media"];
  getArchive: () => ArchiveService | null;
};

export function createConversationCoordinator({
  apps,
  ledger,
  chats,
  settings,
  memory,
  workspaceFiles,
  stagingRoot,
  prepareManual,
  lifecycleIntents,
  projects,
  projectStore,
  galleryMedia,
  getArchive,
}: CoordinatorRuntimeDependencies) {
  return new ConversationCoordinator({
    resolveProjectToolsRuntimeIdentity,
    isConversationTransitioning: async (conversationId) => {
      const pending = await lifecycleIntents.pendingByClaims([
        `chat:${conversationId}`,
      ]);
      return pending.some((intent) => intent.kind === "save-as-app");
    },
    ledger,
    chats,
    settings,
    onManualPersisted: (input) => workspaceFiles.recordRecentFiles(input),
    startTurn: (
      payload,
      assistantMessageId,
      origin,
      resolvedInput,
      assistantSeq,
      admissionHeld,
      projectTools,
      trustedAuthority
    ) =>
      startAgentPayload(
        payload,
        undefined,
        assistantMessageId,
        origin,
        resolvedInput,
        assistantSeq,
        admissionHeld,
        projectTools,
        trustedAuthority
      ),
    onAgentSwitchCommitted: (conversationId) => { releaseThreadScopeForConversation(conversationId); },
    rebuildSessionForTools: async (conversationId, expected) => {
      await chats.replaceSession(
        { conversationId },
        expected,
        null
      );
      releaseThreadScopeForConversation(conversationId);
    },
    assertProjectToolsContext: (context) => {
      if (context.projectId === null) {
        if (context.projectLifecycleRevision !== null) {
          throw new Error("PROJECT_TOOLS_LIFECYCLE_MISMATCH");
        }
        return;
      }
      if (context.projectLifecycleRevision === null) {
        throw new Error("PROJECT_TOOLS_LIFECYCLE_MISMATCH");
      }
      projectStore.assertLifecycle(
        context.projectId,
        context.projectLifecycleRevision
      );
    },
    cancelTurn: (requestId) => cancelAgentTurn(requestId),
    registerSteerOperation: (requestId) =>
      registerAgentSteerOperation(requestId),
    steerTurn: (requestId, input) => steerAgentTurn(requestId, input),
    hasActivity: hasConversationActivity,
    switchActivityReason: conversationSwitchActivityReason,
    reconcileMemory: () => memory.reconcile(),
    prepareManual,
    canDispatchManual: async (turn) => {
      if (!apps.conversationEnabled(turn.scope.conversationId)) return false;
      const backend = turn.turnOptions.backend;
      /* A safety lock would refuse the start; the message waits and the lock's release wakes the queue (F-04/F-32). */
      if (agentProcessSafetyLock(backend)) return false;
      const snapshot = await backendRuntimeRegistry.resolveForSpawn(backend);
      const bound = backendRuntimeRegistry.evidence.retryTarget(turn.scope.conversationId, turn.requestId);
      let cwd: string | undefined;
      // A context that cannot be resolved (a missing Chat folder) fails the start itself, visibly; it never throws here.
      try { cwd = chats.store.getHomeDir(turn.scope.conversationId) ? resolveConversationContext(turn.scope.conversationId, projects, chats.store).workspace : undefined; }
      catch { cwd = undefined; }
      const target = bound ?? await backendRuntimeRegistry.executionTarget(backend, snapshot, { cwd, model: turn.turnOptions.model ?? undefined });
      try { assertAgentAvailable(snapshot, providerDisplayName(backend), { conversationId: turn.scope.conversationId, requestId: turn.requestId, target }); return true; }
      catch { return false; }
    },
    assertManualAvailability: async (submission) => {
      apps.assertConversationEnabled(submission.turn.scope.conversationId);
      const backend = submission.turn.turnOptions.backend;
      const snapshot = await backendRuntimeRegistry.resolveForSpawn(backend);
      const conversationId = submission.turn.scope.conversationId;
      const target = await backendRuntimeRegistry.executionTarget(backend, snapshot, {
        model: submission.turn.turnOptions.model ?? undefined,
      });
      if (submission.authenticationRetry) {
        // The preparer binds the final workspace scope before accepting a message.
        assertInstalledRuntime(snapshot, providerDisplayName(backend));
        const bound = backendRuntimeRegistry.evidence.retryTarget(conversationId, submission.turn.requestId);
        if (bound) assertAgentAvailable(snapshot, providerDisplayName(backend), { conversationId, requestId: submission.turn.requestId, target: bound });
        return;
      }
      assertAgentAvailable(snapshot, providerDisplayName(backend), { conversationId, requestId: submission.turn.requestId, target });
    },
    assertGallery: (gallery, context) =>
      assertTrustedGallerySubmission(gallery, {
        ...context,
        resolveRuntime: (backend) => backendRuntimeRegistry.resolve(backend),
        assertSource: (sourceRef, destinationChatId) =>
          galleryMedia.assertAuthorizedSource(sourceRef, destinationChatId),
      }),
    reconcileStaging: (owners) => reconcilePreparedStaging(stagingRoot, owners),
    isConversationAvailable: (conversationId) =>
      getArchive()?.isConversationAvailable(conversationId) ?? true,
    getConversationAvailability: (conversationId, projectId) =>
      getArchive()?.getConversationAvailability(conversationId, projectId) ??
      "open",
    withWorkspaceLifecycle: (task) => projects.runExclusive(task),
    getProjectWorkspaceSnapshot: (projectId) => {
      const project = projectStore.get(projectId);
      return project
        ? {
            membershipRevision: project.membershipRevision,
            workspaceBinding: project.workspaceBinding,
          }
        : undefined;
    },
    isExternalProject: (projectId) =>
      projectStore.get(projectId)?.workspaceBinding.kind === "external",
  });
}

type ArchiveRuntimeDependencies = {
  userData: string;
  chatStore: ChatStore;
  projectStore: ProjectStore;
  chatHomes: ChatHomeService;
  coordinator: ConversationCoordinator;
  chats: ChatsService;
  projects: ProjectsService;
  baseStore: BaseStore;
  memory: MemoryService;
  memoryLifecycle: MemoryLifecycleOrchestrator;
  settings: SettingsStore;
};

export function createArchiveService({
  userData,
  chatStore,
  projectStore,
  chatHomes,
  coordinator,
  chats,
  projects,
  baseStore,
  memory,
  memoryLifecycle,
  settings,
}: ArchiveRuntimeDependencies) {
  return new ArchiveService(
    chatStore,
    projectStore,
    chatHomes,
    new PurgeJournal(userData),
    coordinator,
    chats,
    projects,
    Date.now,
    (chatIds) =>
      baseStore
        .listRootBases()
        .filter(({ ownerKey }) => {
          const owner = ownerFromKey(ownerKey);
          return owner.kind === "chat" && chatIds.has(owner.chatId);
        }).length,
    {
      preview: async (excludedChatIds) => {
        const preview = await memory.previewRebuild(
          settings.get().memory.provider,
          excludedChatIds
        );
        return {
          providerId: preview.providerId,
          providerDataInstanceId: preview.providerDataInstanceId,
          hostname: preview.hostname,
          model: preview.model,
          chats: preview.chats,
          turns: preview.turns,
        };
      },
      cleanupAndRebuild: async (operationId, target) => {
        const current = await memory.previewRebuild(target.providerId, new Set());
        if (current.providerDataInstanceId !== target.providerDataInstanceId) {
          throw new Error("Memory provider instance 已变化，请重新确认");
        }
        await memoryLifecycle.runRebuild(target.providerId, () =>
          memory.rebuildWithinLifecycle(target.providerId, operationId)
        );
      },
    }
  );
}
