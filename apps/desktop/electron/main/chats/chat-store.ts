/**
 * [INPUT]: Depends on Node fs/path, chat schema/commit/summary, atomic persistence, and SerialQueue
 * [OUTPUT]: Provides canonical ChatStore v10 create/append/revise/adopt operations, metadata projections, and complete/incomplete adoption references including durable quarantine artifacts
 * [POS]: The canonical durable Chat ledger of the chats module
 */

import { randomUUID } from "node:crypto";
import {
  copyFile,
  mkdir,
  open,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import type { AgentBackendId, SessionRef } from "../../../shared/agent-ipc";
import {
  REVISION_STALE,
  SUPERSEDED_BRANCH_LIMIT,
  type AppChatRole,
  type ChatAttachmentMeta,
  type ChatMessage,
  type ChatImportOrigin,
  type ChatMessagesSnapshot,
  type ChatRecord,
  type ChatSummary,
  type SupersededChatBranch,
  type TurnCommitInput,
  type UnsequencedChatMessage,
  type UnsequencedUserMessage,
} from "../../../shared/chats-ipc";
import {
  isPositiveAppGrant,
  type AppCapabilityGrant,
  type AppGrantRecord,
} from "../../../shared/apps-ipc";
import { SerialQueue } from "../persistence/serial-queue";
import {
  metadataOf,
  summaryOfChat,
  type ChatMetadata,
} from "./chat-summary";
import {
  CHAT_BYTE_LIMIT,
  chatRecordSchema,
  messageBytes,
  utf8Length,
} from "./chat-schema";
import {
  ChatNotFoundError,
  applyTurnCommit,
  fallbackTitle,
  normalizeMessage,
} from "./chat-commit";
import {
  assertChatId,
  assertProjectRole,
  discoverChatFiles,
  isolateCorruptChatFile,
  isAppProjectMember,
  persistChatRecord,
  readChatRecord,
} from "./chat-store-support";
import type { ReferenceProjection } from "../history-import/memory-snapshot-store";

export type ChatMessageMutation = {
  record: ChatRecord;
  revision: number;
  appended: ChatMessage[];
  storedMessage?: ChatMessage;
  mode?: "replace";
};

export type ChatStoreDependencies = {
  atomicWrite?: (filePath: string, content: string) => Promise<void>;
  readText?: (filePath: string) => Promise<string>;
  now?: () => number;
  isAppProject?: (projectId: string) => boolean;
};

type PublishedRecord = Readonly<{
  record: ChatRecord;
  revision: number;
}>;

const clone = <T>(value: T): T => structuredClone(value);
const sessionKey = (session: SessionRef) =>
  `${session.backend}:${session.id}`;
const sameSession = (left: SessionRef | null, right: SessionRef | null) =>
  left?.backend === right?.backend && left?.id === right?.id;

function pruneSupersededBranches(
  messages: ChatMessage[],
  branches: SupersededChatBranch[],
  watermark = 0
) {
  const excess = Math.max(0, branches.length - SUPERSEDED_BRANCH_LIMIT);
  const retained = branches.slice(excess);
  const dropped = branches.slice(0, excess);
  let trimmedThroughSeq = dropped.reduce(
    (maximum, branch) => Math.max(maximum, branch.throughSeqEnd),
    watermark
  );
  const messageBudget = messages.reduce(
    (total, message) => total + messageBytes(message),
    0
  );
  while (
    retained.length > 0 &&
    messageBudget + utf8Length(JSON.stringify(retained)) > CHAT_BYTE_LIMIT
  ) {
    trimmedThroughSeq = Math.max(
      trimmedThroughSeq,
      retained.shift()!.throughSeqEnd
    );
  }
  return { retained, trimmedThroughSeq };
}

export class ChatStore {
  readonly chatsRoot: string;
  private readonly queue = new SerialQueue();
  private readonly metadata = new Map<string, ChatMetadata>();
  private readonly messageRevisions = new Map<string, number>();
  private storeRevision = 0;
  /* 最后 durable generation 的原子发布单元。record 只在队列内部构造且从不
     原地改写；所有外部返回值先 clone，因此快速读可一次取得同代 record+revision。 */
  private activeRecord: PublishedRecord | undefined;
  private readonly warnings: string[] = [];
  private readonly now: () => number;
  private readonly readText: (filePath: string) => Promise<string>;

  constructor(
    userData: string,
    private readonly dependencies: ChatStoreDependencies = {}
  ) {
    this.chatsRoot = join(userData, "chats");
    this.now = dependencies.now ?? Date.now;
    this.readText = dependencies.readText ?? ((path) => readFile(path, "utf8"));
  }

  async initialize() {
    await this.queue.enqueue(async () => {
      await mkdir(this.chatsRoot, { recursive: true });
      this.metadata.clear();
      this.messageRevisions.clear();
      this.activeRecord = undefined;
      this.warnings.length = 0;

      const discovered = await discoverChatFiles(this.chatsRoot, this.readText);
      for (const item of discovered.corrupt) {
        await this.isolateCorrupt(item.path, item.cause);
      }

      const boundSessions = new Map<string, string>();
      discovered.records.sort(
        (left, right) =>
          left.record.createdAt - right.record.createdAt ||
          left.record.id.localeCompare(right.record.id)
      );
      for (const candidate of discovered.records) {
        let record = clone(candidate.record);
        if (record.session) {
          const key = sessionKey(record.session);
          const owner = boundSessions.get(key);
          if (owner) {
            const backup = `${candidate.path}.conflict-${this.now()}`;
            await copyFile(candidate.path, backup);
            record = { ...record, session: null };
            await this.persistRecord(record);
            this.warnings.push(
              `聊天 ${record.id} 与 ${owner} 重复绑定同一 ${record.agent} session，原文件已备份到 ${backup}，当前聊天已解除绑定。`
            );
          } else {
            boundSessions.set(key, record.id);
          }
        }

        if (record.title === null) {
          const firstUser = record.messages.find(
            (message) => message.role === "user"
          );
          record = {
            ...record,
            title: fallbackTitle(firstUser?.content ?? "新聊天"),
          };
          await this.persistRecord(record);
        }
        this.metadata.set(record.id, metadataOf(record));
      }
    });
  }

  list(): ChatSummary[] {
    return [...this.metadata.values()]
      .sort(
        (left, right) =>
          right.updatedAt - left.updatedAt ||
          right.createdAt - left.createdAt ||
          left.id.localeCompare(right.id)
      )
      .map(summaryOfChat);
  }

  async get(chatId: string): Promise<ChatRecord | null> {
    assertChatId(chatId);
    if (!this.metadata.has(chatId)) return null;
    if (this.activeRecord?.record.id === chatId) {
      return clone(this.activeRecord.record);
    }
    return clone(await this.readRecord(chatId));
  }

  messagesSnapshot(chatId: string): Promise<ChatMessagesSnapshot | null> {
    assertChatId(chatId);
    if (!this.metadata.has(chatId)) return Promise.resolve(null);
    const published = this.activeRecord;
    if (published?.record.id === chatId) {
      return Promise.resolve(this.projectMessagesSnapshot(published));
    }
    return this.queue.enqueue(async () => {
      if (!this.metadata.has(chatId)) return null;
      const record = await this.requireRecord(chatId);
      const active = this.activeRecord;
      return active?.record.id === chatId
        ? this.projectMessagesSnapshot(active)
        : {
            chatId,
            incarnationId: record.incarnationId,
            revision: this.revisionOf(chatId),
            messages: clone(record.messages),
          };
    });
  }

  getWarning() { return this.warnings.join("\n") || undefined; }

  pushWarning(message: string) { this.warnings.push(message); }

  getProjectId(chatId: string) {
    assertChatId(chatId);
    return this.metadata.get(chatId)?.projectId;
  }

  /** O(1) 内存元数据引用；身份/归属消费方（如 Base owner 解析）不读全量账本。 */
  getChatRef(chatId: string) {
    assertChatId(chatId);
    const meta = this.metadata.get(chatId);
    if (!meta) return null;
    return {
      id: meta.id,
      incarnationId: meta.incarnationId,
      title: meta.title,
      archivedAt: meta.archivedAt,
      projectId: meta.projectId,
      appRole: meta.appRole,
    };
  }

  getIncarnationId(chatId: string) {
    assertChatId(chatId);
    return this.metadata.get(chatId)?.incarnationId;
  }

  getHomeDir(chatId: string) {
    assertChatId(chatId);
    return this.metadata.get(chatId)?.homeDir ?? undefined;
  }

  getImportOrigin(chatId: string) {
    assertChatId(chatId);
    return clone(this.metadata.get(chatId)?.importOrigin ?? null);
  }

  getExecutionDir(chatId: string) {
    assertChatId(chatId);
    return this.metadata.get(chatId)?.importOrigin?.originalCwd;
  }

  getAdoptionBinding(chatId: string) {
    assertChatId(chatId);
    const record = this.metadata.get(chatId);
    return record?.importOrigin && record.snapshotDigest
      ? { snapshotId: record.importOrigin.adoptionSnapshotId, digest: record.snapshotDigest }
      : null;
  }

  listAdoptionSnapshotIds() {
    return new Set([...this.metadata.values()].flatMap((record) => record.importOrigin ? [record.importOrigin.adoptionSnapshotId] : []));
  }

  async adoptionReferenceProjection(): Promise<ReferenceProjection> {
    const refs = this.listAdoptionSnapshotIds();
    try {
      const entries = await readdir(this.chatsRoot, { withFileTypes: true });
      return {
        complete: !entries.some(
          (entry) => entry.isFile() && entry.name.includes(".corrupt-")
        ),
        refs,
      };
    } catch {
      return { complete: false, refs };
    }
  }

  /* ============================================================
   * 记忆回灌的目标清单：只读元数据 + 一次全量记录读取。
   * lastSeq 与 trimmedThroughSeq 必须来自落盘记录本身——用 metadata
   * 的 updatedAt 近似「聊到哪了」，回灌就会漏掉最后一整轮。
   * ============================================================ */
  async listChatSummaries() {
    const summaries: Array<{
      id: string;
      incarnationId: string;
      homeDir: string | null;
      lastSeq: number;
      trimmedThroughSeq: number;
    }> = [];
    for (const meta of this.metadata.values()) {
      const record = await this.get(meta.id);
      if (!record) continue;
      summaries.push({
        id: record.id,
        incarnationId: record.incarnationId,
        homeDir: record.homeDir ?? null,
        lastSeq: record.messages.at(-1)?.seq ?? 0,
        trimmedThroughSeq: record.trimmedThroughSeq ?? 0,
      });
    }
    return summaries;
  }

  listBaseIdentities() {
    return [...this.metadata.values()].map((record) => ({
      chatId: record.id,
      incarnationId: record.incarnationId,
      title: record.title,
    }));
  }

  listBindings() {
    return [...this.metadata.values()]
      .filter(
        (record): record is ChatMetadata & { session: SessionRef } =>
          record.session !== null
      )
      .map((record) => ({
        chatId: record.id,
        session: record.session,
        projectId: record.projectId,
        importOrigin: record.importOrigin ?? null,
        snapshotDigest: record.snapshotDigest ?? null,
      }));
  }

  listByProject(projectId: string) {
    return [...this.metadata.values()]
      .filter((record) => record.projectId === projectId)
      .map((record) => record.id);
  }

  getAppRole(chatId: string) {
    assertChatId(chatId);
    return this.metadata.get(chatId)?.appRole;
  }

  listProjectRefs() {
    const references = new Map<string, { latestUpdatedAt: number }>();
    for (const record of this.metadata.values()) {
      if (!record.projectId) continue;
      const current = references.get(record.projectId)?.latestUpdatedAt ?? 0;
      references.set(record.projectId, {
        latestUpdatedAt: Math.max(current, record.updatedAt),
      });
    }
    return references;
  }

  getStoreRevision() {
    return this.storeRevision;
  }

  async listReferencedAttachmentIds() {
    const referenced = new Set<string>();
    for (const chatId of this.metadata.keys()) {
      const record = await this.get(chatId);
      for (const message of record?.messages ?? []) {
        if (message.role !== "user") continue;
        for (const attachment of message.attachments ?? []) {
          referenced.add(attachment.id);
        }
      }
    }
    return referenced;
  }

  create(
    chatId: string,
    firstMessage: UnsequencedUserMessage | ChatMessage,
    projectId: string | null = null,
    agent: AgentBackendId = "codex",
    identity?: {
      incarnationId?: string;
      title?: string | null;
      minimumNextSeq?: number;
      homeDir?: string;
      appRole?: AppChatRole | null;
      /**
       * main-only：以 dormant 状态建会话，首条只写一条产品生成的 notice。
       * 这个开关存在的唯一理由是「不得把管理提示伪装成 user message」——
       * 没有它，受管会话就只能靠伪造一条用户发言才建得出来。
       */
      dormantNotice?: boolean;
      session?: SessionRef;
      importOrigin?: ChatImportOrigin;
      snapshotDigest?: string;
    }
  ) {
    return this.queue.enqueue(async () => {
      assertChatId(chatId);
      if (this.metadata.has(chatId)) throw new Error("聊天 id 已存在");
      if (!identity?.homeDir) {
        throw new Error("canonical create 缺少 Chat Home ownership（homeDir）");
      }
      const seq = "seq" in firstMessage ? firstMessage.seq : 1;
      const message = normalizeMessage({ ...firstMessage, seq } as ChatMessage);
      const expectedRole = identity?.dormantNotice ? "notice" : "user";
      if (message.role !== expectedRole) {
        throw new Error(
          identity?.dormantNotice
            ? "dormant 会话的首条只能是产品生成的 notice"
            : "首条消息必须来自用户"
        );
      }
      assertProjectRole(this.dependencies.isAppProject, projectId, identity?.appRole ?? null);
      if (identity?.session) {
        const owner = [...this.metadata.values()].find((record) => record.session && sessionKey(record.session) === sessionKey(identity.session!));
        if (owner) throw new Error(`SessionRef 已由聊天 ${owner.id} 持有`);
      }
      const record = chatRecordSchema.parse({
        id: chatId,
        incarnationId:
          identity?.incarnationId ?? randomUUID().replaceAll("-", ""),
        title: identity?.title ?? null,
        agent,
        session: identity?.session ?? null,
        importOrigin: identity?.importOrigin ?? null,
        snapshotDigest: identity?.snapshotDigest ?? null,
        projectId,
        appRole: identity?.appRole ?? null,
        grants: [],
        grantRevision: 0,
        homeDir: identity.homeDir,
        createdAt: message.createdAt,
        updatedAt: message.createdAt,
        nextSeq: Math.max(seq + 1, identity?.minimumNextSeq ?? 1),
        messages: [message],
      });
      await this.persistRecord(record);
      this.metadata.set(chatId, metadataOf(record));
      this.touch();
      const revision = this.bumpRevision(chatId);
      this.remember(record, revision);
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
    return this.queue.enqueue(async () => {
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
      if (result.appended) {
        await this.persistRecord(result.record);
        this.metadata.set(chatId, metadataOf(result.record));
      }
      const appended =
        result.appended && result.storedMessage
          ? [result.storedMessage]
          : [];
      const revision = appended.length
        ? this.bumpRevision(chatId)
        : this.revisionOf(chatId);
      if (result.appended) this.remember(result.record, revision);
      return {
        record: clone(result.record),
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
    return this.queue.enqueue(async () => {
      assertChatId(input.chatId);
      const current = await this.requireRecord(input.chatId);
      if (current.importOrigin) throw new Error("收养的外源会话不能修订");

      const replay = current.messages.find(
        (message) => message.id === input.message.id
      );
      if (replay) {
        if (
          replay.role !== "user" ||
          replay.content !== input.message.content ||
          replay.createdAt !== input.message.createdAt
        ) {
          throw new Error("修订消息 identity 已存在但内容不一致");
        }
        return {
          record: clone(current),
          revision: this.revisionOf(input.chatId),
          appended: [],
          storedMessage: clone(replay),
        } satisfies ChatMessageMutation;
      }

      const index = current.messages.findIndex(
        (message) => message.id === input.supersedes.supersedesUserMessageId
      );
      const superseded = index < 0 ? undefined : current.messages[index];
      const last = current.messages.at(-1);
      const lastUser = current.messages
        .filter((message) => message.role === "user")
        .at(-1);
      if (
        superseded?.role !== "user" ||
        lastUser?.id !== superseded.id ||
        last?.seq !== input.supersedes.throughSeqEnd
      ) {
        throw new Error(REVISION_STALE);
      }

      const seq = input.reservedSeq ?? current.nextSeq;
      const message = normalizeMessage({
        ...input.message,
        ...(superseded.attachments?.length
          ? { attachments: clone(superseded.attachments) }
          : {}),
        seq,
      } as ChatMessage);
      const branch: SupersededChatBranch = {
        intentId: input.intentId ?? input.message.id,
        supersededAt: this.now(),
        supersedesUserMessageId: superseded.id,
        throughSeqEnd: last.seq,
        messages: clone(current.messages.slice(index)),
      };
      const prefix = current.messages.slice(0, index);
      const archive = pruneSupersededBranches(
        [...prefix, message],
        [...(current.supersededBranches ?? []), branch],
        current.supersededBranchesTrimmedThroughSeq
      );
      const result = applyTurnCommit(
        {
          ...current,
          session: null,
          messages: prefix,
          supersededBranches: archive.retained,
          ...(archive.trimmedThroughSeq > 0
            ? {
                supersededBranchesTrimmedThroughSeq:
                  archive.trimmedThroughSeq,
              }
            : {}),
        },
        { message }
      );
      await this.persistRecord(result.record);
      this.metadata.set(input.chatId, metadataOf(result.record));
      const revision = this.bumpRevision(input.chatId);
      this.remember(result.record, revision);
      return {
        record: clone(result.record),
        revision,
        appended: [clone(message)],
        storedMessage: clone(message),
        mode: "replace",
      } satisfies ChatMessageMutation;
    });
  }

  reserveSequences(chatId: string, count: number) {
    return this.queue.enqueue(async () => {
      assertChatId(chatId);
      if (!Number.isInteger(count) || count < 1) {
        throw new Error("消息序号预留数量无效");
      }
      const current = await this.requireRecord(chatId);
      const first = current.nextSeq;
      const record = chatRecordSchema.parse({
        ...current,
        nextSeq: first + count,
      });
      await this.persistRecord(record);
      this.metadata.set(chatId, metadataOf(record));
      this.remember(record, this.revisionOf(chatId));
      return Array.from({ length: count }, (_, index) => first + index);
    });
  }

  ensureNextSequence(chatId: string, minimum: number) {
    return this.queue.enqueue(async () => {
      assertChatId(chatId);
      const current = await this.requireRecord(chatId);
      if (current.nextSeq >= minimum) return current.nextSeq;
      const record = chatRecordSchema.parse({ ...current, nextSeq: minimum });
      await this.persistRecord(record);
      this.metadata.set(chatId, metadataOf(record));
      this.remember(record, this.revisionOf(chatId));
      return minimum;
    });
  }

  appendTurnResult(chatId: string, input: TurnCommitInput) {
    return this.queue.enqueue(async () => {
      assertChatId(chatId);
      const current = await this.requireRecord(chatId);
      const result = applyTurnCommit(current, input);
      if (result.appended || result.subagentsChanged) {
        await this.persistRecord(result.record);
        this.metadata.set(chatId, metadataOf(result.record));
      }
      const appended =
        result.appended && result.storedMessage
          ? [result.storedMessage]
          : [];
      const revision = appended.length
        ? this.bumpRevision(chatId)
        : this.revisionOf(chatId);
      if (result.appended || result.subagentsChanged) {
        this.remember(result.record, revision);
      }
      return {
        record: clone(result.record),
        revision,
        appended: clone(appended),
        ...(result.storedMessage
          ? { storedMessage: clone(result.storedMessage) }
          : {}),
      } satisfies ChatMessageMutation;
    });
  }

  bindSession(chatId: string, session: SessionRef) {
    return this.updateRecord(chatId, (current) => {
      if (session.backend !== current.agent) {
        throw new Error("session backend 与聊天 agent 不一致");
      }
      const key = sessionKey(session);
      const existingOwner = [...this.metadata.values()].find(
        (record) =>
          record.session &&
          sessionKey(record.session) === key &&
          record.id !== chatId
      );
      if (existingOwner) throw new Error("Agent session 已绑定到其他聊天");
      if (sameSession(current.session, session)) return current;
      if (current.session) throw new Error("聊天已绑定到另一个 Agent session");
      return { ...current, session };
    });
  }

  replaceSession(
    chatId: string,
    expected: SessionRef,
    next: SessionRef | null
  ) {
    return this.updateRecord(chatId, (current) => {
      if (!sameSession(current.session, expected)) {
        throw new Error("session 已被其他操作更新");
      }
      if (next && next.backend !== current.agent) {
        throw new Error("session backend 与聊天 agent 不一致");
      }
      if (next) {
        const key = sessionKey(next);
        const owner = [...this.metadata.values()].find(
          (record) =>
            record.id !== chatId &&
            record.session &&
            sessionKey(record.session) === key
        );
        if (owner) throw new Error("Agent session 已绑定到其他聊天");
      }
      return { ...current, session: next };
    });
  }

  async assertBackend(chatId: string, backend: AgentBackendId) {
    const record = await this.get(chatId);
    if (!record) throw new Error("聊天不存在");
    if (record.agent !== backend) throw new Error("Agent backend 与聊天绑定不一致");
  }

  setTitle(chatId: string, title: string) {
    return this.updateRecord(chatId, (current) => ({
      ...current,
      title: title.trim(),
    }));
  }

  setAppGrant(chatId: string, grant: AppCapabilityGrant) {
    return this.setAppGrantRecord(chatId, grant);
  }

  setAppGrantRecord(chatId: string, grant: AppGrantRecord) {
    return this.updateRecord(chatId, (current) => {
      /* D17 的写侧最后一道：与 moveChatProject 在同一条队列里，于是「先 grant
         再转换」和「先转换再 grant」这两半都不可能各写一份。 */
      if (current.appRole !== null) {
        throw Object.assign(new Error("App chat 不能再附加 App"), { status: 403 });
      }
      if (isAppProjectMember(this.dependencies.isAppProject, current.projectId)) {
        throw Object.assign(new Error("App Project 的聊天不能再附加 App"), {
          status: 403,
        });
      }
      return {
        ...current,
        grants: [
          ...current.grants.filter((item) => item.appId !== grant.appId),
          clone(grant),
        ],
        grantRevision: current.grantRevision + 1,
      };
    });
  }

  revokeAppGrant(chatId: string, appId: string) {
    return this.updateRecord(chatId, (current) => {
      const grants = current.grants.filter((item) => item.appId !== appId);
      return grants.length === current.grants.length
        ? current
        : {
            ...current,
            grants,
            grantRevision: current.grantRevision + 1,
          };
    });
  }

  /** 只允许根级 chat 单向升级为一个 Project；不改变消息 revision。 */
  setProjectId(chatId: string, projectId: string) {
    return this.updateRecord(chatId, (current) => {
      assertProjectRole(this.dependencies.isAppProject, projectId, null);
      if (current.projectId !== null) {
        throw new Error("聊天已属于某个 Project");
      }
      return { ...current, projectId };
    });
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
    return this.updateRecord(chatId, (current) => {
      if (current.projectId !== input.expectedSource) {
        throw Object.assign(new Error("聊天 Project 归属已变化"), {
          status: 409,
        });
      }
      const appRole =
        input.appRole === undefined ? current.appRole : input.appRole;
      assertProjectRole(this.dependencies.isAppProject, input.target, appRole);
      /* 迁入 App Project 前必须已经没有 grant：静默带着走等于用户在毫不知情的
         情况下留下一条 durable 但当下无效的授权，Project 日后解绑 App 时复活。 */
      const positiveGrants = current.grants.filter(isPositiveAppGrant);
      if (
        isAppProjectMember(this.dependencies.isAppProject, input.target) &&
        positiveGrants.length
      ) {
        throw Object.assign(
          new Error(
            `聊天仍持有 App 授权，请先撤销：${positiveGrants
              .map((grant) => grant.appId)
              .join("、")}`
          ),
          { status: 409 }
        );
      }
      return current.projectId === input.target && current.appRole === appRole
        ? current
        : { ...current, projectId: input.target, appRole };
    });
  }

  /** 只供记录丢失的 Project 抢救；null 输入态幂等，不改变消息 revision。 */
  clearProjectId(chatId: string) {
    return this.updateRecord(chatId, (current) =>
      current.projectId === null && current.appRole === null
        ? current
        : { ...current, projectId: null, appRole: null }
    );
  }

  /** 仅在标题仍为 null 时写入生成标题：用户改名永远不会被后到的生成结果覆盖 */
  setGeneratedTitle(chatId: string, title: string) {
    return this.updateRecord(chatId, (current) =>
      current.title === null
        ? { ...current, title: title.trim() }
        : current
    );
  }

  has(chatId: string) {
    return this.metadata.has(chatId);
  }

  async setArchivedAt(chatId: string, archivedAt: number | undefined) {
    const record = await this.updateRecord(chatId, (current) => ({
      ...current,
      archivedAt,
    }));
    this.touch();
    return record;
  }

  /** 删除聊天并返回其附件元数据；附件文件清理由持有 AttachmentStore 的调用方负责 */
  remove(
    chatId: string,
    expectedIncarnationId?: string
  ): Promise<ChatAttachmentMeta[]> {
    return this.queue.enqueue(async () => {
      assertChatId(chatId);
      if (!this.metadata.has(chatId)) throw new Error("聊天不存在");
      const actualIncarnationId = this.metadata.get(chatId)?.incarnationId;
      if (
        expectedIncarnationId &&
        actualIncarnationId !== expectedIncarnationId
      ) {
        throw new Error("INCARNATION_MISMATCH");
      }
      // 文件损坏也允许删除：读不出附件就返回空列表
      const attachments = await this.readRecord(chatId)
        .then((record) =>
          record.messages.flatMap((message) =>
            message.role === "user" ? message.attachments ?? [] : []
          )
        )
        .catch(() => [] as ChatAttachmentMeta[]);
      await rm(this.recordPath(chatId), { force: true });
      const directory = await open(this.chatsRoot, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
      this.metadata.delete(chatId);
      this.touch();
      this.messageRevisions.delete(chatId);
      if (this.activeRecord?.record.id === chatId) this.activeRecord = undefined;
      return attachments;
    });
  }

  async closeAndFlush() {
    this.queue.close();
    await this.queue.flush();
  }

  reopen() {
    this.queue.reopen();
  }

  private async requireRecord(chatId: string) {
    if (!this.metadata.has(chatId)) throw new ChatNotFoundError("聊天不存在");
    return this.loadRecord(chatId);
  }

  private async loadRecord(chatId: string) {
    if (this.activeRecord?.record.id === chatId) {
      return clone(this.activeRecord.record);
    }
    const record = await this.readRecord(chatId);
    this.remember(record, this.revisionOf(chatId));
    return clone(record);
  }

  private async readRecord(chatId: string) {
    return readChatRecord(this.recordPath(chatId), chatId, this.readText);
  }

  private remember(record: ChatRecord, revision: number) {
    // record 是 parse/schema 的新所有权值；队列内部不得原地改写它。
    this.activeRecord = Object.freeze({ record, revision });
  }

  private projectMessagesSnapshot(published: PublishedRecord) {
    return {
      chatId: published.record.id,
      incarnationId: published.record.incarnationId,
      revision: published.revision,
      messages: clone(published.record.messages),
    } satisfies ChatMessagesSnapshot;
  }

  private updateRecord(
    chatId: string,
    update: (current: ChatRecord) => unknown
  ) {
    return this.queue.enqueue(async () => {
      assertChatId(chatId);
      const current = await this.requireRecord(chatId);
      const candidate = update(current);
      if (candidate === current) return clone(current);
      const record = chatRecordSchema.parse(candidate);
      await this.persistRecord(record);
      this.metadata.set(chatId, metadataOf(record));
      this.remember(record, this.revisionOf(chatId));
      return clone(record);
    });
  }

  private revisionOf(chatId: string) { return this.messageRevisions.get(chatId) ?? 0; }

  private bumpRevision(chatId: string) {
    const revision = this.revisionOf(chatId) + 1;
    this.messageRevisions.set(chatId, revision);
    return revision;
  }

  private recordPath(chatId: string) {
    return join(this.chatsRoot, `${chatId}.json`);
  }

  private async persistRecord(record: ChatRecord) {
    const path = this.recordPath(record.id);
    await persistChatRecord(path, record, this.dependencies.atomicWrite);
    this.touch();
  }

  private touch() { this.storeRevision += 1; }

  private async isolateCorrupt(path: string, cause: unknown) {
    this.warnings.push(await isolateCorruptChatFile(path, cause, this.now()));
  }
}
