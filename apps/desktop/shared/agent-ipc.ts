/**
 * [INPUT]: Depends on chat-turn/chats/codex contracts, canonical Project scope, Extension generation identities, and Project Tools session receipts
 * [OUTPUT]: Provides presentation-free multi-backend DTOs, ProductFailure-aware terminal and warning lifecycle, structured usage-limit facts, MCP-plan-bound SessionRef, durable Skill receipts, runtime/auth/Steer contracts, structured input, CAS, and budgets (native vs imported tool-detail caps included)
 * [POS]: Shared Agent wire truth connecting Electron main, preload, and renderer without exposing mutable scope authority
 */

import type { CodexTurnOptions } from "./codex-ipc";
import type { SerializedTurnDraft } from "./chat-turn-reducer";
import type { ProductFailure } from "./product-failure";
import type { ExtensionPackageGenerationRef } from "./extensions-ipc";
import type { TurnProjectContext } from "./product-resource-scope";
import type {
  ChatAttachmentPayload,
  ChatMessage,
  PersistedSubagent,
  PersistedSubagentMeta,
  PersistedSubagentStatus,
  UnsequencedUserMessage,
} from "./chats-ipc";

export type { CodexTurnOptions } from "./codex-ipc";

// ─── 后端身份与能力：renderer 只消费声明，不识别供应商特例 ───
//
// 元组是唯一真相，联合由它派生。反过来写（联合独立声明、数组被联合约束）
// 会留下一个 fail-open 缺口：往联合里加成员而忘记加进数组，编译器一声不吭，
// 于是注册表、渲染顺序、zod schema 全部悄悄少一个后端。
export const AGENT_BACKEND_ORDER = [
  "codex",
  "claude",
  "kimi",
  "opencode",
] as const;

export type AgentBackendId = (typeof AGENT_BACKEND_ORDER)[number];

export type BackendStatus =
  | "missing"
  | "unsupported"
  | "auth-required"
  | "ready"
  | "error";

export type BackendRuntimeStatus =
  | "missing"
  | "error"
  | "unsupported"
  | "installed";

export type BackendAuthStatus =
  | "unknown"
  | "checking"
  | "authenticated"
  | "unauthenticated"
  | "error";

export type FailureKind = "auth-required" | "usage-limit" | "unknown";

/** ACP transport 只理解“敏感 contribution”，不依赖 Memory/Policy 领域。 */
export type SensitiveContributionValidation =
  | Readonly<{ kind: "not-run" }>
  | Readonly<{ kind: "allowed" }>
  | Readonly<{ kind: "skipped"; reason: "paused" }>
  | Readonly<{
      kind: "unavailable";
      failureKind:
        | "initialization"
        | "scope-resolution"
        | "policy-store"
        | "runtime-configuration"
        | "identity"
        | "provider"
        | "ownership"
        | "deadline"
        | "render-budget"
        | "stale-capability";
    }>;

export type PromptHandoff =
  | Readonly<{ kind: "not-created" }>
  | Readonly<{ kind: "pending"; transportRequestId?: string }>
  | Readonly<{ kind: "rejected"; transportRequestId?: string }>
  | Readonly<{ kind: "accepted"; transportRequestId: string }>;

// ─── 额度耗尽：订阅周期与服务商短时限流是两件事，词表上就不许混谈 ───
// five-hour/weekly 来自订阅制账号的滚动窗口（Claude 结构化上报）；
// provider 是服务商 RPM 限流（Kimi 429），几秒到几分钟自愈，没有"额度周期"可言；
// unknown 是后端确认了限流、但拿不到窗口语义（Codex 只给一句自然语言）。
export type UsageLimitWindow = "five-hour" | "weekly" | "provider" | "unknown";

export type UsageLimitInfo = {
  window: UsageLimitWindow;
  /** 恢复时刻（epoch ms）。拿不到就没有——卡片据此整行隐去，绝不编造。 */
  resetsAt?: number;
};

export type HeadlessPurpose =
  | "title"
  | "install-analysis"
  | "repair"
  | "serve"
  | "subagent";

export type AgentPermissionMode =
  | "ask-for-approval"
  | "approve-for-me"
  | "full-access";

