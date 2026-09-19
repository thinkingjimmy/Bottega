/**
 * [INPUT]: Depends on ChatStore/ChatsService, ProjectStore/ProjectsService, SettingsStore, MemoryService, the ConversationCoordinator handle, and HistoryImportService with its adapters
 * [OUTPUT]: Connects display-independent saved-Chat continuation to native resume or cross-Agent replay with canonical admission and durable receipts; snapshot GC runs after window creation.
 * [POS]: The external-history half of the conversation-domain startup composition; conversation-runtime.ts owns the Chat/manual/Coordinator/Archive half
 */

import { randomUUID } from "node:crypto";
import type {
  ForeignHistoryMessage,
  ForeignHistorySummary,
} from "../../../shared/history-import-ipc";
import type { ChatStore } from "../chats/chat-store";
import type { ChatsService } from "../chats/chats-service";
import type { AdapterEntry } from "../history-import/adapter";
import { publicEntry as publicHistoryEntry } from "../history-import/routing/history-policy";
import { HistoryImportService } from "../history-import/service";
import type { MemoryService } from "../memory/service/memory-service";
import type { ProjectStore } from "../projects/store/project-store";
import type { ProjectsService } from "../projects/projects-service";
import type { ConversationCoordinator } from "../sections/coordinator/conversation-coordinator";
import type { SettingsStore } from "../settings-store";

/* 同步与收养必须投出同一条源事实：两处各写一遍的那阵子，收养分支丢了
   archivedAt，「收养一条归档会话」于是在落地的瞬间把它悄悄取消归档。 */
