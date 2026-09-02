/**
 * [INPUT]: Depends only on shared Agent, ProductFailure, project, and submission contracts
 * [OUTPUT]: Provides schema v12 messages/notices with the read-only imported-segment marker, message-free renderer runtime context, ProductFailure-aware snapshots/events, import origin, fenced timeline/around/outline/find pagination, revisions, branches, grants, commits, and Chats bridge
 * [POS]: Backend-independent durable Chat wire authority shared by main, preload, and renderer
 */

import type {
  AgentBackendId,
  AgentTurnItemKind,
  FailureKind,
  UsageLimitInfo,
  SessionRef,
} from "./agent-ipc";
import type { IncarnationPrecondition } from "./submission";
import type { AppGrantRecord } from "./apps-ipc";
import type { TurnContextReceipt } from "./memory-ipc";
import type { ChatStorageFailure, ProductFailure } from "./product-failure";
import type {
  ChatStartState,
  ChatTitleJob,
  ChatTitleSource,
  ConversationContext,
} from "./placement/facts";

export const MESSAGE_BYTE_LIMIT = 32 * 1024;
/** 单条消息过程条目上限：reducer 产出、IPC 校验与存储 schema 共用同一真相 */
export const MESSAGE_PART_LIMIT = 200;
/** 只限制运行期重型 draft；meta 与落盘记录不按数量裁剪。 */
export const SUBAGENT_DRAFT_LIMIT = 128;
export const SUBAGENT_BYTE_LIMIT = 2 * 1024 * 1024;
export const SUPERSEDED_BRANCH_LIMIT = 8;
export const REVISION_STALE = "REVISION_STALE";
export const REVISION_NOT_IDLE = "REVISION_NOT_IDLE";
export type AppChatRole = "edit" | "use";

// ─── 过程条目：一 turn 一条 assistant 消息（决策 1），落盘不含 running 态 ───
export type ChatToolPart = {
  type: "tool";
  itemId: string;
  /** 由 AgentTurnItemKind 派生：文本类（agent-message/plan）走 ChatTextPart，不落工具行 */
  tool: Exclude<AgentTurnItemKind, "agent-message" | "plan">;
  title: string;
  detail?: string;
  status: "completed" | "failed";
  /** agent-failure only: renderer-localized warning/error semantics. */
  failure?: ProductFailure;
  severity?: "warning" | "error";
};

export type ChatTextPart = {
  type: "text";
  itemId: string;
  text: string;
  /** 原生 PlanThreadItem 产出的计划正文；finalize 提升为消息 content */
  kind?: "plan";
};

export type ChatSubagentPart = {
  type: "subagent";
  itemId: string;
  agentThreadId: string;
  name: string;
  status: "completed" | "failed";
  /** 来源只决定持久化可达性；缺省按原生 subagent 处理。 */
  origin?: "native" | "spawn";
  /** 纯展示品牌，不参与 GC 或生命周期判断。 */
  agent?: AgentBackendId;
};

export type ChatPart = ChatToolPart | ChatTextPart | ChatSubagentPart;

export type PersistedSubagentStatus =
  | "completed"
  | "errored"
  | "shutdown"
  | "interrupted";

export type PersistedSubagentMeta = {
  agentThreadId: string;
  name: string;
  model?: string;
  origin?: "native" | "spawn";
  agent?: AgentBackendId;
  status: PersistedSubagentStatus;
  spawnedAt: number;
  lastActivityAt: number;
  /** 原始结果字节数；用于判断持久 parts 是否仅保留了截断投影。 */
  resultBytes?: number;
  /** 生成持久 result part 时已知的截断事实；缺席只表示旧档未知。 */
  resultTruncated?: boolean;
};

export type PersistedSubagent = {
  meta: PersistedSubagentMeta;
  parts: ChatPart[];
};

// ─── 附件：内容落盘于 chat-attachments/<id>，消息仅存引用（决策 5） ───
export type ChatAttachmentMeta = {
  id: string;
  filename: string;
  mediaType: string;
  byteSize: number;
};

/** IPC 入参专用：附件原文交主进程落盘，不进消息 JSON */
export type ChatAttachmentPayload = {
  filename: string;
  mediaType: string;
  dataUrl: string;
};

