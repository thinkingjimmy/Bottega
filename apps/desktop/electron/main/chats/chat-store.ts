/**
 * [INPUT]: Depends on Node crypto, ProductFailure, chat lifecycle/projection collaborators, device identity, the typed SQLite worker client, the shared ChatStoreState cell with its read-model and history/continuation collaborators, Chat store paths, Project-to-App identity, and SerialQueue
 * [OUTPUT]: Provides the canonical ChatStore facade with receipt-gated SQLite mutations, external-history sync/continuation, the queued maintenance gate, SQLite runtime diagnostics, metadata cache, bounded timeline/search queries, and durable revisions
 * [POS]: Main-process Chat domain queue and metadata owner; the dedicated worker owns every durable write while pure transitions, read projections, and import/continuation sagas live in focused composed siblings
 */

import { createHash, randomUUID } from "node:crypto";
import type { AgentBackendId, SessionRef } from "../../../shared/agent-ipc";
import {
  type AppChatRole,
  type ChatAttachmentMeta,
  type ChatFindInput,
  type ChatMessage,
  type ChatOutlineInput,
  type ChatRecord,
  type ChatTimelineAroundInput,
  type ChatTimelinePageInput,
  type TurnCommitInput,
  type UnsequencedChatMessage,
  type UnsequencedUserMessage,
} from "../../../shared/chats-ipc";
import type {
  AppCapabilityGrant,
  AppGrantRecord,
} from "../../../shared/apps-ipc";
import { metadataOf, type ChatFacts } from "./chat-summary";
import { chatFactsSchema } from "./chat-schema";
import {
  ChatNotFoundError,
  applyTurnCommit,
} from "./chat-commit";
import { assertChatId } from "./chat-guards";
import type { ChatTitleJob } from "../../../shared/placement/facts";
import {
  createChatRecord,
  withCommitRevisions,
  withFactRevision,
  type ChatCreateIdentity,
} from "./chat-record-lifecycle";
import { DeviceIdentityStore } from "./device-identity/device-identity";
import { ChatDatabaseClient } from "./sqlite/database-client";
import type { SearchDocumentCursor } from "./sqlite/database-protocol";
import { ChatStoreState } from "./store/state";
import { ChatReadModel } from "./store/read-api";
import { ChatHistorySagaApi } from "./store/sqlite-api";
import {
  ChatMutationOutcomeUnknownError,
  type ChatMessageMutation,
} from "./store/mutation-outcome";
import {
  bindSessionRecord,
  assertReadonlyPresentationMutation,
  clearProjectRecord,
  moveProjectRecord,
  replaceSessionRecord,
  reviseTailRecord,
  revokeGrantRecord,
  setGeneratedTitleRecord,
  setGrantRecord,
  setProjectRecord,
  setUserTitleRecord,
} from "./store/transitions";
import { chatDatabasePath } from "./sqlite/paths";
import {
  persistAppendedMessageToStorage,
  persistFactsToStorage,
  persistRecordToStorage,
  persistTurnCommitToStorage,
} from "./store/persistence";

export {
  ChatMutationOutcomeUnknownError,
  isChatMutationOutcomeUnknown,
  type ChatMessageMutation,
} from "./store/mutation-outcome";

export type ChatStoreDependencies = {
  now?: () => number;
  isAppProject?: (projectId: string) => boolean;
  appForProject?: (projectId: string) =>
    | { appId: string; editableSource: boolean }
    | null;
  databaseClient?: () => ChatDatabaseClient;
};

export type ChatSqliteRuntimeFacts = Readonly<{
  sqliteVersion: string;
  compileOptions: readonly string[];
  startupMs: number;
}>;

const clone = <T>(value: T): T => structuredClone(value);
const sessionKey = (session: SessionRef) =>
  `${session.backend}:${session.id}`;
const requestHash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

export class ChatStore {
  /* 组合而非继承：一个可变格子 + 两个只拿到它的协作者。ChatStore 仍是
     唯一的公开门面，读投影与 import/continuation saga 只是它显式转交的两半。 */
  private readonly state: ChatStoreState;
  private readonly reads: ChatReadModel;
  private readonly history: ChatHistorySagaApi;
  private readonly databasePath: string;
  private sqliteRuntimeFacts: ChatSqliteRuntimeFacts | null = null;