/** main 在 turn 启动瞬间冻结的文件系统能力；renderer 永远不能提交本结构。 */
export type TurnFilesystemAccess = {
  workspace: string;
  readOnlyRoots: string[];
};

export type BackendCapabilities = {
  resume: boolean;
  permissionModes: AgentPermissionMode[];
  modelOptions: "full" | "list-only" | "none";
  imageInput: boolean;
  planMode: boolean;
  headless: HeadlessPurpose[];
  maintenance: boolean;
  builtinTools: "none" | "read" | "mutate";
  /** Login is an explicit terminal action even when auth status is unknowable. */
  terminalAuth?: boolean;
};

export type BackendReasoningEffortInfo = {
  effort: string;
  displayName?: string;
  description: string;
  hidden?: boolean;
};

export type BackendServiceTierInfo = {
  id: string;
  displayName: string;
};

export type BackendModelInfo = {
  slug: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort?: string;
  supportedReasoningEfforts?: BackendReasoningEffortInfo[];
  serviceTiers?: BackendServiceTierInfo[];
};

export type BackendInfo = {
  id: AgentBackendId;
  displayName: string;
  /** 兼容 renderer 的展示投影；准入必须读取 runtimeStatus/authStatus。 */
  status: BackendStatus;
  runtimeStatus: BackendRuntimeStatus;
  authStatus: BackendAuthStatus;
  capabilities: BackendCapabilities;
  version?: string;
  path?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  /**
   * runtime/auth 探针的原始诊断：CLI 原文与机器事实，永不翻译。
   * 「该装还是该登」是 runtimeStatus 的函数，呈现层自己取键——main 若
   * 把产品指令拼进这里，接缝就消失了，i18n 也随之不可能。
   */
  reason?: string;
};

export type SessionToolPlanBinding = Readonly<{
  planDigest: string;
  projectId: string | null;
}>;

export type SessionRef = {
  backend: AgentBackendId;
  id: string;
  /** Product-owned MCP plan identity; legacy/imported sessions omit it and rebuild fail-closed. */
  toolPlan?: SessionToolPlanBinding;
};
export const SESSION_ID_BYTE_LIMIT = 128;

export type ClaudeTurnOptions = {
  backend: "claude";
  model?: string;
  reasoningEffort?: string;
  /** Persisted user preference; runtime capability/effective state remain separate. */
  serviceTier?: string;
  permissionMode: AgentPermissionMode;
};

export type KimiTurnOptions = {
  backend: "kimi";
  model?: string;
  reasoningEffort?: string;
  permissionMode: AgentPermissionMode;
};

/**
 * OpenCode 的 effort 随模型 variants 浮动：无 variants 的模型在 wire 上
 * 连 effort 配置项都不会出现，所以它是 optional 而非必填——缺省即由 CLI
 * 自己取该模型的首个 variant。
 */
export type OpencodeTurnOptions = {
  backend: "opencode";
  model?: string;
  reasoningEffort?: string;
  permissionMode: AgentPermissionMode;
};

export type AgentTurnOptions =
  | CodexTurnOptions
  | ClaudeTurnOptions
  | KimiTurnOptions
  | OpencodeTurnOptions;

export type AgentScope = { conversationId: string };

// ─── 过程条目：一轮回复中的最小展示单元（后端中立词表） ───
export type AgentTurnItemKind =
  | "agent-message"
  | "plan"
  | "command"
  | "file-change"
  | "file-read"
  | "web-search"
  | "image"
  | "reasoning"
  /** Provider-neutral sessionFailure warning/error; copy is localized in renderer. */
  | "agent-failure"
  /** 反问用户：由 ACP 结构化请求映射并在作答/关闭时持久化。 */
  | "user-input"
  | "other";

export type AgentTurnItemStatus = "running" | "completed" | "failed";

export type AgentTurnItem = {
  itemId: string;
  kind: AgentTurnItemKind;
  /** agent-message / plan 专属：completed 时的全文 */
  text?: string;
  /** 折叠行文案，如 "Ran ls -la" */
  title: string;
  /** 展开正文（命令输出/diff 等），主进程侧已截断 */
  detail?: string;
  status: AgentTurnItemStatus;
  /** Only agent-failure items carry product semantics; title/detail stay diagnostic. */
  failure?: ProductFailure;
  severity?: "warning" | "error";
};