type ChatMessageBase = {
  id: string;
  content: string;
  createdAt: number;
  /** 会话内持久单调序号；语义顺序只认 seq，墙钟仅供展示。 */
  seq: number;
  /**
   * 只读导入段的投影位：导入 entry 与原生消息各自从 1 开始编号，单看 seq
   * 两段会互相穿插。段在前、seq 在后，才是这条会话真正的时间顺序。
   * 只由 SQLite 读侧产出，落盘路径永不写。
   */
  segment?: "imported";
};

export type ChatRelayMeta = {
  sourceSectionId: string;
  chainId: string;
};

export type ChatNotice =
  | {
      kind: "app-chat-ready";
      appId: string;
      appRole: AppChatRole;
    }
  | {
      kind: "chain-paused" | "startup-recovered";
      rootChainId: string;
      pauseEpoch: number;
      actionId: string;
      pendingCount: number;
    }
  | {
      kind: "relay-failed";
      rootChainId: string;
      relayId: string;
    }
  | {
      kind: "manual-recovered";
      intentId: string;
    }
  | {
      kind: "skill-descriptions-truncated";
      turnId: string;
    }
  ;

/**
 * 「带 action 的暂停通知」的唯一判据。以前各调用点靠**排除**其它 kind 来收窄，
 * 于是每加一种 notice 就得回去补一条 `!==`——按正面条件判定，新 kind 才不会
 * 悄悄落进 action 分支。
 */
export type ActionableChatNotice = Extract<
  ChatNotice,
  { kind: "chain-paused" | "startup-recovered" }
>;

export const isActionableNotice = (
  notice: ChatNotice | undefined
): notice is ActionableChatNotice =>
  notice?.kind === "chain-paused" || notice?.kind === "startup-recovered";

export function noticeMessageContent(notice: ChatNotice) {
  if (notice.kind === "app-chat-ready") return "App Studio session is ready.";
  if (notice.kind === "manual-recovered") {
    return "应用重启，这条消息的回复已中断，请重新发送。";
  }
  if (notice.kind === "skill-descriptions-truncated") {
    return "本轮部分 Skill 描述因上下文预算被截短。";
  }
  if (notice.kind === "relay-failed") {
    return `Section 接力失败（relay ${notice.relayId}）。`;
  }
  const label =
    notice.kind === "chain-paused"
      ? "自动接力已暂停"
      : "重启后发现未完成的 Section 接力";
  return `${label}，当前有 ${notice.pendingCount} 条待处理消息。`;
}

export type UserChatMessage = ChatMessageBase & {
  role: "user";
  attachments?: ChatAttachmentMeta[];
  relay?: ChatRelayMeta;
  kind?: never;
  parts?: never;
  durationMs?: never;
  isError?: never;
  failureKind?: never;
  failure?: never;
  notice?: never;
};

export type AssistantChatMessage = ChatMessageBase & {
  role: "assistant";
  /** 原生 Plan turn 的最终计划 */
  kind?: "plan";
  /** assistant：最终回复之前的过程条目（工具行 + 中间文本） */
  parts?: ChatPart[];
  /** assistant：本轮耗时，驱动 "Worked for Xs" */
  durationMs?: number;
  isError?: boolean;
  /** descriptor 对原始错误作出的稳定机器分类。 */
  failureKind?: FailureKind;
  /** Product-owned failure; translated when rendered, never persisted as copy. */
  failure?: ProductFailure;
  /** 仅 failureKind==="usage-limit"：额度窗口与恢复时刻，驱动限流卡片。 */
  usageLimit?: UsageLimitInfo;
  /** optional/versioned；旧消息缺席表示 legacy/unknown，不反推状态。 */
  contextReceipt?: TurnContextReceipt;
  attachments?: never;
  relay?: never;
  notice?: never;
};

export type NoticeChatMessage = ChatMessageBase & {
  role: "notice";
  notice: ChatNotice;
  kind?: never;
  parts?: never;
  attachments?: never;
  relay?: never;
  durationMs?: never;
  isError?: never;
  failureKind?: never;
  failure?: never;
  contextReceipt?: never;
};

export type ChatMessage =
  | UserChatMessage
  | AssistantChatMessage
  | NoticeChatMessage;