  constructor(
    userData: string,
    private readonly dependencies: ChatStoreDependencies = {}
  ) {
    this.state = new ChatStoreState(userData, dependencies.now ?? Date.now);
    this.reads = new ChatReadModel(this.state);
    this.history = new ChatHistorySagaApi(this.state, this.reads);
    this.databasePath = chatDatabasePath(userData);
  }

  async initialize() {
    await this.state.queue.enqueue(async () => {
      const state = this.state;
      state.metadata.clear();
      state.messageRevisions.clear();
      state.activeRecord = undefined;
      state.warnings.length = 0;
      state.storageFailures.length = 0;
      this.sqliteRuntimeFacts = null;

      state.deviceId = await new DeviceIdentityStore(state.userData).loadOrCreate();
      const initialization = await this.openDatabase();
      this.sqliteRuntimeFacts = Object.freeze({
        sqliteVersion: initialization.sqliteVersion,
        compileOptions: Object.freeze([...initialization.compileOptions]),
        startupMs: initialization.startupMs,
      });
      if (process.versions.electron) {
        console.info("[chats] SQLite runtime", this.sqliteRuntimeFacts);
      }
      const metadata = await state.requireDatabase().execute({
        kind: "list-metadata",
        deviceId: state.requireDeviceId(),
      });
      for (const record of metadata) {
        state.metadata.set(record.id, record);
        state.messageRevisions.set(record.id, record.chatMessageRevision);
      }
    });
  }

  create(
    chatId: string,
    firstMessage: UnsequencedUserMessage | ChatMessage,
    projectId: string | null = null,
    agent: AgentBackendId = "codex",
    identity?: ChatCreateIdentity
  ) {
    return this.state.queue.enqueue(async () => {
      assertChatId(chatId);
      if (this.state.metadata.has(chatId)) throw new Error("聊天 id 已存在");
      if (identity?.session) {
        const owner = [...this.state.metadata.values()].find((record) => record.session && sessionKey(record.session) === sessionKey(identity.session!));
        if (owner) throw new Error(`SessionRef 已由聊天 ${owner.id} 持有`);
      }
      const { record, message } = createChatRecord({
        chatId,
        firstMessage,
        projectId,
        agent,
        identity: identity ?? {},
        projects: this.dependencies,
      });
      await this.persistRecord(record);
      this.state.metadata.set(chatId, metadataOf(record));
      this.state.touch();
      this.state.messageRevisions.set(chatId, record.chatMessageRevision);
      const revision = record.chatMessageRevision;
      this.state.remember(record, revision);
      return {
        record: clone(record),
        revision,
        appended: clone(record.messages),
        storedMessage: clone(message),
      } satisfies ChatMessageMutation;
    });
  }

  appendMessage(
    chatId: string,
    input: ChatMessage | UnsequencedChatMessage,
    reservedSeq?: number
  ) {
    return this.state.queue.enqueue(async () => {
      assertChatId(chatId);
      const current = await this.requireRecord(chatId);
      const existing = current.messages.find(
        (message) => message.id === input.id
      );
      const seq =
        "seq" in input
          ? input.seq
          : (reservedSeq ?? existing?.seq ?? current.nextSeq);
      const message = { ...input, seq } as ChatMessage;
      const result = applyTurnCommit(
        {
          ...current,
          nextSeq: Math.max(current.nextSeq, seq + 1),
        },
        { message }
      );
      const record = result.appended
        ? withCommitRevisions(current, result.record, true)
        : result.record;
      if (result.appended) {
        await this.persistAppendedMessage(
          current,
          record,
          result.storedMessage!
        );
        this.state.metadata.set(chatId, metadataOf(record));
      }
      const appended =
        result.appended && result.storedMessage
          ? [result.storedMessage]
          : [];
      const revision = appended.length
        ? record.chatMessageRevision
        : this.state.revisionOf(chatId);
      if (result.appended) {
        this.state.messageRevisions.set(chatId, revision);
        this.state.remember(record, revision);
      }
      return {
        record: clone(record),
        revision,
        appended: clone(appended),
        ...(result.storedMessage
          ? { storedMessage: clone(result.storedMessage) }
          : {}),
      } satisfies ChatMessageMutation;
    });
  }