function historyImportSource(
  entry: AdapterEntry,
  summary: ForeignHistorySummary,
  incompleteTail: boolean
) {
  return {
    projectId: entry.projectId,
    sourceKind: entry.sourceKind,
    storageFingerprint: entry.key.storageFingerprint,
    canonicalNativeId: entry.key.canonicalNativeId,
    aliases: entry.key.aliases,
    resumeAlias: entry.key.resumeAlias,
    originalCwd: entry.cwd,
    title: summary.title,
    archivedAt: summary.archived ? summary.updatedAt : null,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    historyRevision: entry.historyRevision,
    sourceIncarnation: entry.sourceIncarnation,
    sourceSize: entry.fingerprint.size,
    sourceMtimeNs: entry.fingerprint.mtimeNs,
    incompleteTail,
    canResume: entry.canResume,
    /* 扫到了这个文件才会走到这里，所以同步一律断言 "match"；源消失后的
       "missing" 由 markImportSourceStatus 补上。 */
    sourceStatus: "match" as const,
  };
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
  /* 同步落成的只读 Chat 必须像其它写入一样播报，否则侧栏要等下一次
     刷新才看得见它。ChatsService 晚于本服务组装，故取惰性句柄。 */
  getChats: () => ChatsService | null;
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
  getChats,
}: HistoryImportRuntimeDependencies) {
  const service = new HistoryImportService(userData, {
    home,
    listProjects: () => projectStore.list(),
    getProject: (projectId) => projectStore.get(projectId),
    prepareProject: () => projects.prepareExternalProject(),
    commitProject: (input) => projects.commitExternalProject(input),
    listSessionBindings: () => chats.listHistoryBindings(),
    chatLifecycle: (chatId) => {
      const metadata = chats.getMetadata(chatId);
      if (!metadata) return "missing";
      return metadata.readOnlyReason === "external-readonly"
        ? "external-readonly"
        : "managed";
    },
    markImportSourceStatus: async (chatId, sourceStatus) => {
      const record = await chats.markImportSourceStatus(chatId, sourceStatus);
      if (record) getChats()?.publishRecord(record);
    },
    syncHistory: async ({ entry, summary, blocks, incompleteTail, signal }) => {
      const result = await chats.syncExternalHistory(
        historyImportSource(entry, summary, incompleteTail),
        blocks,
        signal
      );
      if (!result) return null;
      getChats()?.publishRecord(result.metadata);
      return { chatId: result.chatId, generationId: result.generationId };
    },
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
    replay: async (request, route) => {
      const metadata = chats.getMetadata(route.chatId);
      const origin = metadata?.importOrigin;
      if (!origin || request.turnOptions.backend === origin.sourceKind) return null;
      const coordinator = getCoordinator();
      const project = metadata.projectId ? projectStore.get(metadata.projectId) : undefined;
      const indexed = project ? service.index.project(project.id) : undefined;
      if (!coordinator || !project || !indexed || project.archivedAt ||
        project.workspaceBinding.kind !== "external" || project.membershipRevision !== indexed.membershipRevision ||
        project.dir !== indexed.canonicalRoot || metadata.readOnlyReason !== "external-readonly" || metadata.archivedAt ||
        metadata.context.kind !== "ordinary") throw new Error("Imported Chat is unavailable for continuation");
      if (origin.historyRevision !== request.expectedHistoryRevision) throw Object.assign(
        new Error("历史会话已变化，请刷新后重试"), { code: "HISTORY_REVISION_CHANGED" });
      const page = await chats.timelinePage({ chatId: metadata.id, limit: 1 });
      if (!page?.activeGenerationId || page.activeGenerationId !== route.generationId) {
        throw new Error("Saved-history continuation generation changed");
      }
      const intentId = `adopt_${randomUUID().replaceAll("-", "")}`;
      const { submission } = request;
      const firstMessage = { id: `user_${randomUUID().replaceAll("-", "")}`, role: "user" as const,
        content: submission.displayText.trim(), createdAt: Date.now() };
      const receipt = await coordinator.submitManualTurn({
        ...(request.authenticationRetry ? { authenticationRetry: request.authenticationRetry } : {}),
        intentId,
        persistence: { kind: "adopt", input: {
          id: metadata.id, title: metadata.title || "Imported conversation", agent: request.turnOptions.backend,
          options: request.turnOptions, projectId: project.id, incarnationId: metadata.incarnationId,
          session: null, importOrigin: origin, snapshotDigest: null, firstMessage,
          replay: { generationId: page.activeGenerationId, expectedChatRecordRevision: metadata.chatRecordRevision,
            noticeId: `notice_${randomUUID().replaceAll("-", "")}` },
          ...(submission.attachmentPayloads?.length ? { attachmentPayloads: submission.attachmentPayloads } : {}),
        } },
        turn: { requestId: `request_${randomUUID().replaceAll("-", "")}`,
          scope: { conversationId: metadata.id }, turnOptions: request.turnOptions,
          ...(submission.planMode ? { planMode: true } : {}), input: submission.input },
        content: submission.content,
        precondition: { kind: "absent", proposedIncarnationId: metadata.incarnationId },
        workspacePrecondition: { kind: "project", projectId: project.id, membershipRevision: project.membershipRevision },
      });
      return { intentId, chatId: metadata.id, incarnationId: metadata.incarnationId, phase: receipt.phase };
    },
    adopt: async ({ request, entry, snapshot, route }) => {
      const coordinator = getCoordinator();
      const project = projectStore.get(entry.projectId);
      if (!coordinator || !project) throw new Error("收养运行时尚未就绪");
      if (request.turnOptions.backend !== entry.sourceKind) {
        throw new Error("续聊 Agent 必须与外源会话同源");
      }
      /* 已有 canonical 路由就直接续写它：重开同一个 begin-history-import
         会以同 operationId 携不同 requestHash 被账本硬拒。 */
      const imported = route ?? await chats.syncExternalHistory(
        historyImportSource(
          entry,
          publicHistoryEntry(entry),
          snapshot.incompleteTail
        ),
        snapshot.blocks as ForeignHistoryMessage[]
      );
      const chatId = imported?.chatId ?? `chat_${randomUUID().replaceAll("-", "")}`;
      /* 只读 Chat 已经有身份；收养沿用它，绝不换代——换代会让刚刚还在看的
         那条会话的深链、AppGrant 上下文与时间线游标在同一瞬间全部作废。 */
      const incarnationId = chats.getMetadata(chatId)?.incarnationId
        ?? randomUUID().replaceAll("-", "");
      const messageId = `user_${randomUUID().replaceAll("-", "")}`;
      const requestId = `request_${randomUUID().replaceAll("-", "")}`;
      const intentId = `adopt_${randomUUID().replaceAll("-", "")}`;
      const { submission } = request;
      const turnOptions = request.turnOptions;
      const content = submission.displayText.trim();
      const session = {
        backend: entry.sourceKind,
        id: entry.key.resumeAlias,
      } as const;
      const receipt = await coordinator.submitManualTurn({
        ...(request.authenticationRetry ? { authenticationRetry: request.authenticationRetry } : {}),
        intentId,
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
      return { intentId, chatId, incarnationId, phase: receipt.phase };
    },
  });
  await service.initialize();
  return service;
}
