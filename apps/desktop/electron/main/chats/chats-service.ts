/**
 * [INPUT]: Depends on Electron, shared chat contracts, ChatHomeService, outcome-aware ChatStore/AttachmentStore, ChatTitleJobs, renderer IPC/event adapters, pure guards, and deletion/removal controllers
 * [OUTPUT]: Provides the renderer/coordinator Chat facade, the startup attachment sweep, unknown-commit attachment compensation, adopted continuation, scoped reads/events, and convergent removal
 * [POS]: Main-process Chat service boundary; every new or adopted executable Chat is owned by a Chat Home creation saga
 */

import { dirname, join } from "node:path";
import { type BrowserWindow } from "electron";
import type { AgentBackendId, AgentScope, SessionRef } from "../../../shared/agent-ipc";
import { dataUrlByteSize } from "../../../shared/agent-ipc";
import type { AppChatRole } from "../../../shared/chats-ipc";
import {
  type ChatAttachmentMeta,
  type ChatMessage,
  type ChatRecord,
  type ChatsEvent,
  type AppendChatMessageInput,
  type CreateAppChatInput,
  type CreateChatInput,
  type AdoptChatInput,
  type PersistedSubagent,
  type TurnCommitInput,
  type UnsequencedChatMessage,
  type UnsequencedUserMessage,
} from "../../../shared/chats-ipc";
import type { TrustedManualTurnSubmission as ManualTurnSubmission } from "../../../shared/sections-ipc";
import { PROJECT_UNAVAILABLE } from "../../../shared/projects-ipc";
import { AttachmentStore } from "./attachment-store";
import { exportAttachmentFile, type AttachmentExportDependencies } from "./attachment-export";
import {
  ChatLedgerCorruptError,
  ChatMessageInvariantError,
  ChatNotFoundError,
} from "./chat-commit";
import {
  isPersistenceIoError,
  sameCanonicalFirstMessage,
  statusError,
} from "./chats-service-guards";
import {
  ChatStore,
  isChatMutationOutcomeUnknown,
  type ChatMessageMutation,
} from "./chat-store";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import type { ConversationDeletionMode } from "../deletion/conversation-deletion-coordinator";
import {
  ChatDeletionDriver,
  type ChatDeletionOptions,
} from "./chat-deletion";
import { ChatRemovalController } from "./chat-removal";
import { publishChatEvent, publishChatMutation } from "./chat-event-publisher";
import { registerChatRendererIpc } from "./chat-renderer-ipc";
import { summaryOfChatLike, type ChatMetadata } from "./chat-summary";
import { ChatTitleJobs } from "./chat-title-jobs";
import {
  appendInputSchema,
  createAppInputSchema,
  createInputSchema,
  renameInputSchema,
  type ParsedAttachmentPayload,
} from "./chat-input";
import { createDormantAppChat, type DormantAppChatInput } from "./lifecycle/dormant-app-chat";
import {
  beginAdoptedContinuation,
  createAdoptedChat,
} from "./lifecycle/adopted-chat";
export { rejectLegacyRendererWrite } from "./chats-service-guards";

const summaryOf = summaryOfChatLike;

type ChatHomeCreationPort = Pick<ChatHomeService,
  "identityForCreation" | "assertCanCreateChat" | "beginCreation" |
  "markPrepared" | "commitCreation" | "rollbackCreation" |
  "committedCreationEvidence" | "isolateCommittedCreation">;