type WithoutSequence<T> = T extends unknown ? Omit<T, "seq"> : never;
export type UnsequencedUserMessage = WithoutSequence<UserChatMessage>;
export type UnsequencedChatMessage = WithoutSequence<ChatMessage>;

export type ChatSummary = {
  id: string;
  /** Durable identity fence required by typed App destinations and message relists. */
  incarnationId?: string;
  title: string | null;
  updatedAt: number;
  /** 诞生即定死、永不改写；侧栏 Project 子列表按它排，位置才稳定。 */
  createdAt: number;
  projectId: string | null;
  /** App Project 成员必须有角色，普通聊天恒为 null。 */
  appRole: AppChatRole | null;
  /** Canonical durable ownership; appRole is a validated compatibility projection. */
  context?: ConversationContext;
  startState?: ChatStartState;
  titleSource?: ChatTitleSource;
  readOnlyReason?: "legacy-app-not-editable" | "external-readonly";
  chatRecordRevision?: number;
  chatMessageRevision?: number;
  agent: AgentBackendId;
  grants: AppGrantRecord[];
  grantRevision: number;
  /**
   * 最后一条 user/assistant 发言提炼出的散文，驱动侧栏 Activity 第二行。
   * main 现场从 messages 蒸出、永不落盘；提炼不出散文（纯代码/表格）时为 null。
   */
  preview: string | null;
  /** 导入前传身份；缺席表示原生 Product Chat。 */
  importOrigin?: ChatImportOrigin | null;
  /** 显式归档时间；父 Project 归档不会覆写本字段。 */
  archivedAt?: number;
  /** main 计算的父子合并投影。 */
  effectiveArchived?: boolean;
};

export type ChatImportOrigin = Readonly<{
  sourceKind: import("./history-import-ipc").HistorySourceKind;
  storageFingerprint: string;
  canonicalNativeId: string;
  aliases: string[];
  resumeAlias: string;
  originalCwd: string;
  historyRevision: string;
  adoptionSnapshotId?: string;
  sourceSize: number;
  sourceMtimeNs: string;
  /* 导入段的成色，只由读侧投影出来：分隔线说「以上是导入的历史消息」还是
     「来源已变化」，以及要不要提示被丢弃的未完成尾部，全看这两格。 */
  sourceStatus?: "match" | "changed" | "missing";
  incompleteTail?: boolean;
}>;

/** 只落主进程账本；renderer wire 与常驻 metadata 都必须显式剥离。 */
export type SupersededChatBranch = {
  intentId: string;
  supersededAt: number;
  supersedesUserMessageId: string;
  throughSeqEnd: number;
  messages: ChatMessage[];
};

/* preview 是 renderer 用的派生态，落盘的 record 必须够不着它：写成
   `Omit<..., "preview">` 就把「永不落盘」这条法则钉进类型系统——
   谁想顺手把它存下来，编译期就会红，而不是等到盘上旧值与消息算出的
   新值分叉之后，靠人眼去发现两个真相。 */
type CanonicalChatFacts = Required<
  Pick<
    ChatSummary,
    | "incarnationId"
    | "context"
    | "startState"
    | "titleSource"
    | "chatRecordRevision"
    | "chatMessageRevision"
  >
>;

export type ChatRecord = Omit<
  ChatSummary,
  "preview" | keyof CanonicalChatFacts
> & CanonicalChatFacts & {
  incarnationId: string;
  /** v6 canonical 恒为绝对路径；null/undefined 仅用于 v5 只读窗口与非持久测试投影。 */
  homeDir?: string | null;
  session: SessionRef | null;
  /** 收养前缀身份；缺席表示原生 Product Chat。 */
  importOrigin?: ChatImportOrigin | null;
  /** content-addressed AdoptionSnapshot digest；与 importOrigin 同生同灭。 */
  snapshotDigest?: string | null;
  createdAt: number;
  nextSeq: number;
  /** 预算裁剪掉的最大 seq；缺省表示从未裁剪过。 */
  trimmedThroughSeq?: number;
  /** 修订截下的旧尾段；main-private，不参与 canonical transcript。 */
  supersededBranches?: SupersededChatBranch[];
  /** 分支档被预算淘汰时保留的最大 throughSeqEnd。 */
  supersededBranchesTrimmedThroughSeq?: number;
  messages: ChatMessage[];
  subagents?: Record<string, PersistedSubagent>;
  titleJob: ChatTitleJob;
};