// ─── 工作区意图：renderer 只提交可验证身份，不提交 cwd/path ───
export type AgentWorkspaceScope =
  | { kind: "conversation"; conversationId: string }
  | { kind: "project"; projectId: string }
  | { kind: "app"; appId: string }
  | { kind: "default" };

// ─── 用户输入：本地 path 只在 main 解析 opaque ref 后出现 ───
export type AgentUserInput =
  | { type: "text"; text: string }
  | { type: "image"; dataUrl: string; filename: string }
  | { type: "skill"; skillRef: string }
  | { type: "mention"; fileRef: string; name: string }
  | { type: "section"; chatId: string; name: string }
  | { type: "history"; opaqueId: string; name: string };

/** @ 引用与 read_section 共用的落盘转录投影预算。 */
export const SECTION_EXPORT_BYTE_LIMIT = 256 * 1024;
export const SECTION_INPUT_LIMIT = 8;
export const SECTION_ATTACHMENT_COUNT_LIMIT = 4;
export const SECTION_ATTACHMENT_TOTAL_BYTE_LIMIT = 8 * 1024 * 1024;

/** 工具 detail / 过程文本单条截断上限（决策 7），协议层与持久化层共用 */
export const TOOL_DETAIL_BYTE_LIMIT = 4 * 1024;

/* ── 导入历史的工具详情另有一档 ──────────────────────────────────
 * 4 KiB 是原生 turn 的落盘约定：过程条目由我们自己生成，截短一点无非
 * 少看几行。导入历史不是：那是当年真实跑过的一屏 `git diff`、一段构建
 * 日志，剪到 4 KiB 就等于把证据剪掉一半。它仍在 32 KiB 的消息预算之内，
 * 只是把这一格让给真正需要的一方。
 * ────────────────────────────────────────────────────────── */
export const IMPORTED_TOOL_DETAIL_BYTE_LIMIT = 16 * 1024;

export const ATTACHMENT_LIMIT = 8;
export const ATTACHMENT_BYTE_LIMIT = 8 * 1024 * 1024;
export const ATTACHMENT_FILENAME_BYTE_LIMIT = 255;
export const AGENT_INPUT_LIMIT = 32;
export const OPAQUE_REF_BYTE_LIMIT = 256;
export const IMAGE_DATA_URL_PATTERN = /^data:image\/[a-z0-9+.-]+;base64,/i;

const BASE64_BODY_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** 完整校验图片 dataURL：前缀 + 非空 body + base64 字符集 + padding 对齐（主进程边界用） */
export function isValidImageDataUrl(value: string) {
  if (!IMAGE_DATA_URL_PATTERN.test(value)) return false;
  const body = value.slice(value.indexOf(",") + 1);
  return body.length > 0 && body.length % 4 === 0 && BASE64_BODY_PATTERN.test(body);
}

/** base64 dataURL 的真实字节数（扣除 = padding，兼容未 padding 编码），校验与元数据共用同一口径 */
export function dataUrlByteSize(dataUrl: string) {
  const length = dataUrl.length - dataUrl.indexOf(",") - 1;
  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  const remainder = Math.floor(((length % 4) * 3) / 4);
  return Math.max(0, Math.floor(length / 4) * 3 - padding + remainder);
}

// ─── Turn 生命周期：所有 transport 归一到同一事件面 ───
export type AgentApprovalRequest = {
  approvalId: string;
  kind: "command" | "file-change" | "permissions";
  purpose?: "plan-review";
  choices?: AgentApprovalChoice[];
  command?: string;
  cwd?: string;
  reason?: string;
  networkHost?: string;
  canAcceptForSession: boolean;
  agentName?: string;
};

export type AgentApprovalChoiceDecision = `choice:${number}`;

export type AgentApprovalChoice = {
  decision: AgentApprovalChoiceDecision;
  /** 协议原始选项标识；仅用于 Plan 模式本地状态闭环，不作为回传决策。 */
  optionId: string;
  label: string;
  tone: "primary" | "secondary" | "danger";
};

export type AgentApprovalDecision =
  | "accept"
  | "accept-for-session"
  | "decline"
  | AgentApprovalChoiceDecision;