export type ChatsServiceOptions = ChatDeletionOptions & {
  recoverTitleJobs?: boolean;
  generateTitle: (firstMessage: string) => Promise<string>;
  /** 附件文件仓根目录（决策 5：userData/chat-attachments） */
  attachmentsRoot: string;
  /** Agent 人工导出的独立私有根；运行时固定为 userData/exports。 */
  exportsRoot?: string;
  attachmentExportFs?: AttachmentExportDependencies;
  withProject?: <T>(
    projectId: string,
    task: () => Promise<T>
  ) => Promise<T>;
  withConversationLifecycle: <T>(task: () => Promise<T>) => Promise<T>;
  /** S2 fence 的删除面：Save 过渡中的 chat 是 saga 物证，拒删与 manual/archive 同源。 */
  isConversationTransitioning?: (chatId: string) => Promise<boolean>;
  cancelConversations: (conversationIds: Iterable<string>) => Promise<void>;
  releaseConversations?: (conversationIds: Iterable<string>) => void;
  /** 标题落盘后的 best-effort 同步（如 Base 名跟随）；失败只记日志，不阻塞改名。 */
  onTitleChanged?: (record: Pick<ChatRecord, "id" | "incarnationId" | "title">) => Promise<void>;
  resolveAppAgent?: (
    appId: string,
    projectId: string
  ) => AgentBackendId | undefined;
  assertAgentReady?: (agent: AgentBackendId) => Promise<void>;
  chatHomes?: ChatHomeCreationPort;
  isProjectArchived?: (projectId: string) => boolean;
  isAppProject?: (projectId: string) => boolean;
  onAppChatCreated?: (input: {
    appId: string;
    chatId: string;
    appRole: AppChatRole;
  }) => Promise<void>;
  onAdoptedSessionBound?: (session: SessionRef, chatId: string) => void;
};

export class ChatsService {
  private readonly titleRecovery: Promise<void>;
  private readonly attachments: AttachmentStore;
  private readonly deletion: ChatDeletionDriver;
  private readonly removal: ChatRemovalController;
  private readonly exportsRoot: string;
  private readonly titles: ChatTitleJobs;
  private window: BrowserWindow | null = null;
  private admission: "accepting" | "draining" | "closed" = "accepting";

  constructor(
    readonly store: ChatStore,
    private readonly options: ChatsServiceOptions
  ) {
    this.attachments = new AttachmentStore(options.attachmentsRoot);
    this.deletion = new ChatDeletionDriver(
      store,
      this.attachments,
      options,
      (event) => this.emit(event)
    );
    this.removal = new ChatRemovalController({
      store,
      deletion: this.deletion,
      withConversationLifecycle: (task) =>
        options.withConversationLifecycle(task),
      isConversationTransitioning: options.isConversationTransitioning,
      cancelConversations: options.cancelConversations,
      releaseConversations: options.releaseConversations,
    });
    this.exportsRoot =
      options.exportsRoot ?? join(dirname(options.attachmentsRoot), "exports");
    this.titles = new ChatTitleJobs(store, options, (event) => this.emit(event));
    this.titleRecovery = options.recoverTitleJobs
      ? this.titles.recover().catch((cause) => {
          console.error("[chats] durable title outbox recovery failed", cause);
        })
      : Promise.resolve();
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    registerChatRendererIpc(window, rendererUrl, {
      store: this.store,
      isProjectArchived: this.options.isProjectArchived,
      assertAdmission: () => this.assertAdmission(),
      rename: async (input) => {
        const { chatId, title } = renameInputSchema.parse(input);
        const record = await this.store.setTitle(chatId, title);
        this.emit({ type: "upserted", summary: summaryOf(record) });
        this.titles.sync(record);
        return summaryOf(record);
      },
      remove: (chatId) => this.remove(chatId),
      readAttachment: (attachmentId) => this.attachments.read(attachmentId),
    });

    window.once("closed", () => {
      if (this.window === window) this.window = null;
    });
  }

