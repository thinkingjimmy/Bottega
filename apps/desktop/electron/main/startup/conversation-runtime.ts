/**
 * [INPUT]: Depends on Chat/Project/App/Memory/Gallery/Browser/History services, canonical Project Tools resolver, scoped Extension inventory, Skills selection authority, manual staging, RelayLedger, and backend bridge
 * [OUTPUT]: Provides conversation services and manual preparation that freezes canonical Project lifecycle, Project Tools policy, and exact Skill selection before durable admission
 * [POS]: The conversation-domain startup composition module; assembles dependencies without holding global lifecycle state
 */

import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { AgentWorkspaceScope } from "../../../shared/agent-ipc";
import type { TurnProjectContext } from "../../../shared/product-resource-scope";
import { ownerFromKey } from "../../../shared/bases-ipc";
import { PROJECT_UNAVAILABLE } from "../../../shared/projects-ipc";
import type { TrustedManualTurnSubmission as ManualTurnSubmission } from "../../../shared/sections-ipc";
import {
  cancelAgentTurn,
  cancelConversations,
  hasConversationActivity,
  registerAgentSteerOperation,
  releaseConversations,
  releaseThreadScopeForConversation,
  seedThreadScope,
  startAgentPayload,
  steerAgentTurn,
} from "../agent-bridge";
import type { AppsService } from "../apps/apps-service";
import { ArchiveService } from "../archive/archive-service";
import { backendById, backendRuntimeRegistry, orderedBackends } from "../backends";
import type { BaseStore } from "../bases/base-store";
import type { BasesService } from "../bases/bases-service";
import type { BrowserRuntime } from "../browser/bootstrap";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import { PurgeJournal } from "../chat-home/purge-journal";
import type { ChatStore } from "../chats/chat-store";
import { ChatsService } from "../chats/chats-service";
import { generateTitle } from "../chats/title-generator";
import type { ConversationDeletionCoordinator } from "../deletion/conversation-deletion-coordinator";
import type { FileAuthorizationStore } from "../file-authorizations";
import type { GalleryRuntime } from "../gallery/bootstrap";
import { HistoryImportService } from "../history-import/service";
import { assertTrustedGallerySubmission } from "../gallery/submission-authority";
import type { LifecycleIntentStore } from "../lifecycle/intent-store";
import type { MemoryLifecycleOrchestrator } from "../memory/runtime/control/lifecycle-orchestrator";
import type { MemoryService } from "../memory/service/memory-service";
import type { ProjectStore } from "../projects/project-store";
import type { ProjectsService } from "../projects/projects-service";
import {
  prepareManualTurn,
  reconcilePreparedStaging,
  releasePreparedStaging,
  type PreparedManualTurn,
} from "../sections/coordinator/admission/prepared-manual-turn";
import type { ProjectToolsPreparationSnapshot } from "../sections/coordinator/admission/prepared-project-tools";
import { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { RelayLedger } from "../sections/coordinator/relay-ledger";
import type { SettingsStore } from "../settings-store";
import type { SkillsCatalog, WorkspaceResolver } from "../skills-catalog";
import { resolveConversationContext } from "../workspace-resolver";
import type { WorkspaceFileCatalog } from "../workspace-files";

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
}: ChatsRuntimeDependencies) {
  return new ChatsService(store, {
    chatHomes,
    isConversationTransitioning: (chatId) =>
      getCoordinator()?.isTransitioning(chatId) ?? Promise.resolve(false),
    isProjectArchived: (projectId) =>
      Boolean(projectStore.get(projectId)?.archivedAt),
    attachmentsRoot: join(userData, "chat-attachments"),
    exportsRoot: join(userData, "exports"),
    resolveAppAgent: (appId, projectId) =>
      projects.isAppBinding(projectId, appId)
        ? apps.resolveInteractiveAgent(appId)
        : undefined,
    isAppProject: (projectId) =>
      projectStore.get(projectId)?.workspaceBinding.kind === "app",
    onAppChatCreated: async ({ appId, appRole, chatId }) => {
      await apps
        .markChatCanonical(appId, appRole, chatId)
        .catch((cause) =>
          console.warn("[apps] canonical chat 槽位回填等待启动对账", cause)
        );
    },
    onAdoptedSessionBound: (session, chatId) => seedThreadScope(session, chatId),
    assertAgentReady: async (agent) => {
      const descriptor = backendById(agent);
      const snapshot = await backendRuntimeRegistry.resolve(agent);
      if (snapshot.runtimeStatus !== "installed") {
        throw new Error(
          `${descriptor.displayName} 当前不可用，请重新选择 Agent`
        );
      }
    },
    generateTitle: async (firstMessage) => {
      const preferences = settings.get();
      const explicit = preferences.titleAgent;
      const candidates =
        explicit === "auto" ? orderedBackends() : [backendById(explicit)];
      let selected;
      for (const descriptor of candidates) {
        const snapshot = await backendRuntimeRegistry.resolve(descriptor.id);
        if (
          snapshot.runtimeStatus === "installed" &&
          snapshot.authStatus === "authenticated" &&
          snapshot.capabilities.headless.includes("title") &&
          descriptor.headless
        ) {
          selected = descriptor;
          break;
        }
      }
      if (!selected) {
        throw new Error(
          explicit === "auto"
            ? "没有可用于标题生成的 Agent"
            : `${backendById(explicit).displayName} 当前不可用于标题生成`
        );
      }
      return generateTitle(
        selected,
        titleWorkspace,
        firstMessage,
        preferences.titleModelByBackend[selected.id] ?? null
      );
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
    ],
    onTitleChanged: (record) => bases.renameForChat(record),
    deletionCoordinator: deletions,
  });
}