  reviseTail(input: {
    chatId: string;
    supersedes: {
      supersedesUserMessageId: string;
      throughSeqEnd: number;
    };
    message: UnsequencedUserMessage;
    reservedSeq?: number;
    intentId?: string;
  }) {
    return this.state.queue.enqueue(async () => {
      assertChatId(input.chatId);
      const current = await this.requireRecord(input.chatId);
      const transition = reviseTailRecord(current, input, this.state.now());
      if (transition.kind === "replay") {
        return {
          record: clone(current),
          revision: this.state.revisionOf(input.chatId),
          appended: [],
          storedMessage: clone(transition.message),
        } satisfies ChatMessageMutation;
      }
      const { record, message } = transition;
      await this.persistRecord(record);
      this.state.metadata.set(input.chatId, metadataOf(record));
      const revision = record.chatMessageRevision;
      this.state.messageRevisions.set(input.chatId, revision);
      this.state.remember(record, revision);
      return {
        record: clone(record),
        revision,
        appended: [clone(message)],
        storedMessage: clone(message),
        mode: "replace",
      } satisfies ChatMessageMutation;
    });
  }

  async reserveSequences(chatId: string, count: number) {
    if (!Number.isInteger(count) || count < 1) {
      throw new Error("消息序号预留数量无效");
    }
    const facts = await this.updateFacts(chatId, (current) => ({
      ...current,
      nextSeq: current.nextSeq + count,
    }));
    const first = facts.nextSeq - count;
    return Array.from({ length: count }, (_, index) => first + index);
  }

  async ensureNextSequence(chatId: string, minimum: number) {
    const facts = await this.updateFacts(chatId, (current) =>
      current.nextSeq >= minimum ? current : { ...current, nextSeq: minimum }
    );
    return facts.nextSeq;
  }

  appendTurnResult(chatId: string, input: TurnCommitInput) {
    return this.state.queue.enqueue(async () => {
      assertChatId(chatId);
      const current = await this.requireRecord(chatId);
      const result = applyTurnCommit(current, input);
      const changed = result.appended || result.subagentsChanged;
      const record = changed
        ? withCommitRevisions(current, result.record, result.appended)
        : result.record;
      if (changed) {
        if (result.subagentsChanged) {
          await this.persistTurnCommit(current, record, result.storedMessage ?? null);
        } else if (result.appended) {
          await this.persistAppendedMessage(
            current,
            record,
            result.storedMessage!
          );
        }
        this.state.metadata.set(chatId, metadataOf(record));
      }
      const appended =
        result.appended && result.storedMessage
          ? [result.storedMessage]
          : [];
      const revision = appended.length
        ? record.chatMessageRevision
        : this.state.revisionOf(chatId);
      if (changed) {
        if (result.appended) this.state.messageRevisions.set(chatId, revision);
        this.state.remember(record, revision);
      }
      return {
        record: clone(record),
        revision,
        appended: clone(appended),
        ...(result.storedMessage
          ? { storedMessage: clone(result.storedMessage) }
          : {}),
      } satisfies ChatMessageMutation;
    });
  }

  bindSession(chatId: string, session: SessionRef) {
    return this.updateFacts(chatId, (current) =>
      bindSessionRecord(current, chatId, session, this.state.metadata.values())
    );
  }

  replaceSession(
    chatId: string,
    expected: SessionRef,
    next: SessionRef | null
  ) {
    return this.updateFacts(chatId, (current) =>
      replaceSessionRecord(current, chatId, expected, next, this.state.metadata.values())
    );
  }

  async assertBackend(chatId: string, backend: AgentBackendId) {
    const record = this.getMetadata(chatId);
    if (!record) throw new Error("聊天不存在");
    if (record.agent !== backend) throw new Error("Agent backend 与聊天绑定不一致");
  }

  setTitle(chatId: string, title: string) {
    if (this.state.metadata.get(chatId)?.readOnlyReason === "external-readonly") {
      return this.history.updateReadonlyPresentation(chatId, {
        kind: "title",
        title: title.trim(),
      });
    }
    return this.updateFacts(chatId, (current) =>
      setUserTitleRecord(current, title, this.state.now())
    );
  }

  setAppGrant(chatId: string, grant: AppCapabilityGrant) {
    return this.setAppGrantRecord(chatId, grant);
  }