  async createUserChat(
    input: CreateChatInput,
    sequence?: { userSeq: number; assistantSeq: number },
    projectLifecycle?: "held"
  ) {
    this.assertAdmission();
    this.options.chatHomes?.assertCanCreateChat();
    const value = createInputSchema.parse(input);
    const home = this.requireCreationHome(value.id, value.incarnationId);
    const projectId = value.projectId ?? null;
    if (projectId && this.options.isAppProject?.(projectId)) {
      throw statusError(
        403,
        "App Project 只能从 App 的使用或编辑入口创建聊天"
      );
    }
    const create = () =>
      this.commitWithAttachments(value.attachmentPayloads, (metas) =>
        this.store.create(
          value.id,
          this.attachMetas(value.firstMessage, metas),
          projectId,
          value.agent,
          sequence
            ? {
                minimumNextSeq: sequence.assistantSeq + 1,
                incarnationId: home.incarnationId,
                homeDir: home.homeDir,
              }
            : {
                incarnationId: home.incarnationId,
                homeDir: home.homeDir,
              }
        )
      );
    const mutation = projectId && projectLifecycle !== "held"
      ? await this.withProject(projectId, create)
      : await create();
    const { record } = mutation;
    this.emitMutation(mutation);
    this.scheduleTitle(record, value.firstMessage.content);
    return record;
  }

  async createAppChat(
    input: CreateAppChatInput,
    sequence?: { userSeq: number; assistantSeq: number },
    projectLifecycle?: "held"
  ) {
    this.assertAdmission();
    this.options.chatHomes?.assertCanCreateChat();
    const value = createAppInputSchema.parse(input);
    const home = this.requireCreationHome(value.id, value.incarnationId);
    const defaultAgent = this.options.resolveAppAgent?.(
      value.appId,
      value.projectId
    );
    if (!defaultAgent) throw new Error("App 与 Project 绑定无效或 App 不可用");
    const agent = value.agent ?? defaultAgent;
    if (!this.options.assertAgentReady) {
      throw new Error("App 聊天缺少 Agent 就绪校验");
    }
    await this.options.assertAgentReady(agent);
    const create = () =>
      this.commitWithAttachments(value.attachmentPayloads, (metas) =>
        this.store.create(
          value.id,
          this.attachMetas(value.firstMessage, metas),
          value.projectId,
          agent,
          sequence
            ? {
                minimumNextSeq: sequence.assistantSeq + 1,
                incarnationId: home.incarnationId,
                homeDir: home.homeDir,
                appRole: value.appRole,
                appId: value.appId,
              }
            : {
                incarnationId: home.incarnationId,
                homeDir: home.homeDir,
                appRole: value.appRole,
                appId: value.appId,
              }
        )
      );
    const mutation = projectLifecycle === "held"
      ? await create()
      : await this.withProject(value.projectId, create);
    const { record } = mutation;
    await this.options.onAppChatCreated?.({
      appId: value.appId,
      chatId: record.id,
      appRole: value.appRole,
    });
    this.emitMutation(mutation);
    this.scheduleTitle(record, value.firstMessage.content);
    return record;
  }

  /**
   * App Studio 不能把一个尚不存在的 draft id 当成 conversation identity。
   * use slot 在返回 renderer 前，经同一 Chat Home CreationIntent 建成 dormant
   * canonical chat；首条真人输入随后只是 append，不会再次铸造 incarnation。
   */
  createDormantAppChat(input: DormantAppChatInput) {
    this.assertAdmission();
    return createDormantAppChat({
      store: this.store,
      chatHomes: this.options.chatHomes,
      resolveAgent: (appId, projectId) =>
        this.options.resolveAppAgent?.(appId, projectId),
      withProject: (projectId, task) => this.withProject(projectId, task),
      publish: (mutation) => this.emitMutation(mutation),
    }, input);
  }

  async createAdoptedChat(
    input: AdoptChatInput,
    sequence?: { userSeq: number; assistantSeq: number },
    projectLifecycle?: "held"
  ) {
    this.assertAdmission();
    return createAdoptedChat({
      store: this.store,
      homes: this.options.chatHomes,
      isAppProject: this.options.isAppProject,
      assertAgentReady: this.options.assertAgentReady,
      withProject: (projectId, task) => this.withProject(projectId, task),
      commitWithAttachments: (payloads, commit) =>
        this.commitWithAttachments(payloads, commit),
      publish: (mutation) => this.emitMutation(mutation),
      onSessionBound: this.options.onAdoptedSessionBound,
    }, input, sequence, projectLifecycle);
  }