export function isAgentApprovalDecision(
  value: unknown
): value is AgentApprovalDecision {
  return (
    value === "accept" ||
    value === "accept-for-session" ||
    value === "decline" ||
    (typeof value === "string" &&
      /^choice:(?:0|[1-9]\d{0,5})$/.test(value))
  );
}

export type AgentApprovalResponse = {
  requestId: string;
  approvalId: string;
  decision: AgentApprovalDecision;
};

export type AgentUserInputOption = {
  label: string;
  description: string;
};

export type AgentUserInputQuestion = {
  id: string;
  /** 问题主题（ACP 字段 title / 工具标题）。后端拿不出就不给——
   *  编一个占位串等于让 UI 去认那个占位串 */
  header?: string;
  question: string;
  options?: AgentUserInputOption[];
  multiSelect?: boolean;
  required?: boolean;
  isOther?: boolean;
  isSecret?: boolean;
};

export type AgentUserInputRequest = {
  userInputId: string;
  itemId: string;
  session: SessionRef;
  turnId: string;
  questions: AgentUserInputQuestion[];
  autoResolutionMs?: number | null;
  expiresAt?: number;
  agentName?: string;
};

export type AgentSubagentStatus =
  | PersistedSubagentStatus
  | "pendingInit"
  | "running"
  | "notFound";

export type AgentSubagentMeta = Omit<PersistedSubagentMeta, "status"> & {
  status: AgentSubagentStatus;
};

export type AgentLiveSubagent = {
  meta: AgentSubagentMeta;
  detailState: "available" | "unavailable";
  draft?: SerializedTurnDraft;
};

export type AgentUserInputResponse = {
  requestId: string;
  userInputId: string;
  answers: AgentUserInputAnswers;
};

export type AgentUserInputAnswers = Record<string, { answers: string[] }>;

export type PreparedSkillGenerationRef =
  | Readonly<{ kind: "library"; libraryId: string; generationId: string }>
  | Readonly<{
      kind: "extension";
      componentInstanceIdentity: string;
      package: ExtensionPackageGenerationRef;
    }>
  | Readonly<{ kind: "filesystem"; path: string }>;

/**
 * Main-owned durable receipt. Renderer input can never authorize this field:
 * the manual coordinator overwrites it after canonical Project resolution.
 */
export type PreparedSkillSelectionReceipt = Readonly<{
  /** Stable Registry ref owner shared by durable prepare and live custody. */
  refOwnerId: string;
  projectContext: TurnProjectContext;
  visibleInventoryVersion: string;
  backend: AgentBackendId;
  planMode: boolean;
  candidates: readonly Readonly<{
    name: string;
    sourceKind: "library" | "extension" | "project" | "system";
    generationRef: PreparedSkillGenerationRef;
    digest: `sha256:${string}`;
    enabled: boolean;
    requires?: string;
    metadata: Readonly<{ description: string; displayName?: string }>;
    path: string;
    ownerRef: string;
  }>[];
}>;

export type AgentSendPayload = {
  requestId: string;
  session?: SessionRef;
  scope: AgentScope;
  turnOptions: AgentTurnOptions;
  planMode?: boolean;
  input: AgentUserInput[];
  /** Main-owned; accepted only for a canonical manual-turn origin. */
  preparedSkillSelection?: PreparedSkillSelectionReceipt;
};

export type SteerAdmission = {
  requestId: string;
  /** outboxRef 与 userMessage.id 必须同值。 */
  outboxRef: string;
  createdAt: number;
  input: AgentUserInput[];
  displayText: string;
  attachmentPayloads?: ChatAttachmentPayload[];
  /** route-independent capsule；Steer outbox identity 不得进入 content。 */
  content: import("./submission").SubmissionContentV1;
  /** 组装时冻结的 Workspace owner；main 在 staging/inject 前复验。 */
  workspacePrecondition: import("./submission").WorkspacePrecondition;
  userMessage: UnsequencedUserMessage;
};