  setAppGrantRecord(chatId: string, grant: AppGrantRecord) {
    return this.updateFacts(chatId, (current) =>
      setGrantRecord(current, grant, this.dependencies.isAppProject)
    );
  }

  revokeAppGrant(chatId: string, appId: string) {
    return this.updateFacts(chatId, (current) => revokeGrantRecord(current, appId));
  }

  /** 只允许根级 chat 单向升级为一个 Project；不改变消息 revision。 */
  setProjectId(chatId: string, projectId: string) {
    return this.updateFacts(chatId, (current) =>
      setProjectRecord(current, projectId, this.dependencies.isAppProject)
    );
  }

  /** lifecycle saga 专用：允许根级/普通分组迁入 App Project。 */
  moveChatProject(
    chatId: string,
    input: {
      expectedSource: string | null;
      target: string | null;
      appRole?: AppChatRole | null;
    }
  ) {
    return this.updateFacts(chatId, (current) =>
      moveProjectRecord(current, input, this.dependencies)
    );
  }

  /** 只供记录丢失的 Project 抢救；null 输入态幂等，不改变消息 revision。 */
  clearProjectId(chatId: string) {
    return this.updateFacts(chatId, clearProjectRecord);
  }

  /** 仅在标题仍为 null 时写入生成标题：用户改名永远不会被后到的生成结果覆盖 */
  setGeneratedTitle(
    chatId: string,
    title: string,
    receipt: Extract<ChatTitleJob, { state: "pending" }>
  ) {
    return this.updateFacts(chatId, (current) =>
      setGeneratedTitleRecord(current, title, receipt, this.state.now())
    );
  }

  has(chatId: string) {
    return this.state.metadata.has(chatId);
  }

  setArchivedAt(chatId: string, archivedAt: number | undefined) {
    if (this.state.metadata.get(chatId)?.readOnlyReason === "external-readonly") {
      return this.history.updateReadonlyPresentation(chatId, {
        kind: "archive",
        archivedAt: archivedAt ?? null,
      });
    }
    return this.updateFacts(chatId, (current) => ({
      ...current,
      archivedAt,
    }));
  }

  /** 删除聊天并返回其附件元数据；附件文件清理由持有 AttachmentStore 的调用方负责 */
  remove(
    chatId: string,
    expectedIncarnationId?: string
  ): Promise<ChatAttachmentMeta[]> {
    return this.state.queue.enqueue(async () => {
      assertChatId(chatId);
      if (!this.state.metadata.has(chatId)) throw new Error("聊天不存在");
      const actualIncarnationId = this.state.metadata.get(chatId)?.incarnationId;
      if (
        expectedIncarnationId &&
        actualIncarnationId !== expectedIncarnationId
      ) {
        throw new Error("INCARNATION_MISMATCH");
      }
      const database = this.state.requireDatabase();
      const deviceId = this.state.requireDeviceId();
      const operationId = randomUUID();
      const command = {
        kind: "remove-record" as const,
        operationId,
        requestHash: requestHash({ operationId, chatId, deviceId, expectedIncarnationId }),
        chatId,
        deviceId,
        ...(expectedIncarnationId ? { expectedIncarnationId } : {}),
      };
      const outcome = await database.execute(command);
      if (outcome.status !== "committed") {
        if (outcome.status === "outcome_unknown") {
          throw new ChatMutationOutcomeUnknownError(
            outcome.operationId,
            outcome.reason
          );
        }
        throw new Error(outcome.failure.message);
      }
      this.state.metadata.delete(chatId);
      this.state.touch();
      this.state.messageRevisions.delete(chatId);
      if (this.state.activeRecord?.record.id === chatId) {
        this.state.activeRecord = undefined;
      }
      return clone(outcome.receipt.result.attachments);
    });
  }

  /* 不变量检查也是一次写：integrity_check、FTS 合并与 TRUNCATE 都要独占
     这条连接。排进同一条串行队列，它就永远不会与一次提交同场竞技。 */
  runMaintenance() {
    return this.state.queue.enqueue(() =>
      this.state.requireDatabase().execute({ kind: "maintenance-gate" })
    );
  }

  async closeAndFlush() {
    this.state.queue.close();
    await this.state.queue.flush();
    const database = this.state.database;
    this.state.database = null;
    await database?.close();
  }