  async appendUserMessage(input: AppendChatMessageInput, reservedSeq?: number) {
    this.assertAdmission();
    const value = appendInputSchema.parse(input);
    if (value.precondition) {
      const current = this.store.getMetadata(value.chatId);
      if (
        value.precondition.kind !== "existing" ||
        !current ||
        current.incarnationId !== value.precondition.incarnationId
      ) {
        throw new Error("INCARNATION_MISMATCH");
      }
    }
    const mutation = value.revise
      ? await this.store.reviseTail({
          chatId: value.chatId,
          supersedes: value.revise,
          message: value.message,
          reservedSeq,
        })
      : await this.commitWithAttachments(
          value.attachmentPayloads,
          (metas) =>
            this.store.appendMessage(
              value.chatId,
              this.attachMetas(value.message, metas),
              reservedSeq
            )
        );
    this.emitMutation(mutation);
    const stored = mutation.record.messages.find(
      (message) => message.id === value.message.id
    );
    if (!stored || stored.role !== "user") {
      throw new Error("消息提交后未出现在 canonical 账本");
    }
    return stored;
  }

  /** durable preparation 专用：由 canonical meta 反查 blob，renderer 无法指定替代内容。 */
  async revisionAttachmentPayloads(chatId: string, messageId: string) {
    const message = await this.store.getNativeMessage(chatId, {
      kind: "id",
      messageId,
    });
    if (message?.role !== "user") throw new Error("REVISION_STALE");
    return Promise.all(
      (message.attachments ?? []).map(async (meta) => {
        const dataUrl = await this.attachments.read(meta.id);
        const declared = /^data:([^;,]+);base64,/i.exec(dataUrl)?.[1];
        if (
          declared?.toLowerCase() !== meta.mediaType.toLowerCase() ||
          dataUrlByteSize(dataUrl) !== meta.byteSize
        ) {
          throw new Error(`附件 ${meta.id} 与 canonical 元数据不一致`);
        }
        return {
          filename: meta.filename,
          mediaType: meta.mediaType,
          dataUrl,
        };
      })
    );
  }

  async handleSessionBound(scope: AgentScope, session: SessionRef) {
    await this.store.bindSession(scope.conversationId, session);
  }

  async replaceSession(
    scope: AgentScope,
    expected: SessionRef,
    next: SessionRef | null
  ) {
    await this.store.replaceSession(scope.conversationId, expected, next);
  }

  async assignProject(chatId: string, projectId: string) {
    if (this.options.isAppProject?.(projectId)) {
      throw statusError(
        403,
        "App Project 只能从 App 的使用或编辑入口加入聊天"
      );
    }
    return summaryOf(await this.store.setProjectId(chatId, projectId));
  }

  async moveProject(
    chatId: string,
    expectedSource: string | null,
    target: string | null,
    appRole?: AppChatRole | null
  ) {
    return summaryOf(
      await this.store.moveChatProject(chatId, {
        expectedSource,
        target,
        appRole,
      })
    );
  }

  async releaseProject(chatId: string) {
    const summary = summaryOf(await this.store.clearProjectId(chatId));
    this.emit({ type: "upserted", summary });
    return summary;
  }

  publishUpserted(summary: ReturnType<typeof summaryOf>) {
    this.emit({ type: "upserted", summary });
  }

  publishRecord(record: ChatRecord | ChatMetadata) {
    this.emit({
      type: "upserted",
      summary: summaryOfChatLike(record),
    });
  }