/** Renderer runtime facts deliberately exclude every message and branch payload. */
export type ChatRuntimeContext = Omit<
  ChatRecord,
  | "messages"
  | "supersededBranches"
  | "supersededBranchesTrimmedThroughSeq"
>;

export type ChatsSnapshot = {
  chats: ChatSummary[];
  collectionSnapshotRevision: number;
  warning?: string;
  storageFailures?: ChatStorageFailure[];
};

export type ChatsEvent =
  | { type: "upserted"; summary: ChatSummary; chatRecordRevision?: number; collectionSnapshotRevision?: number }
  | { type: "removed"; chatId: string; chatRecordRevision?: number; collectionSnapshotRevision?: number }
  | {
      type: "messages";
      chatId: string;
      incarnationId: string;
      revision: number;
      chatMessageRevision?: number;
      mode?: "replace";
      messages: ChatMessage[];
    }
  | {
      type: "messages-delta";
      chatId: string;
      incarnationId: string;
      revision: number;
      chatMessageRevision?: number;
      appended: ChatMessage[];
    }
  | {
      type: "session-invalidated";
      chatId: string;
      incarnationId: string;
    }
  | { type: "storage-failure"; failure: ChatStorageFailure }
  | { type: "warning"; message: string };

export type ChatMessagesSnapshot = {
  chatId: string;
  incarnationId: string;
  revision: number;
  /** Active immutable imported prefix; null for native-only Chats. */
  activeGenerationId?: string | null;
  /** Required by v12 main; optional only for an older renderer test/bridge snapshot. */
  chatMessageRevision?: number;
  mode?: "replace";
  messages: ChatMessage[];
  olderCursor?: ChatTimelineCursor | null;
  hasMoreBefore?: boolean;
};

export type ChatTimelineCursor = Readonly<{
  segment: "native" | "imported";
  beforeSeq: number;
  incarnationId: string;
  nativeMessageRevision: number;
  activeGenerationId: string | null;
}>;

export type ChatTimelinePage = Readonly<{
  chatId: string;
  incarnationId: string;
  nativeMessageRevision: number;
  activeGenerationId: string | null;
  messages: ChatMessage[];
  olderCursor: ChatTimelineCursor | null;
  hasMoreBefore: boolean;
}>;

export type ChatTimelinePageInput = Readonly<{
  chatId: string;
  cursor?: ChatTimelineCursor | null;
  limit?: number;
}>;

export type ChatTimelineAroundInput = Readonly<{
  chatId: string;
  messageId: string;
  radius?: number;
  fence?: Pick<ChatTimelineCursor, "incarnationId" | "nativeMessageRevision" | "activeGenerationId">;
}>;

export type ChatOutlineItem = Readonly<{
  messageId: string;
  seq: number;
  role: ChatMessage["role"];
  text: string;
}>;

/* 大纲从尾巴往回翻：beforeSeq 为 null 表示「该段的最新一条起」，否则只取
   seq 严格小于它的那批。方向只有一个，因为消费者只有一个——目录窗口要的
   永远是最新的 OUTLINE_WINDOW_LIMIT 条，正着翻要先把整条 Chat 读穿。 */
export type ChatOutlineCursor = Readonly<{
  segment: "imported" | "native";
  beforeSeq: number | null;
  incarnationId: string;
  nativeMessageRevision: number;
  activeGenerationId: string | null;
}>;

export type ChatOutlinePage = Readonly<{
  chatId: string;
  incarnationId: string;
  nativeMessageRevision: number;
  activeGenerationId: string | null;
  items: ChatOutlineItem[];
  nextCursor: ChatOutlineCursor | null;
}>;

export type ChatOutlineInput = Readonly<{
  chatId: string;
  cursor?: ChatOutlineCursor;
  limit?: number;
}>;

export type ChatFindCursor = Readonly<{
  offset: number;
  incarnationId: string;
  nativeMessageRevision: number;
  activeGenerationId: string | null;
}>;