export type SteerIpcReceipt =
  | {
      outcome: "injected";
      outboxRef: string;
      persistState: "persisted" | "pending";
    }
  | {
      outcome: "unconsumed";
      outboxRef: string;
      reason: string;
      /** Steer 已原子转交出的 durable manual custody 身份。 */
      derivedIntentId: string;
    }
  | { outcome: "ambiguous"; outboxRef: string; reason: string }
  | { outcome: "dismissed"; outboxRef: string; reason: string }
  | { outcome: "failed"; outboxRef: string; reason: string };

export type SteerOutboxProjection = {
  outboxRef: string;
  requestId: string;
  /** transferred 后用于继续观察 derived manual outcome。 */
  derivedIntentId?: string;
  phase:
    | "journaled"
    | "injected"
    | "awaitingDecision"
    | "persisted"
    | "transferred"
    | "dismissed"
    | "failed";
  createdAt: number;
  reason?: string;
  /**
   * failed/transferred intent 的 renderer 恢复投影。文本/图片可恢复内容；
   * staged resource 只能保留 main-owned 精确 custody，不得按当前 Workspace 重发。
   */
  recovery?: {
    mode: "editable" | "decision";
    displayText: string;
    input: AgentUserInput[];
    attachmentPayloads?: ChatAttachmentPayload[];
  };
};

export type SteerDecision = {
  outboxRef: string;
  action: "resend" | "dismiss";
};

export type TurnPersistOutcome =
  | "stored"
  | "empty"
  | "missing"
  | "retryable"
  | "fatal";

/**
 * 会话运行态的 Speed 判据。**只能是机器事实，不能是产品句子**——main 一旦
 * 在这里拼一句英文，五语言目录就永远够不着它（与 BackendInfo.reason 同一条
 * 接缝：呈现层自己取键）。后端自己的解释（free / model_not_allowed …）由
 * adapter 的 turned-off 消息原样进转录，不在这里复述第二遍。
 */
export type SessionServiceTierReason =
  | "modelUnsupported"
  | "backendOff"
  | "backendOn";

export type SessionServiceTierEffective = Readonly<{
  value: string;
  reason: SessionServiceTierReason;
  at: number;
}>;

export type TurnSnapshot = {
  requestId: string;
  /** root assistant 在 turn admission 时预留的 canonical 会话序号。 */
  assistantSeq: number;
  steeringSupported: boolean;
  phase: "starting" | "active" | "resume-failed" | "retry-claiming";
  cleanup: "pending" | "complete" | "failed";
  persist:
    | "unprepared"
    | "pending"
    | "stored"
    | "empty"
    | "missing"
    | "retryable"
    | "fatal";
  blocksNewTurn: boolean;
  session?: SessionRef;
  serviceTierEffective?: SessionServiceTierEffective;
  retryToken?: string;
  allowedActions?: Readonly<{
    sameSession: boolean;
    freshSession: boolean;
    abandon: boolean;
  }>;
  draft: SerializedTurnDraft;
  approvals: AgentApprovalRequest[];
  userInputs: AgentUserInputRequest[];
  liveSubagents: Record<string, AgentLiveSubagent>;
  terminal?: "done" | "cancelled" | "error";
  failureKind?: FailureKind;
  /* live 终态的结构化失败：持久化后的权威在 assistantMessage.failure，
     这里只服务 persist 落地前的实时窗口。 */
  failure?: ProductFailure;
  usageLimit?: UsageLimitInfo;
};

export type TurnAttachResult = {
  lastSeq: number;
  turn: TurnSnapshot | null;
  steerIntents: SteerOutboxProjection[];
};