  async reopen() {
    this.state.queue.reopen();
    if (!this.state.database) await this.openDatabase();
  }

  /* ---------------------------------------------------------------- *
   *  读模型：全部转交 ChatReadModel，ChatStore 不再自持任何读实现。
   * ---------------------------------------------------------------- */
  list() { return this.reads.list(); }
  getMetadata(chatId: string) { return this.reads.getMetadata(chatId); }
  getNativeMessage(
    chatId: string,
    selector: Parameters<ChatReadModel["getNativeMessage"]>[1]
  ) { return this.reads.getNativeMessage(chatId, selector); }
  getNativeMessages(chatId: string) { return this.reads.getNativeMessages(chatId); }
  getNativeSubagents(chatId: string) { return this.reads.getNativeSubagents(chatId); }
  getConversation(chatId: string) { return this.reads.getConversation(chatId); }
  getRuntimeContext(chatId: string) { return this.reads.getRuntimeContext(chatId); }
  get(chatId: string) { return this.reads.get(chatId); }
  timelinePage(input: ChatTimelinePageInput) { return this.reads.timelinePage(input); }
  timelineAround(input: ChatTimelineAroundInput) { return this.reads.timelineAround(input); }
  outlinePage(input: ChatOutlineInput) { return this.reads.outlinePage(input); }
  findMessages(input: ChatFindInput) { return this.reads.findMessages(input); }
  getWarning() { return this.reads.getWarning(); }
  getStorageFailures() { return this.reads.getStorageFailures(); }
  pushWarning(message: string) { this.reads.pushWarning(message); }
  getProjectId(chatId: string) { return this.reads.getProjectId(chatId); }
  getChatRef(chatId: string) { return this.reads.getChatRef(chatId); }
  getIncarnationId(chatId: string) { return this.reads.getIncarnationId(chatId); }
  getHomeDir(chatId: string) { return this.reads.getHomeDir(chatId); }
  getImportOrigin(chatId: string) { return this.reads.getImportOrigin(chatId); }
  getExecutionDir(chatId: string) { return this.reads.getExecutionDir(chatId); }
  listAdoptionSnapshotIds() { return this.reads.listAdoptionSnapshotIds(); }
  adoptionReferenceProjection() { return this.reads.adoptionReferenceProjection(); }
  listChatSummaries() { return this.reads.listChatSummaries(); }
  memoryNativeSegment(chatId: string, afterSeq?: number, limit?: number) {
    return this.reads.memoryNativeSegment(chatId, afterSeq, limit);
  }
  listBaseIdentities() { return this.reads.listBaseIdentities(); }
  listBindings() { return this.reads.listBindings(); }
  listHistoryBindings() { return this.reads.listHistoryBindings(); }
  listByProject(projectId: string) { return this.reads.listByProject(projectId); }
  getAppRole(chatId: string) { return this.reads.getAppRole(chatId); }
  listProjectRefs() { return this.reads.listProjectRefs(); }
  getStoreRevision() { return this.reads.getStoreRevision(); }
  listReferencedAttachmentIds() { return this.reads.listReferencedAttachmentIds(); }
  hasAttachmentReference(chatId: string, attachmentId: string) {
    return this.reads.hasAttachmentReference(chatId, attachmentId);
  }
  getAttachmentReference(chatId: string, attachmentId: string) {
    return this.reads.getAttachmentReference(chatId, attachmentId);
  }
  searchTimelineDocuments(
    tokens: readonly string[],
    cursor: SearchDocumentCursor | null,
    limit: number
  ) { return this.reads.searchTimelineDocuments(tokens, cursor, limit); }