export type ChatFindInput = Readonly<{
  chatId: string;
  query: string;
  cursor?: ChatFindCursor;
  limit?: number;
}>;

export type ChatFindPage = Readonly<{
  chatId: string;
  incarnationId: string;
  nativeMessageRevision: number;
  activeGenerationId: string | null;
  items: ChatOutlineItem[];
  /** 本次查询在这条 Chat 里的精确命中总数，与 cursor/limit 无关。 */
  total: number;
  nextCursor: ChatFindCursor | null;
}>;

export type CreateChatInput = {
  id: string;
  agent: AgentBackendId;
  firstMessage: UnsequencedUserMessage;
  projectId?: string | null;
  attachmentPayloads?: ChatAttachmentPayload[];
  /** main-owned CreationIntent identity；renderer 传入会在 admission 被覆盖。 */
  incarnationId?: string;
};

/** main-only；renderer 的 sections 校验器永远拒绝 persistence.kind=adopt。 */
export type AdoptChatInput = {
  id: string;
  title: string;
  agent: AgentBackendId;
  firstMessage: UnsequencedUserMessage;
  projectId: string;
  incarnationId: string;
  session: SessionRef;
  importOrigin: ChatImportOrigin;
  snapshotDigest: string;
  attachmentPayloads?: ChatAttachmentPayload[];
};

export type CreateAppChatInput = {
  id: string;
  appId: string;
  projectId: string;
  appRole: AppChatRole;
  agent?: AgentBackendId;
  firstMessage: UnsequencedUserMessage;
  attachmentPayloads?: ChatAttachmentPayload[];
  /** main-owned CreationIntent identity；renderer 传入会在 admission 被覆盖。 */
  incarnationId?: string;
};

export type AppendChatMessageInput = {
  chatId: string;
  message: UnsequencedUserMessage;
  attachmentPayloads?: ChatAttachmentPayload[];
  /** Coordinator 延迟 append 的第二道 CAS；旧 renderer 入口可省略。 */
  precondition?: IncarnationPrecondition;
  /** 仍属 append：保持 coordinator 的 existing/create 二分不生第四种状态。 */
  revise?: {
    supersedesUserMessageId: string;
    throughSeqEnd: number;
  };
};

export type TurnCommitInput = {
  message?: ChatMessage;
  subagentsDelta?: Record<string, PersistedSubagent>;
};

export type TurnCommitResult = {
  record: ChatRecord;
  storedMessage?: ChatMessage;
  appended: boolean;
  subagentsChanged: boolean;
};

export type RenameChatInput = {
  chatId: string;
  title: string;
};

export const CHATS_CHANNEL = {
  list: "chats:list",
  runtimeContext: "chats:runtime-context",
  timelinePage: "chats:timeline-page",
  timelineAround: "chats:timeline-around",
  outlinePage: "chats:outline-page",
  findMessages: "chats:find-messages",
  create: "chats:create",
  createForApp: "chats:create-for-app",
  append: "chats:append",
  rename: "chats:rename",
  remove: "chats:remove",
  readAttachment: "chats:read-attachment",
  event: "chats:event",
} as const;

export type ChatsBridgeApi = {
  list: () => Promise<ChatsSnapshot>;
  runtimeContext: (chatId: string) => Promise<ChatRuntimeContext | null>;
  timelinePage: (input: ChatTimelinePageInput) => Promise<ChatTimelinePage | null>;
  timelineAround: (input: ChatTimelineAroundInput) => Promise<ChatTimelinePage | null>;
  outlinePage: (input: ChatOutlineInput) => Promise<ChatOutlinePage | null>;
  findMessages: (input: ChatFindInput) => Promise<ChatFindPage | null>;
  create: (input: CreateChatInput) => Promise<ChatRecord>;
  createForApp: (input: CreateAppChatInput) => Promise<ChatRecord>;
  /** 返回存储后的消息（含主进程生成的附件元数据与截断结果），renderer 以其为准 */
  append: (input: AppendChatMessageInput) => Promise<ChatMessage>;
  rename: (input: RenameChatInput) => Promise<ChatSummary>;
  remove: (chatId: string) => Promise<void>;
  readAttachment: (attachmentId: string) => Promise<string>;
  onEvent: (callback: (event: ChatsEvent) => void) => () => void;
};