  publishSessionInvalidated(record: Pick<ChatRecord, "id" | "incarnationId">) {
    this.emit({
      type: "session-invalidated",
      chatId: record.id,
      incarnationId: record.incarnationId,
    });
  }
  publishEffectiveArchive(
    record: ChatRecord | ChatMetadata,
    effectiveArchived: boolean
  ) {
    this.emit({
      type: "upserted",
      summary: {
        ...summaryOfChatLike(record),
        effectiveArchived,
      },
    });
  }
  async beginCreation(submission: ManualTurnSubmission) {
    if (submission.persistence.kind === "append") return;
    await beginAdoptedContinuation(this.store, submission);
    const workspaceScope: import("../../../shared/agent-ipc").AgentWorkspaceScope =
      submission.persistence.kind === "create-app"
        ? { kind: "app", appId: submission.persistence.input.appId }
        : submission.persistence.input.projectId
          ? {
              kind: "project",
              projectId: submission.persistence.input.projectId,
            }
          : {
              kind: "conversation",
              conversationId: submission.persistence.input.id,
            };
    const record = await this.options.chatHomes?.beginCreation({
      intentId: submission.intentId,
      chatId: submission.persistence.input.id,
      /* 提交里带来的 incarnation 就是这次创建的身份：不透传它，Chat Home 会
       * 另铸一个，随后 requireCreationHome 必然判定「与创建请求不一致」——
       * 同一个 incarnation 必须一路走到底，不能中途换人。 */
      ...(submission.persistence.input.incarnationId
        ? { incarnationId: submission.persistence.input.incarnationId }
        : {}),
      submission,
      workspaceScope,
      stagingOwner: submission.intentId,
    });
    if (!record) throw new Error("Chat Home 服务不可用");
    return record;
  }
  markCreationPrepared(submission: ManualTurnSubmission) {
    return submission.persistence.kind === "append"
      ? Promise.resolve()
      : this.options.chatHomes!.markPrepared(submission.persistence.input.id);
  }
  commitCreation(submission: ManualTurnSubmission) {
    return submission.persistence.kind === "append"
      ? Promise.resolve()
      : this.options.chatHomes!.commitCreation(submission.persistence.input.id);
  }

  commitCreationById(chatId: string) {
    return this.options.chatHomes!.commitCreation(chatId);
  }

  rollbackCreation(submission: ManualTurnSubmission) {
    return submission.persistence.kind === "append"
      ? Promise.resolve()
      : this.options.chatHomes!.rollbackCreation(submission.persistence.input.id);
  }

  rollbackCreationById(chatId: string) {
    return this.options.chatHomes!.rollbackCreation(chatId);
  }

  async appendTurnResult(
    conversationId: string,
    input: TurnCommitInput
  ): Promise<{
    outcome: "stored" | "empty" | "missing" | "retryable" | "fatal";
    storedMessage?: ChatMessage;
    subagents?: Record<string, PersistedSubagent>;
    error?: Error;
  }> {
    if (this.admission === "closed") {
      return { outcome: "retryable", error: new Error("聊天账本已关闭") };
    }
    if (!input.message && !Object.keys(input.subagentsDelta ?? {}).length) {
      return { outcome: "empty" };
    }
    let result: ChatMessageMutation;
    try {
      result = await this.store.appendTurnResult(conversationId, input);
    } catch (cause) {
      if (cause instanceof ChatNotFoundError) return { outcome: "missing", error: cause };
      if (
        cause instanceof ChatMessageInvariantError ||
        cause instanceof ChatLedgerCorruptError
      ) {
        return { outcome: "fatal", error: cause };
      }
      if (isPersistenceIoError(cause)) {
        return { outcome: "retryable", error: cause as Error };
      }
      /* 不可恢复的持久化失败此前只沿着 outcome 往上走，最终变成退出时那句
         「无法安全退出」——原因整个丢了。它必须先在日志里留下自己的名字。 */
      console.warn(`[chats] turn 持久化失败 chatId=${conversationId}`, cause);
      return {
        outcome: "fatal",
        error: cause instanceof Error ? cause : new Error(String(cause)),
      };
    }
    try {
      this.emitMutation(result);
    } catch {
      // ─── durable commit 已完成；renderer 消失不能改写账本结果 ───
    }
    return {
      outcome: "stored",
      ...(result.storedMessage ? { storedMessage: result.storedMessage } : {}),
      subagents: result.record.subagents ?? {},
    };
  }

