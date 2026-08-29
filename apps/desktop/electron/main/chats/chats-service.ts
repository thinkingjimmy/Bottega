/**
 * [INPUT]: Depends on Electron, shared chat contracts, ChatHomeService, ChatStore/AttachmentStore, ChatTitleJobs, window surface scope, pure guards, Gallery image projection, and deletion core
 * [OUTPUT]: Provides the renderer/coordinator chat facade; durable turn commits remain successful when best-effort renderer projection fails, and App windows receive only their resident Studio's active use chat and referenced attachments
 * [POS]: The main process of the chats module is stored on the front door; All new Chats must be owned by Chat Home creation saga
 */

import { dirname, join } from "node:path";
import { rendererEventBus } from "../window/surfaces/renderer-event-bus";
import { surfaceWindowController } from "../window/surfaces/surface-window-controller";
import { type BrowserWindow } from "electron";
import type {
  AgentBackendId,
  AgentScope,
  SessionRef,
} from "../../../shared/agent-ipc";
import { dataUrlByteSize } from "../../../shared/agent-ipc";
import type { AppChatRole } from "../../../shared/chats-ipc";
import {
  CHATS_CHANNEL,
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
import { rendererIpc } from "../ipc-registrar";
import { AttachmentStore } from "./attachment-store";
import {
  exportAttachmentFile,
  type AttachmentExportDependencies,
} from "./attachment-export";
import { redactImageDetails } from "../gallery/agent-image-projection";
import { ATTACHMENT_ID_PATTERN, CHAT_ID_PATTERN } from "./chat-schema";
import {
  ChatLedgerCorruptError,
  ChatMessageInvariantError,
  ChatNotFoundError,
} from "./chat-commit";
import {
  isPersistenceIoError,
  rejectLegacyRendererWrite,
  sameCanonicalFirstMessage,
  statusError,
} from "./chats-service-guards";
import { ChatStore, type ChatMessageMutation } from "./chat-store";
import type { ChatHomeService } from "../chat-home/chat-home-service";
import type { ConversationDeletionMode } from "../deletion/conversation-deletion-coordinator";
import {
  ChatDeletionDriver,
  type ChatDeletionOptions,
} from "./chat-deletion";
import {
  rendererRecordOf,
  summaryOfRecord as summaryOf,
} from "./chat-summary";
import { ChatTitleJobs } from "./chat-title-jobs";
import {
  appendInputSchema,
  adoptInputSchema,
  createAppInputSchema,
  createInputSchema,
  renameInputSchema,
  type ParsedAttachmentPayload,
} from "./chat-input";
import {
  createDormantAppChat,
  type DormantAppChatInput,
} from "./lifecycle/dormant-app-chat";
export { rejectLegacyRendererWrite } from "./chats-service-guards";

type ChatHomeCreationPort = Pick<ChatHomeService,
  "identityForCreation" | "assertCanCreateChat" | "beginCreation" |
  "markPrepared" | "commitCreation" | "rollbackCreation">;

export type ChatsServiceOptions = ChatDeletionOptions & {
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
  onTitleChanged?: (record: ChatRecord) => Promise<void>;
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
  private readonly attachments: AttachmentStore;
  private readonly deletion: ChatDeletionDriver;
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
    this.exportsRoot =
      options.exportsRoot ?? join(dirname(options.attachmentsRoot), "exports");
    this.titles = new ChatTitleJobs(store, options, (event) => this.emit(event));
  }

  register(window: BrowserWindow, rendererUrl: string) {
    this.window = window;
    const assertChatId = (chatId: unknown) => {
      if (typeof chatId !== "string" || !CHAT_ID_PATTERN.test(chatId)) {
        throw new Error("聊天 id 格式无效");
      }
      return chatId;
    };

    rendererIpc(window, rendererUrl, "拒绝非主窗口的聊天请求")
      .roles("main", "app-window")
      .handleWithContext(CHATS_CHANNEL.list, (context) => {
        const scoped = surfaceWindowController.appWindowUseChat(context);
        const chats = context.role === "main"
          ? this.store.list()
          : this.store.list().filter((chat) => chat.id === scoped?.chatId);
        return {
          chats: chats.map((chat) => ({
          ...chat,
          effectiveArchived:
            Boolean(chat.archivedAt) ||
            Boolean(
              chat.projectId &&
                this.options.isProjectArchived?.(chat.projectId)
            ),
          })),
          ...(context.role === "main" && this.store.getWarning()
            ? { warning: this.store.getWarning() }
            : {}),
        };
      })
      .handleWithContext(CHATS_CHANNEL.get, async (context, chatId) => {
        const id = assertChatId(chatId);
        surfaceWindowController.assertAppConversationRead(context, id);
        return (
        redactImageDetails(
          rendererRecordOf(await this.store.get(id))
        )
        );
      })
      .handleWithContext(CHATS_CHANNEL.messagesSnapshot, async (context, chatId) => {
        const id = assertChatId(chatId);
        surfaceWindowController.assertAppConversationRead(context, id);
        return redactImageDetails(await this.store.messagesSnapshot(id));
      })
      .roles("main")
      .handle(CHATS_CHANNEL.create, rejectLegacyRendererWrite)
      .handle(CHATS_CHANNEL.createForApp, rejectLegacyRendererWrite)
      .handle(CHATS_CHANNEL.append, rejectLegacyRendererWrite)
      .handle(CHATS_CHANNEL.rename, async (input) => {
        this.assertAdmission();
        const { chatId, title } = renameInputSchema.parse(input);
        const record = await this.store.setTitle(chatId, title);
        this.emit({ type: "upserted", summary: summaryOf(record) });
        this.titles.sync(record);
        return summaryOf(record);
      })
      .handle(CHATS_CHANNEL.remove, async (chatId) => {
        this.assertAdmission();
        const id = assertChatId(chatId);
        await this.remove(id);
      })
      .roles("main", "app-window")
      .handleWithContext(CHATS_CHANNEL.readAttachment, async (context, attachmentId) => {
        if (
          typeof attachmentId !== "string" ||
          !ATTACHMENT_ID_PATTERN.test(attachmentId)
        ) {
          throw new Error("附件 id 格式无效");
        }
        if (context.role === "app-window") {
          const scoped = surfaceWindowController.appWindowUseChat(context);
          const record = scoped ? await this.store.get(scoped.chatId) : null;
          const referenced = record?.messages.some((message) =>
            message.attachments?.some((attachment) => attachment.id === attachmentId)
          );
          if (!referenced) throw new Error("App window attachment read rejected");
        }
        return this.attachments.read(attachmentId);
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
              }
            : {
                incarnationId: home.incarnationId,
                homeDir: home.homeDir,
                appRole: value.appRole,
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
    this.options.chatHomes?.assertCanCreateChat();
    const value = adoptInputSchema.parse(input);
    const home = this.requireCreationHome(value.id, value.incarnationId);
    if (this.options.isAppProject?.(value.projectId)) throw new Error("App Project 不接受外源历史收养");
    await this.options.assertAgentReady?.(value.agent);
    const create = () => this.commitWithAttachments(value.attachmentPayloads, (metas) => this.store.create(
      value.id,
      this.attachMetas(value.firstMessage, metas),
      value.projectId,
      value.agent,
      {
        minimumNextSeq: sequence ? sequence.assistantSeq + 1 : 2,
        incarnationId: home.incarnationId,
        homeDir: home.homeDir,
        title: value.title,
        session: value.session,
        importOrigin: value.importOrigin,
        snapshotDigest: value.snapshotDigest,
      }
    ));
    const mutation = projectLifecycle === "held" ? await create() : await this.withProject(value.projectId, create);
    this.emitMutation(mutation);
    this.options.onAdoptedSessionBound?.(value.session, value.id);
    return mutation.record;
  }

  async appendUserMessage(input: AppendChatMessageInput, reservedSeq?: number) {
    this.assertAdmission();
    const value = appendInputSchema.parse(input);
    if (value.precondition) {
      const current = await this.store.get(value.chatId);
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
    const record = await this.store.get(chatId);
    const message = record?.messages.find(
      (candidate) => candidate.id === messageId
    );
    if (!record || message?.role !== "user") throw new Error("REVISION_STALE");
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

  /** 只持久化，事件由跨账本 Projects saga 在双落定后统一发布。 */
  async assignProject(chatId: string, projectId: string) {
    if (this.options.isAppProject?.(projectId)) {
      throw statusError(
        403,
        "App Project 只能从 App 的使用或编辑入口加入聊天"
      );
    }
    return summaryOf(await this.store.setProjectId(chatId, projectId));
  }

  /** lifecycle saga 专用；事件由 ProjectsService 在双账本落定后统一发布。 */
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

  /** local detach/missing 抢救没有 chat 外的第二成员账本，清绑定后即可发布。 */
  async releaseProject(chatId: string) {
    const summary = summaryOf(await this.store.clearProjectId(chatId));
    this.emit({ type: "upserted", summary });
    return summary;
  }

  publishUpserted(summary: ReturnType<typeof summaryOf>) {
    this.emit({ type: "upserted", summary });
  }

  publishRecord(record: ChatRecord) {
    this.emit({ type: "upserted", summary: summaryOf(record) });
  }

  publishSessionInvalidated(record: ChatRecord) {
    this.emit({
      type: "session-invalidated",
      chatId: record.id,
      incarnationId: record.incarnationId,
    });
  }
  publishEffectiveArchive(record: ChatRecord, effectiveArchived: boolean) {
    this.emit({
      type: "upserted",
      summary: { ...summaryOf(record), effectiveArchived },
    });
  }
  async beginCreation(submission: ManualTurnSubmission) {
    if (submission.persistence.kind === "append") return;
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
        const existing = await this.store.get(input.id);
        if (existing) {
          if (
            existing.incarnationId !== input.incarnationId ||
            existing.agent !== input.agent ||
            existing.projectId !== projectId ||
            existing.createdAt !== firstMessage.createdAt ||
            (input.title !== undefined && existing.title !== input.title) ||
            !sameCanonicalFirstMessage(
              existing.messages[0],
              firstMessage
            )
          ) {
            throw new Error("CreateIntent 与已存在 Section 冲突");
          }
          for (const message of input.firstMessages.slice(1)) {
            const candidate = existing.messages.find(
              (stored) => stored.id === message.id
            );
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
          return (await this.store.get(input.id)) ?? existing;
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
          const latest = await this.store.get(input.id);
          if (latest?.messages.some((candidate) => candidate.id === message.id)) {
            continue;
          }
          await this.appendCanonical(input.id, message);
        }
        await this.options.chatHomes!.commitCreation(input.id);
        this.emitMutation(mutation);
        if (!input.title) this.scheduleTitle(record, firstMessage.content);
        return (await this.store.get(input.id)) ?? record;
      } catch (cause) {
        await this.options.chatHomes!.rollbackCreation(input.id);
        throw cause;
      }
    };
    return projectId && !input.projectAdmissionHeld
      ? this.withProject(projectId, create)
      : create();
  }

  /** 人工/Section turn 与删除共用同一条 active deletion fence。 */
  assertOrdinaryTurnAllowed(chatId: string) {
    if (this.deletion.hasActive(chatId)) {
      throw new Error("聊天正在删除，不能启动新请求");
    }
  }

  /** renderer 单聊删除入口：与 send 共用门闩，先收割 pending/active turn 再删账本。 */
  async remove(chatId: string) {
    const candidate = await this.requireDeletionRecord(chatId);
    const memory = await this.deletion.snapshot(candidate);
    let record: ChatRecord | null = null;
    await this.withConversationLifecycle(async () => {
      if (await this.options.isConversationTransitioning?.(chatId)) {
        throw Object.assign(
          new Error("聊天正在保存为 App，完成或回滚前不能删除"),
          { status: 409 }
        );
      }
      const current = await this.requireDeletionRecord(chatId);
      this.assertDeletionSnapshotCurrent(candidate, current);
      record = current;
      await this.deletion.prepare(current, "local-only", memory);
    });
    await this.options.cancelConversations([chatId]);
    await this.deletion.drive(record!);
    this.options.releaseConversations?.([chatId]);
  }

  /** Purge 也只在短 Project gate 内落 deletion intent，Memory driver 恒在 gate 外。 */
  async removeFromPurge(
    chatId: string,
    mode: ConversationDeletionMode = "local-only"
  ) {
    const candidate = await this.requireDeletionRecord(chatId);
    const memory = await this.deletion.snapshot(candidate);
    let record: ChatRecord | null = null;
    await this.withConversationLifecycle(async () => {
      const current = await this.requireDeletionRecord(chatId);
      this.assertDeletionSnapshotCurrent(candidate, current);
      record = current;
      await this.deletion.prepare(current, mode, memory);
    });
    await this.options.cancelConversations([chatId]);
    await this.deletion.drive(record!, mode);
    this.options.releaseConversations?.([chatId]);
  }

  /** Project 删除逐 Chat 落 intent；held 只复用外层 P，每条 C lifecycle 仍由 deletion coordinator 串行。 */
  async removeByProject(projectId: string, projectLifecycle?: "held") {
    const chatIds = this.store.listByProject(projectId);
    for (const chatId of chatIds) {
      const candidate = await this.requireDeletionRecord(chatId);
      const memory = await this.deletion.snapshot(candidate);
      let record: ChatRecord | null = null;
      const prepare = async () => {
        const current = await this.requireDeletionRecord(chatId);
        this.assertDeletionSnapshotCurrent(candidate, current);
        if (current.projectId !== projectId) return;
        record = current;
        await this.deletion.prepare(current, "local-only", memory);
      };
      if (projectLifecycle === "held") await prepare();
      else await this.withConversationLifecycle(prepare);
      if (!record) continue;
      await this.options.cancelConversations([chatId]);
      await this.deletion.drive(record);
      this.options.releaseConversations?.([chatId]);
    }
  }

  async sweepAttachments() {
    return this.attachments.sweep(await this.store.listReferencedAttachmentIds());
  }

  async readSectionAttachment(sectionId: string, attachmentId: string) {
    const record = await this.store.get(sectionId);
    const owned = record?.messages.some(
      (message) =>
        message.role === "user" &&
        (message.attachments ?? []).some((meta) => meta.id === attachmentId)
    );
    if (!owned) throw statusError(404, "附件不属于该 Section");
    return this.attachments.read(attachmentId);
  }

  recoverDeletions(waitForCompletion = true) {
    return this.deletion.recover(waitForCompletion);
  }

  /** 把消息归属的图片安全导出；源账本与源附件永不修改。 */
  async exportAttachment(sectionId: string, attachmentId: string) {
    const record = await this.store.get(sectionId);
    if (!record) throw statusError(404, "Section 不存在");
    const meta = record.messages
      .filter((message) => message.role === "user")
      .flatMap((message) => message.attachments ?? [])
      .find((attachment) => attachment.id === attachmentId);
    if (!meta) throw statusError(404, "附件不属于该 Section");
    return exportAttachmentFile({
      sourcePath: join(this.attachments.root, attachmentId),
      exportsRoot: this.exportsRoot,
      attachmentId,
      meta,
      dependencies: this.options.attachmentExportFs,
    });
  }

  stopAdmission() {
    this.admission = "draining";
  }

  closeAdmission() {
    this.admission = "closed";
  }

  reopenAdmission() {
    this.admission = "accepting";
  }

  private assertAdmission() {
    if (this.admission !== "accepting") {
      throw new Error("应用正在退出，聊天写入已关闭");
    }
  }

  async awaitTitleJobs() {
    await this.titles.drain();
  }

  scheduleTitle(record: ChatRecord, firstMessage: string) {
    this.titles.schedule(record, firstMessage);
  }

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
      await this.attachments.remove(metas);
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

  private withConversationLifecycle<T>(task: () => Promise<T>) {
    return this.options.withConversationLifecycle(task);
  }

  private requireCreationHome(chatId: string, incarnationId?: string) {
    const home = this.options.chatHomes?.identityForCreation(chatId);
    if (!home) throw new Error("Chat Home creation intent 尚未物化");
    if (incarnationId && incarnationId !== home.incarnationId) {
      throw new Error("Chat Home incarnationId 与创建请求不一致");
    }
    return home;
  }

  private async requireDeletionRecord(chatId: string) {
    const record = await this.store.get(chatId);
    if (!record) throw new ChatNotFoundError(chatId);
    return record;
  }

  private assertDeletionSnapshotCurrent(
    expected: ChatRecord,
    current: ChatRecord
  ) {
    if (
      expected.incarnationId !== current.incarnationId ||
      expected.projectId !== current.projectId
    ) {
      throw Object.assign(
        new Error("Chat 归属已变化，请重试删除"),
        { status: 409 }
      );
    }
  }

  private emit(event: ChatsEvent) {
    const projected = redactImageDetails(event);
    let delivered = rendererEventBus.toRole("main", CHATS_CHANNEL.event, projected);
    const chatId = event.type === "upserted" ? event.summary.id
      : event.type === "warning" ? null : event.chatId;
    const appId = chatId && surfaceWindowController.appIdForActiveUseChat(chatId);
    if (appId) delivered += rendererEventBus.toApp(appId, CHATS_CHANNEL.event, projected);
    if (!delivered && this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(CHATS_CHANNEL.event, projected);
    }
  }

  private emitMutation(mutation: ChatMessageMutation) {
    this.emit({ type: "upserted", summary: summaryOf(mutation.record) });
    if (mutation.appended.length === 0) return;
    if (mutation.mode === "replace") {
      this.emit({
        type: "messages",
        chatId: mutation.record.id,
        incarnationId: mutation.record.incarnationId,
        revision: mutation.revision,
        mode: "replace",
        messages: structuredClone(mutation.record.messages),
      });
      return;
    }
    this.emit({
      type: "messages-delta",
      chatId: mutation.record.id,
      incarnationId: mutation.record.incarnationId,
      revision: mutation.revision,
      appended: structuredClone(mutation.appended),
    });
  }
}