type HistoryImportRuntimeDependencies = Readonly<{
  userData: string;
  home: string;
  projects: ProjectsService;
  projectStore: ProjectStore;
  chats: ChatStore;
  settings: SettingsStore;
  memory: MemoryService;
  getCoordinator: () => ConversationCoordinator | null;
}>;

export async function initializeHistoryImportService({
  userData,
  home,
  projects,
  projectStore,
  chats,
  settings,
  memory,
  getCoordinator,
}: HistoryImportRuntimeDependencies) {
  const service = new HistoryImportService(userData, {
    home,
    listProjects: () => projectStore.list(),
    getProject: (projectId) => projectStore.get(projectId),
    prepareProject: () => projects.prepareExternalProject(),
    commitProject: (input) => projects.commitExternalProject(input),
    listSessionBindings: () => chats.listBindings(),
    getAdoptionBinding: (chatId) => chats.getAdoptionBinding(chatId),
    memoryState: () => {
      const memorySettings = settings.get().memory;
      const status = memory.status();
      const consent = memory.policy.activeConsent();
      return {
        enabled: memorySettings.enabled,
        ready: status.health === "ready" || status.health === "compat",
        sharingMode: memorySettings.sharingMode,
        providerId: status.target?.providerId ?? null,
        providerDataInstanceId:
          status.target?.providerDataInstanceId ?? null,
        consentEpochId: consent?.id ?? null,
      };
    },
    commitMemory: ({ grantId, snapshots, authorization }) =>
      memory.importForeignHistory({ grantId, snapshots, authorization }),
    previewProductMemory: () => memory.previewExistingProductHistory(),
    commitProductMemory: (grantId, intent) =>
      memory.commitExistingProductHistory(grantId, intent),
    productMemoryCommitted: (grantId) =>
      memory.existingProductHistoryCommitted(grantId),
    adopt: async ({ request, entry, snapshot }) => {
      const coordinator = getCoordinator();
      const project = projectStore.get(entry.projectId);
      if (!coordinator || !project) throw new Error("收养运行时尚未就绪");
      if (request.turnOptions.backend !== entry.sourceKind) {
        throw new Error("续聊 Agent 必须与外源会话同源");
      }
      const chatId = `chat_${randomUUID().replaceAll("-", "")}`;
      const incarnationId = randomUUID().replaceAll("-", "");
      const messageId = `user_${randomUUID().replaceAll("-", "")}`;
      const requestId = `request_${randomUUID().replaceAll("-", "")}`;
      const { submission } = request;
      const turnOptions = await settings.resolveChatOptions(
        { conversationId: request.opaqueId },
        entry.sourceKind
      );
      const content = submission.displayText.trim();
      const session = {
        backend: entry.sourceKind,
        id: entry.key.resumeAlias,
      } as const;
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
            firstMessage: {
              id: messageId,
              role: "user",
              content,
              createdAt: Date.now(),
            },
            ...(submission.attachmentPayloads?.length
              ? { attachmentPayloads: submission.attachmentPayloads }
              : {}),
          },
        },
        turn: {
          requestId,
          scope: { conversationId: chatId },
          session,
          turnOptions,
          ...(submission.planMode ? { planMode: true } : {}),
          input: submission.input,
        },
        content: submission.content,
        precondition: {
          kind: "absent",
          proposedIncarnationId: incarnationId,
        },
        workspacePrecondition: {
          kind: "project",
          projectId: project.id,
          membershipRevision: project.membershipRevision,
        },
      });
      if (receipt.phase === "failed") {
        throw new Error("续聊启动失败，未静默创建空会话");
      }
      return { chatId, incarnationId, phase: receipt.phase };
    },
  });
  await service.initialize();
  await service.snapshots.gcMemoryOrphans();
  return service;
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
    backend: ManualTurnSubmission["turn"]["turnOptions"]["backend"];
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
        ? (await chatStore.get(persistence.input.chatId))?.projectId ?? null
        : projectId ?? null;
    const resolved = creationIdentity
      ? resolveConversationContext(creationChatId!, projects, chatStore, {
          homeDir: creationIdentity.homeDir,
          projectId,
        })
      : resolveWorkspace(stagingScope);
    const workspace = resolved.workspace;
    const projectContext = lifecycleProjectId
      ? {
          projectId: lifecycleProjectId,
          projectLifecycleRevision: requireProjectLifecycleRevision(
            projects,
            lifecycleProjectId
          ),
        }
      : { projectId: null, projectLifecycleRevision: null };
    const projectTools = await resolveProjectTools?.({
      projectId: lifecycleProjectId,
      workspace,
      backend: submission.turn.turnOptions.backend,
      builtinTools: runtime.capabilities.builtinTools,
      planMode: Boolean(submission.turn.planMode),
    });
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
        return receipt;
      },
      sections: {
        conversationId: submission.turn.scope.conversationId,
        get: (chatId) => chatStore.get(chatId),
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
      projectTools
    ) =>
      startAgentPayload(
        payload,
        undefined,
        assistantMessageId,
        origin,
        resolvedInput,
        assistantSeq,
        admissionHeld,
        projectTools
      ),
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
    reconcileMemory: () => memory.reconcile(),
    prepareManual,
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
        .listPinned()
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