  async appendCanonical(
    chatId: string,
    message: ChatMessage | UnsequencedChatMessage,
    reservedSeq?: number
  ) {
    if (this.admission === "closed") throw new Error("聊天账本已关闭");
    const mutation = await this.store.appendMessage(
      chatId,
      message,
      reservedSeq
    );
    this.emitMutation(mutation);
    return (
      mutation.record.messages.find((candidate) => candidate.id === message.id) ??
      message
    );
  }

  async createSection(input: {
    intentId: string;
    id: string;
    incarnationId: string;
    agent: import("../../../shared/agent-ipc").AgentBackendId;
    title?: string;
    projectId?: string;
    projectAdmissionHeld?: boolean;
    firstMessages: readonly UnsequencedUserMessage[];
  }) {
    if (this.admission !== "accepting") {
      throw new Error("聊天写入已关闭");
    }
    this.options.chatHomes?.assertCanCreateChat();
    const projectId = input.projectId ?? null;
    const create = async () => {
      const home = await this.options.chatHomes?.beginCreation({
      intentId: input.intentId,
      chatId: input.id,
      incarnationId: input.incarnationId,
      submission: input,
        workspaceScope: projectId
          ? { kind: "project", projectId }
          : { kind: "conversation", conversationId: input.id },
      });
      if (!home) throw new Error("Chat Home 服务不可用");
      try {
        const firstMessage = input.firstMessages[0];
        if (!firstMessage) throw new Error("Section 至少需要一条种子消息");
        await this.options.chatHomes!.markPrepared(input.id);
        const existing = this.store.getMetadata(input.id);
        if (existing) {
          const canonicalFirst = await this.store.getNativeMessage(input.id, {
            kind: "first-user",
          });
          if (
            existing.incarnationId !== input.incarnationId ||
            existing.agent !== input.agent ||
            existing.projectId !== projectId ||
            existing.createdAt !== firstMessage.createdAt ||
            (input.title !== undefined && existing.title !== input.title) ||
            !sameCanonicalFirstMessage(
              canonicalFirst ?? undefined,
              firstMessage
            )
          ) {
            throw new Error("CreateIntent 与已存在 Section 冲突");
          }
          for (const message of input.firstMessages.slice(1)) {
            const candidate = await this.store.getNativeMessage(input.id, {
              kind: "id",
              messageId: message.id,
            });
            if (candidate) {
              if (
                candidate.role !== message.role ||
                candidate.content !== message.content ||
                candidate.createdAt !== message.createdAt
              ) {
                throw new Error("CreateIntent 与已存在 Section 种子消息冲突");
              }
              continue;
            }
            await this.appendCanonical(input.id, message);
          }
          await this.options.chatHomes!.commitCreation(input.id);
          const restored = await this.store.getConversation(input.id);
          if (!restored) throw new Error("CreateIntent 对应 Section 已丢失");
          return restored;
        }
        const mutation = await this.store.create(
          input.id,
          firstMessage,
          projectId,
          input.agent,
          {
            incarnationId: home.incarnationId,
            homeDir: home.homeDir,
            title: input.title ?? null,
          }
        );
        const { record } = mutation;
        for (const message of input.firstMessages.slice(1)) {
          if (await this.store.getNativeMessage(input.id, {
            kind: "id",
            messageId: message.id,
          })) {
            continue;
          }
          await this.appendCanonical(input.id, message);
        }
        await this.options.chatHomes!.commitCreation(input.id);
        this.emitMutation(mutation);
        if (!input.title) this.scheduleTitle(record, firstMessage.content);
        return (await this.store.getConversation(input.id)) ?? record;
      } catch (cause) {
        if (!isChatMutationOutcomeUnknown(cause)) {
          await this.options.chatHomes!.rollbackCreation(input.id);
        }
        throw cause;
      }
    };
    return projectId && !input.projectAdmissionHeld
      ? this.withProject(projectId, create)
      : create();
  }

  assertOrdinaryTurnAllowed(chatId: string) {
    this.removal.assertOrdinaryTurnAllowed(chatId);
  }

  async remove(chatId: string) { return this.removal.remove(chatId); }