  /* ---------------------------------------------------------------- *
   *  外部历史与收养 saga：全部转交 ChatHistorySagaApi（同一条串行队列）。
   * ---------------------------------------------------------------- */
  markImportSourceStatus(chatId: string, sourceStatus: "match" | "missing") {
    return this.history.markImportSourceStatus(chatId, sourceStatus);
  }
  syncExternalHistory(
    ...input: Parameters<ChatHistorySagaApi["syncExternalHistory"]>
  ) { return this.history.syncExternalHistory(...input); }
  beginExternalContinuation(
    input: Parameters<ChatHistorySagaApi["beginExternalContinuation"]>[0]
  ) { return this.history.beginExternalContinuation(input); }
  markContinuationHomePreparing(
    ...input: Parameters<ChatHistorySagaApi["markContinuationHomePreparing"]>
  ) { return this.history.markContinuationHomePreparing(...input); }
  recordContinuationHomeCommitted(
    ...input: Parameters<ChatHistorySagaApi["recordContinuationHomeCommitted"]>
  ) { return this.history.recordContinuationHomeCommitted(...input); }
  finalizeExternalContinuation(
    input: Parameters<ChatHistorySagaApi["finalizeExternalContinuation"]>[0]
  ) { return this.history.finalizeExternalContinuation(input); }
  listReconcilableContinuations() { return this.history.listReconcilableContinuations(); }
  failContinuationPrecommit(
    ...input: Parameters<ChatHistorySagaApi["failContinuationPrecommit"]>
  ) { return this.history.failContinuationPrecommit(...input); }
  isolateContinuationOrphan(
    ...input: Parameters<ChatHistorySagaApi["isolateContinuationOrphan"]>
  ) { return this.history.isolateContinuationOrphan(...input); }

  private async requireRecord(chatId: string) {
    if (!this.state.metadata.has(chatId)) throw new ChatNotFoundError("聊天不存在");
    return this.loadRecord(chatId);
  }

  private async loadRecord(chatId: string) {
    if (this.state.activeRecord?.record.id === chatId) {
      return clone(this.state.activeRecord.record);
    }
    const record = await this.state.readRecord(chatId);
    this.state.remember(record, this.state.revisionOf(chatId));
    return clone(record);
  }

  /* 事实变更不再借道整聚合：手里的 metadata 就是 current，写入只碰事实行，
     缓存的整聚合随即作废——绝不留下一份 revision 已过期的 record。 */
  private updateFacts(
    chatId: string,
    update: (current: ChatFacts) => unknown
  ) {
    return this.state.queue.enqueue(async () => {
      assertChatId(chatId);
      const metadata = this.state.metadata.get(chatId);
      if (!metadata) throw new ChatNotFoundError("聊天不存在");
      const { preview, ...current } = metadata;
      const candidate = update(current);
      if (candidate === current) return clone(metadata);
      const facts = chatFactsSchema.parse(
        withFactRevision(current, candidate as ChatFacts)
      ) as ChatFacts;
      assertReadonlyPresentationMutation(current, facts);
      await persistFactsToStorage({
        facts,
        database: this.state.database,
        deviceId: this.state.deviceId,
        expectedAggregateRevision: current.chatRecordRevision,
        onCommit: () => this.state.touch(),
      });
      const next = { ...facts, preview };
      this.state.metadata.set(chatId, next);
      if (this.state.activeRecord?.record.id === chatId) {
        this.state.activeRecord = undefined;
      }
      return clone(next);
    });
  }

  private async persistRecord(record: ChatRecord) {
    return persistRecordToStorage({
      record,
      database: this.state.database,
      deviceId: this.state.deviceId,
      expectedAggregateRevision:
        this.state.metadata.get(record.id)?.chatRecordRevision ?? null,
      onCommit: () => this.state.touch(),
    });
  }

  private async persistAppendedMessage(
    current: ChatRecord,
    record: ChatRecord,
    message: ChatMessage
  ) {
    return persistAppendedMessageToStorage({
      current,
      record,
      message,
      database: this.state.database,
      deviceId: this.state.deviceId,
      onCommit: () => this.state.touch(),
    });
  }

  private async persistTurnCommit(
    current: ChatRecord,
    record: ChatRecord,
    message: ChatMessage | null
  ) {
    return persistTurnCommitToStorage({
      current,
      record,
      message,
      database: this.state.database,
      deviceId: this.state.deviceId,
      onCommit: () => this.state.touch(),
    });
  }

  getSqliteRuntimeFacts() {
    return this.sqliteRuntimeFacts ? clone(this.sqliteRuntimeFacts) : null;
  }

  private async openDatabase() {
    if (!this.state.deviceId) throw new Error("Chat device identity is unavailable");
    const database = this.dependencies.databaseClient?.() ?? new ChatDatabaseClient();
    const initialization = await database.initialize({
      kind: "initialize",
      databasePath: this.databasePath,
      deviceId: this.state.deviceId,
      mode: "canonical",
    });
    this.state.database = database;
    return initialization;
  }
}