export type AgentEventBody =
  | { requestId: string; type: "session"; session: SessionRef }
  /* `effective` 缺席 = 清空语义：用户显式重开 Speed 后，本会话的回落事实必须
     当场作废。用「新增一个 cleared 事件」会让 registry 与 renderer 各多一条
     分支去合流两种事实；让同一条事件的负载可空，两侧都是一次直接赋值。 */
  | {
      requestId: string;
      type: "service-tier-effective";
      effective?: SessionServiceTierEffective;
    }
  | { requestId: string; type: "item-delta"; itemId: string; text: string }
  | { requestId: string; type: "item"; item: AgentTurnItem }
  | { requestId: string; type: "item-removed"; itemId: string }
  | {
      requestId: string;
      type: "approval-requested";
      approval: AgentApprovalRequest;
    }
  | { requestId: string; type: "approval-closed"; approvalId: string }
  | {
      requestId: string;
      type: "user-input-requested";
      request: AgentUserInputRequest;
    }
  | { requestId: string; type: "user-input-closed"; userInputId: string }
  | {
      requestId: string;
      type: "subagent-update";
      agent: AgentSubagentMeta;
      detailState: AgentLiveSubagent["detailState"];
    }
  | {
      requestId: string;
      type: "subagent-item";
      agentThreadId: string;
      agent: AgentSubagentMeta;
      item: AgentTurnItem;
    }
  | {
      requestId: string;
      type: "subagent-item-delta";
      agentThreadId: string;
      agent: AgentSubagentMeta;
      itemId: string;
      text: string;
    }
  | { requestId: string; type: "turn-state-changed"; turn: TurnSnapshot }
  | {
      requestId: string;
      type: "turn-persisted";
      terminal: "done" | "cancelled" | "error";
      message?: string;
      outcome: TurnPersistOutcome;
      blocksNewTurn: boolean;
      cleanup: TurnSnapshot["cleanup"];
      assistantMessage?: ChatMessage;
      subagents?: Record<string, PersistedSubagent>;
    };

export type AgentEvent = AgentEventBody & {
  conversationId: string;
  seq: number;
};

// ─── 会话活动广播：与 agent:event 正交 ───
// agent:event 只发给该会话的唯一订阅者，后台会话无人收；
// activity 是窗口级广播，只在 (running, waiting) 复合态跃迁时发一次，
// 供侧边栏渲染运行/待你回话/完成三态。
//
// waiting 是「turn 还在跑，但卡在你身上」——存在未闭合的审批或追问。
// 它不是 running 的替代而是其子态：running 为假时 waiting 必假。
export type ChatActivityEvent = {
  conversationId: string;
  running: boolean;
  waiting: boolean;
  terminal?: "done" | "cancelled" | "error";
};

/** 冷启动对齐用的活动快照：只列仍在跑的会话，附带各自是否卡在用户身上。 */
export type ChatActivitySnapshot = {
  conversationId: string;
  waiting: boolean;
};

export const AGENT_CHANNEL = {
  send: "agent:send",
  event: "agent:event",
  cancel: "agent:cancel",
  respondApproval: "agent:respond-approval",
  respondUserInput: "agent:respond-user-input",
  turnAttach: "agent:turn-attach",
  turnDetach: "agent:turn-detach",
  abandonFatalTurn: "agent:abandon-fatal-turn",
  acknowledgeCleanupFailure: "agent:acknowledge-cleanup-failure",
  retryWithoutSession: "agent:retry-without-session",
  retrySameSession: "agent:retry-same-session",
  activity: "agent:activity",
  activityList: "agent:activity-list",
  steer: "agent:steer",
  decideSteer: "agent:decide-steer",
  ackSteerIntents: "agent:ack-steer-intents",
} as const;

export type AgentBridgeApi = {
  send: (payload: AgentSendPayload) => Promise<void>;
  cancel: (requestId: string) => void;
  respondApproval: (response: AgentApprovalResponse) => Promise<void>;
  respondUserInput: (response: AgentUserInputResponse) => Promise<void>;
  attachTurn: (
    conversationId: string,
    attachmentId: string
  ) => Promise<TurnAttachResult>;
  detachTurn: (conversationId: string, attachmentId: string) => void;
  abandonFatalTurn: (conversationId: string) => Promise<void>;
  acknowledgeCleanupFailure: (conversationId: string) => Promise<void>;
  retryWithoutSession: (requestId: string, retryToken: string) => Promise<void>;
  retrySameSession?: (requestId: string, retryToken: string) => Promise<void>;
  onEvent: (callback: (event: AgentEvent) => void) => () => void;
  onActivity: (callback: (event: ChatActivityEvent) => void) => () => void;
  listActivity: () => Promise<ChatActivitySnapshot[]>;
  steer: (input: SteerAdmission) => Promise<SteerIpcReceipt>;
  decideSteer: (input: SteerDecision) => Promise<SteerIpcReceipt>;
  ackSteerIntents: (outboxRefs: string[]) => Promise<void>;
};