  configureAppChatDeactivation(
    handler: (chat: Omit<ChatMetadata, "preview">, action: "archive" | "delete") => Promise<void>
  ) {
    this.removal.configureAppDeactivation(handler);
  }

  prepareForArchive(chat: Omit<ChatMetadata, "preview">) {
    return this.removal.prepareForArchive(chat);
  }

  async removeAppChatHeld(chatId: string, appId: string) { return this.removal.removeAppChatHeld(chatId, appId); }

  async removeFromPurge(
    chatId: string,
    mode: ConversationDeletionMode = "local-only"
  ) {
    return this.removal.removeFromPurge(chatId, mode);
  }

  async removeByProject(projectId: string, projectLifecycle?: "held") { return this.removal.removeByProject(projectId, projectLifecycle); }

  async sweepAttachments() {
    return this.attachments.sweep(await this.store.listReferencedAttachmentIds());
  }

  async readSectionAttachment(sectionId: string, attachmentId: string) {
    const owned = await this.store.hasAttachmentReference(sectionId, attachmentId);
    if (!owned) throw statusError(404, "附件不属于该 Section");
    return this.attachments.read(attachmentId);
  }

  recoverDeletions(waitForCompletion = true) { return this.deletion.recover(waitForCompletion); }

  async exportAttachment(sectionId: string, attachmentId: string) {
    if (!this.store.getMetadata(sectionId)) {
      throw statusError(404, "Section 不存在");
    }
    const meta = await this.store.getAttachmentReference(sectionId, attachmentId);
    if (!meta) throw statusError(404, "附件不属于该 Section");
    return exportAttachmentFile({
      sourcePath: join(this.attachments.root, attachmentId),
      exportsRoot: this.exportsRoot,
      attachmentId,
      meta,
      dependencies: this.options.attachmentExportFs,
    });
  }

  stopAdmission() { this.admission = "draining"; }

  closeAdmission() { this.admission = "closed"; }

  reopenAdmission() { this.admission = "accepting"; }

  private assertAdmission() {
    if (this.admission !== "accepting") {
      throw new Error("应用正在退出，聊天写入已关闭");
    }
  }

  async awaitTitleJobs() {
    await this.titleRecovery;
    await this.titles.drain();
  }

  scheduleTitle(record: ChatRecord, firstMessage: string) { this.titles.schedule(record, firstMessage); }

  private attachMetas(
    message: UnsequencedUserMessage,
    metas: ChatAttachmentMeta[]
  ): UnsequencedUserMessage {
    return metas.length ? { ...message, attachments: metas } : message;
  }

  /** 附件先落盘、消息提交失败即回滚附件（无半持久化）；导出供回归测试直接驱动 */
  async commitWithAttachments<T>(
    payloads: ParsedAttachmentPayload[] | undefined,
    commit: (metas: ChatAttachmentMeta[]) => Promise<T>
  ): Promise<T> {
    const metas = await this.attachments.persist(payloads ?? []);
    try {
      return await commit(metas);
    } catch (cause) {
      if (!isChatMutationOutcomeUnknown(cause)) {
        await this.attachments.remove(metas);
      }
      throw cause;
    }
  }

  private withProject<T>(projectId: string, task: () => Promise<T>) {
    if (!this.options.withProject) {
      return Promise.reject(
        new Error(`${PROJECT_UNAVAILABLE}: Project 服务不可用`)
      );
    }
    return this.options.withProject(projectId, task);
  }

  private requireCreationHome(chatId: string, incarnationId?: string) {
    const home = this.options.chatHomes?.identityForCreation(chatId);
    if (!home) throw new Error("Chat Home creation intent 尚未物化");
    if (incarnationId && incarnationId !== home.incarnationId) {
      throw new Error("Chat Home incarnationId 与创建请求不一致");
    }
    return home;
  }

  private emit(event: ChatsEvent) {
    publishChatEvent({ event, store: this.store, window: this.window });
  }

  private emitMutation(mutation: ChatMessageMutation) {
    publishChatMutation(mutation, (event) => this.emit(event));
  }
}
