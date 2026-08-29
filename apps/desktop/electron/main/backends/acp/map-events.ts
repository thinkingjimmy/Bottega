/**
 * [INPUT]: Depends on ACP schema session update/permission/stop reason and shared Agent DTO
 * [OUTPUT]: Provides ACP→Agent item mapping, native Plan lifecycle, permission/question mapping, and Codex/Claude subagent attribution metadata
 * [POS]: The pure translation layer of ACP transport, four AcpTurn shared and unheld processes
 */

import type {
  PermissionOption,
  RequestPermissionRequest,
  SessionUpdate,
  StopReason,
} from "@agentclientprotocol/sdk";
import {
  TOOL_DETAIL_BYTE_LIMIT,
  type AgentApprovalChoice,
  type AgentApprovalChoiceDecision,
  type AgentApprovalDecision,
  type AgentApprovalRequest,
  type AgentUserInputAnswers,
  type AgentUserInputQuestion,
  type AgentTurnItem,
  type AgentTurnItemKind,
} from "../../../../shared/agent-ipc";
import {
  finalizeNativePlan as finalizeAcpPlan,
  finalizeNativePlans as finalizeAcpPlans,
  mapNativePlanUpdate,
  planEntryText,
  removeNativePlan,
  type NativePlanState,
} from "./plan-events";

export { finalizeAcpPlan, finalizeAcpPlans };

export type AcpMappedEvent =
  | { type: "delta"; itemId: string; text: string }
  | { type: "item"; item: AgentTurnItem }
  | { type: "item-removed"; itemId: string };

export type AcpEventState = {
  messageIndex: number;
  thoughtIndex: number;
  planIndex: number;
  currentPlanId?: string;
  currentMessageId?: string;
  currentMessageSourceId?: string;
  messageText: string;
  currentThoughtId?: string;
  currentThoughtSourceId?: string;
  thoughtText: string;
  tools: Map<string, AgentTurnItem>;
  nativePlans: Map<string, NativePlanState>;
  turnFinalized: boolean;
  /** Claude 的限流快照走 usage_update 带外到达，失败分类时才用得上 */
  rateLimit?: unknown;
  skillDescriptionsTruncated?: true;
};

export function createAcpEventState(): AcpEventState {
  return {
    messageIndex: 0,
    thoughtIndex: 0,
    planIndex: 0,
    thoughtText: "",
    messageText: "",
    tools: new Map(),
    nativePlans: new Map(),
    turnFinalized: false,
  };
}

export function flushAcpMessage(
  state: AcpEventState,
  status: AgentTurnItem["status"] = "completed"
) {
  if (!state.currentMessageId || !state.messageText) return undefined;
  const item: AgentTurnItem = {
    itemId: state.currentMessageId,
    kind: "agent-message",
    title: "Replied",
    text: state.messageText,
    status,
  };
  state.currentMessageId = undefined;
  state.currentMessageSourceId = undefined;
  state.messageText = "";
  return item;
}

/** 思考段的 title/detail 只有一种推导；flush 与 running 快照共用。 */
function thoughtProjection(text: string) {
  return {
    title: utf8Truncate(text.split(/\r?\n/, 1)[0] || "Reasoning", 240),
    detail: utf8Truncate(text, TOOL_DETAIL_BYTE_LIMIT),
  };
}

function flushAcpThought(
  state: AcpEventState,
  status: AgentTurnItem["status"] = "completed"
) {
  if (!state.currentThoughtId || !state.thoughtText) return undefined;
  const item: AgentTurnItem = {
    itemId: state.currentThoughtId,
    kind: "reasoning",
    ...thoughtProjection(state.thoughtText),
    status,
  };
  state.currentThoughtId = undefined;
  state.currentThoughtSourceId = undefined;
  state.thoughtText = "";
  return item;
}

export function flushAcpSegments(
  state: AcpEventState,
  status: AgentTurnItem["status"] = "completed"
) {
  return [flushAcpMessage(state, status), flushAcpThought(state, status)]
    .filter((item): item is AgentTurnItem => Boolean(item))
    .map((item) => ({ type: "item" as const, item }));
}

function utf8Truncate(value: string, limit: number) {
  if (Buffer.byteLength(value, "utf8") <= limit) return value;
  const target = Math.max(0, limit - Buffer.byteLength("…", "utf8"));
  let end = value.length;
  while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > target) {
    end -= Math.max(1, Math.ceil((end * 0.1)));
  }
  while (
    end < value.length &&
    Buffer.byteLength(value.slice(0, end + 1), "utf8") <= target
  ) {
    end += 1;
  }
  return `${value.slice(0, end)}…`;
}

function textContent(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === "text" &&
    "text" in value &&
    typeof value.text === "string"
  ) {
    return value.text;
  }
  return "";
}

function summaryValue(value: unknown) {
  if (typeof value === "string") return value;
  if (
    value === undefined ||
    value === null ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function parameterSummary(value: unknown) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value !== "object" || Array.isArray(value)) {
    return summaryValue(value);
  }
  return Object.entries(value)
    .map(([key, item]) => `${key}: ${summaryValue(item)}`)
    .join("\n");
}

function diffText(block: Record<string, unknown>) {
  const path = typeof block.path === "string" ? block.path : "file";
  const oldText = typeof block.oldText === "string" ? block.oldText : "";
  const newText = typeof block.newText === "string" ? block.newText : "";
  const removed = oldText
    .split(/\r?\n/)
    .map((line) => `-${line}`)
    .join("\n");
  const added = newText
    .split(/\r?\n/)
    .map((line) => `+${line}`)
    .join("\n");
  return [`--- ${path}`, `+++ ${path}`, removed, added]
    .filter(Boolean)
    .join("\n");
}

export function toolDetailText(
  content: unknown,
  rawInput?: unknown,
  rawOutput?: unknown
) {
  const extracted = (Array.isArray(content) ? content : [])
    .flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        return [];
      }
      const value = block as Record<string, unknown>;
      if (value.type === "diff") return [diffText(value)];
      if (value.type !== "content") return [];
      const text = textContent(value.content);
      return text ? [text] : [];
    })
    .join("\n\n")
    .trim();
  const fallback =
    extracted ||
    parameterSummary(rawOutput) ||
    parameterSummary(rawInput);
  return fallback
    ? utf8Truncate(fallback, TOOL_DETAIL_BYTE_LIMIT)
    : undefined;
}

export function mapToolKind(kind: unknown): AgentTurnItemKind {
  if (kind === "execute") return "command";
  if (kind === "edit" || kind === "delete" || kind === "move") {
    return "file-change";
  }
  if (kind === "read") return "file-read";
  if (kind === "fetch" || kind === "search") return "web-search";
  if (kind === "think") return "reasoning";
  return "other";
}

// ─── 生图：ACP 无对应 kind，标题是唯一可辨信号 ───
// codex-acp 1.1.7 对生图恒发 kind:"other" + 固定标题 "Image generation"
// （起始 in_progress，落地补 content/rawOutput）；ACP 词表没有"生成图片"这一格，
// 判据只能落在标题上。后续 tool_call_update 不带 kind/title，靠既有继承延续身份。
const IMAGE_GENERATION_TITLE = "Image generation";

function toolItemKind(kind: unknown, title: unknown): AgentTurnItemKind {
  if (title === IMAGE_GENERATION_TITLE) return "image";
  return mapToolKind(kind);
}

/**
 * 生图条目的 detail 只在 backend→main broker 短链临时承载落盘绝对路径。
 * agent-bridge 发布前剥离它；rawOutput.result 的 base64 与路径都不进入 renderer/canonical。
 */
function savedImagePath(rawOutput: unknown) {
  const saved = (rawOutput as { savedPath?: unknown } | undefined)?.savedPath;
  return typeof saved === "string" && saved.trim() ? saved : undefined;
}

function toolStatus(status: unknown): AgentTurnItem["status"] {
  if (status === "completed") return "completed";
  if (status === "failed" || status === "cancelled") return "failed";
  return "running";
}

export function mapAcpUpdate(
  update: SessionUpdate,
  state: AcpEventState
): AcpMappedEvent[] {
  if (update.sessionUpdate === "agent_message_chunk") {
    const text = textContent(update.content);
    if (!text) return [];
    /* ACP gives this warning the same kind as genuine assistant prose. The
       prefix is therefore deliberately brittle: an upstream copy change is
       allowed to leak noise, while a broad match must never swallow prose. */
    if (text.startsWith("Warning: Skill descriptions were shortened to fit the ")) {
      state.skillDescriptionsTruncated = true;
      return [];
    }
    const thought = flushAcpThought(state);
    const changed =
      Boolean(state.currentMessageId && update.messageId) &&
      update.messageId !== state.currentMessageSourceId;
    const events: AcpMappedEvent[] = thought
      ? [{ type: "item", item: thought }]
      : [];
    if (changed) {
      const completed = flushAcpMessage(state);
      if (completed) events.push({ type: "item", item: completed });
    }
    if (!state.currentMessageId || changed) {
      state.currentMessageId = `acp-message-${++state.messageIndex}`;
      state.currentMessageSourceId = update.messageId ?? undefined;
      state.messageText = "";
    }
    state.messageText += text;
    events.push({ type: "delta", itemId: state.currentMessageId, text });
    return events;
  }
  if (update.sessionUpdate === "agent_thought_chunk") {
    const text = textContent(update.content);
    if (!text) return [];
    const message = flushAcpMessage(state);
    const changed =
      Boolean(state.currentThoughtId && update.messageId) &&
      update.messageId !== state.currentThoughtSourceId;
    const thought = changed ? flushAcpThought(state) : undefined;
    if (!state.currentThoughtId) {
      state.currentThoughtId = `acp-thought-${++state.thoughtIndex}`;
      state.currentThoughtSourceId = update.messageId ?? undefined;
      state.thoughtText = "";
    }
    state.thoughtText += text;
    return [
      ...(message ? [{ type: "item" as const, item: message }] : []),
      ...(thought ? [{ type: "item" as const, item: thought }] : []),
      {
        type: "item",
        item: {
          itemId: state.currentThoughtId,
          kind: "reasoning",
          ...thoughtProjection(state.thoughtText),
          status: "running",
        },
      },
    ];
  }
  if (update.sessionUpdate === "tool_call") {
    const completed = flushAcpSegments(state);
    const kind = toolItemKind(update.kind, update.title);
    const item: AgentTurnItem = {
      itemId: update.toolCallId,
      kind,
      title: update.title || "Running tool",
      detail:
        kind === "image"
          ? savedImagePath(update.rawOutput)
          : toolDetailText(update.content, update.rawInput),
      status: toolStatus(update.status),
    };
    state.tools.set(item.itemId, item);
    return [
      ...completed,
      { type: "item", item },
    ];
  }
  if (update.sessionUpdate === "tool_call_update") {
    const current = state.tools.get(update.toolCallId);
    const completed = current ? [] : flushAcpSegments(state);
    // 生图落地补丁不带 kind/title，身份由起始条目继承而来，无需二次辨认
    const kind =
      update.kind === undefined
        ? current?.kind ?? "other"
        : toolItemKind(update.kind, update.title ?? current?.title);
    const item: AgentTurnItem = {
      itemId: update.toolCallId,
      kind,
      title: update.title ?? current?.title ?? "Running tool",
      detail:
        (kind === "image"
          ? savedImagePath(update.rawOutput)
          : toolDetailText(update.content, update.rawInput, update.rawOutput)) ??
        current?.detail,
      status: toolStatus(update.status ?? current?.status),
    };
    state.tools.set(item.itemId, item);
    return [
      ...completed,
      { type: "item", item },
    ];
  }
  if (update.sessionUpdate === "plan") {
    const completed = flushAcpSegments(state);
    const text = planEntryText(update.entries);
    state.currentPlanId ??= `plan-${++state.planIndex}`;
    const item: AgentTurnItem = {
      itemId: state.currentPlanId,
      kind: "other",
      title: "Plan",
      detail: text,
      status: update.entries.every((entry) => entry.status === "completed")
        ? "completed"
        : "running",
    };
    return [
      ...completed,
      { type: "item", item },
    ];
  }
  if (update.sessionUpdate === "plan_update") {
    const completed = flushAcpSegments(state);
    return [...completed, mapNativePlanUpdate(state, update.plan)];
  }
  if (update.sessionUpdate === "plan_removed") {
    const removed = removeNativePlan(state, update.planId);
    return removed ? [removed] : [];
  }
  if (
    update.sessionUpdate === "config_option_update" ||
    update.sessionUpdate === "session_info_update"
  ) {
    return [];
  }
  if (update.sessionUpdate === "usage_update") {
    // 只留存最后一次快照：限流是账号级状态，后到的即是当前真值
    const meta = (update as { _meta?: Record<string, unknown> })._meta;
    const snapshot = meta?.["_claude/rateLimit"];
    if (snapshot !== undefined) state.rateLimit = snapshot;
    return [];
  }
  /* 具名静默白名单：这三支都是 ACP v1 schema 里的**已知成员**（zod.gen 有
     各自的 literal），产品有意不消费。把它们和真未知混进同一条 warn，等于
     让每一轮正常会话都在日志里喊狼来了——真出现未登记成员时反而没人看。
     消费评估见 L 账本（`current_mode_update` 与 Plan 双向同步 L10 同案，
     `user_message_chunk` 属回放/镜像面，产品今天不回显自己发出的输入）。 */
  if (
    update.sessionUpdate === "available_commands_update" ||
    update.sessionUpdate === "current_mode_update" ||
    update.sessionUpdate === "user_message_chunk"
  ) {
    return [];
  }
  /* 至此联合已被穷尽，`update` 在类型上是 never——但 wire 不受类型约束：
     升版后的 adapter 随时可能发来未登记的 literal，这条 warn 正是为它留的。
     故只在这里放宽读法，不把它降级成静默。 */
  console.warn(
    `[acp] 忽略未知 session update：${
      (update as { sessionUpdate?: string }).sessionUpdate
    }`
  );
  return [];
}

export type AcpPermissionMapping = {
  approval: AgentApprovalRequest;
  options: Map<AgentApprovalDecision, string>;
  rejectOptionId?: string;
  planReview: boolean;
  /** plan-review 专属：完整计划正文，由 AcpTurn 以原生 plan item 入 transcript */
  plan?: string;
  /** Codex plan review points at the same identity used by plan_update. */
  planItemId?: string;
  /**
   * 后端的 "always" 兑现不了「本会话总是允许」时置真：候选被过滤，
   * 且 accept-for-session→allow_once 的降级路径同步失效——
   * 否则被压制的语义会从后门原样复活。
   */
  sessionScopeSuppressed: boolean;
};

export type AcpQuestionMapping = {
  question: AgentUserInputQuestion;
  options: Map<string, string>;
  skipOptionId?: string;
};

function optionFor(
  options: PermissionOption[],
  kind: PermissionOption["kind"]
) {
  return options.find((option) => option.kind === kind);
}

function planChoiceLabel(option: PermissionOption) {
  if (option.optionId === "plan_approve") return "批准 Plan";
  if (option.optionId === "implement_plan") return "批准实施";
  if (option.optionId === "plan_revise") return "要求修改";
  if (option.optionId === "revise_plan") return "要求修改";
  if (option.optionId === "plan_reject_and_exit") return "拒绝并退出 Plan";
  if (option.optionId === "auto") return "退出 Plan，使用 Auto";
  if (option.optionId === "acceptEdits") return "退出 Plan，自动接受编辑";
  if (option.optionId === "default") return "退出 Plan，逐项审批";
  if (option.optionId === "plan") return "继续完善 Plan";
  if (option.optionId === "bypassPermissions") {
    return "退出 Plan，绕过权限检查";
  }
  return option.name;
}

function planChoiceTone(
  option: PermissionOption
): AgentApprovalChoice["tone"] {
  if (option.optionId === "plan_reject_and_exit") return "danger";
  if (option.optionId === "bypassPermissions") return "danger";
  /* codex 的两档显式列出而不是靠 kind 兜底：上游随时可能改 kind
     （1.6.2 现为 allow_once/reject_once），色调不该跟着别人的实现漂。 */
  if (option.optionId === "implement_plan") return "primary";
  if (option.optionId === "revise_plan") return "secondary";
  if (option.optionId === "plan_revise") return "secondary";
  if (option.optionId === "plan" || option.optionId === "default") {
    return "secondary";
  }
  return option.kind.startsWith("allow") ? "primary" : "secondary";
}

function permissionToolName(request: RequestPermissionRequest) {
  const direct = request.toolCall.name;
  if (direct) return direct;
  const meta = request.toolCall._meta;
  if (!meta || typeof meta !== "object") return undefined;
  const claudeCode = (meta as Record<string, unknown>).claudeCode;
  return claudeCode &&
    typeof claudeCode === "object" &&
    typeof (claudeCode as Record<string, unknown>).toolName === "string"
    ? ((claudeCode as Record<string, unknown>).toolName as string)
    : undefined;
}

/* ── codex plan-review 的双判据 ──────────────────────────────
 * 主判据 `_meta.codex.kind === "plan_review"`：codex 自家命名空间、随请求
 * 一等下发，比词表稳——2026-08-27 真机形状为
 *   toolCall{ toolCallId:"plan-review:<planItemId>", kind:"switch_mode" }
 *   options[ implement_plan(allow_once) / revise_plan(reject_once) ]
 *   _meta.codex{ kind:"plan_review", planItemId }
 * 兜底判据是 optionId 词表：`_meta` 是私有扩展，上游可以不打招呼就撤；
 * 而 optionId 是 PR #351 的公开契约。两条**任一命中即算**——单靠 `_meta`
 * 会在它消失的那天静默降级成普通两选项审批（正是本条要修的回归），单靠
 * 词表则会在上游改词表的那天同样失效。
 * ────────────────────────────────────────────────────────── */
const CODEX_PLAN_REVIEW_OPTION_IDS = ["implement_plan", "revise_plan"];

function isCodexPlanReview(request: RequestPermissionRequest) {
  const codex = (request._meta as { codex?: unknown } | undefined)?.codex;
  if (
    codex &&
    typeof codex === "object" &&
    (codex as Record<string, unknown>).kind === "plan_review"
  ) {
    return true;
  }
  return request.options.some((option) =>
    CODEX_PLAN_REVIEW_OPTION_IDS.includes(option.optionId)
  );
}

function codexPlanItemId(request: RequestPermissionRequest) {
  const codex = (request._meta as { codex?: unknown } | undefined)?.codex;
  if (!codex || typeof codex !== "object") return undefined;
  const value = (codex as Record<string, unknown>).planItemId;
  return typeof value === "string" && value ? value : undefined;
}

function planPermissionOptions(request: RequestPermissionRequest) {
  const kimi = request.options.filter((option) =>
    option.optionId.startsWith("plan_")
  );
  if (kimi.length) return kimi;
  if (isCodexPlanReview(request)) return request.options;
  const ids = new Set(request.options.map((option) => option.optionId));
  const claudeExit =
    permissionToolName(request) === "ExitPlanMode" ||
    (ids.has("plan") &&
      ids.has("default") &&
      (ids.has("acceptEdits") || ids.has("auto")));
  return claudeExit ? request.options : [];
}

/* ── plan-review 的计划正文 ───────────────────────────────────
 * Kimi 与 Claude ExitPlanMode 都把完整计划放在 toolCall.content 文本块；
 * Claude 另在 rawInput.plan 留有同文。计划是本轮权威产出，走原生 plan
 * item 进 transcript，因此不吃 TOOL_DETAIL_BYTE_LIMIT 的过程截断。
 * ────────────────────────────────────────────────────────── */
function planReviewPlanText(request: RequestPermissionRequest) {
  const fromContent = (Array.isArray(request.toolCall.content)
    ? request.toolCall.content
    : [])
    .flatMap((block) => {
      if (!block || typeof block !== "object" || Array.isArray(block)) {
        return [];
      }
      const value = block as Record<string, unknown>;
      if (value.type !== "content") return [];
      const text = textContent(value.content);
      return text ? [text] : [];
    })
    .join("\n\n")
    .trim();
  if (fromContent) return fromContent;
  const raw = (request.toolCall.rawInput as { plan?: unknown } | undefined)
    ?.plan;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export function mapQuestionRequest(
  request: RequestPermissionRequest
): AcpQuestionMapping | undefined {
  const answerOptions = request.options.filter((option) =>
    /^q0_opt_\d+$/.test(option.optionId)
  );
  const skipOption = request.options.find(
    (option) => option.optionId === "q0_skip"
  );
  if (!answerOptions.length && !skipOption) return undefined;
  const options = new Map<string, string>();
  for (const option of answerOptions) {
    if (!options.has(option.name)) options.set(option.name, option.optionId);
  }
  const header = request.toolCall.title ?? request.toolCall.name;
  return {
    question: {
      id: "q0",
      ...(header ? { header } : {}),
      question:
        toolDetailText(
          request.toolCall.content,
          request.toolCall.rawInput,
          request.toolCall.rawOutput
        ) ?? "Agent 需要你补充一个选择",
      ...(options.size
        ? {
            options: [...options].map(([label]) => ({
              label,
              description: "",
            })),
          }
        : {}),
    },
    options,
    skipOptionId: skipOption?.optionId,
  };
}

export function questionOutcome(
  mapping: AcpQuestionMapping,
  answers: AgentUserInputAnswers
) {
  const answer = answers[mapping.question.id]?.answers[0];
  const optionId = answer ? mapping.options.get(answer) : undefined;
  const selected = optionId ?? mapping.skipOptionId;
  return selected
    ? { outcome: "selected" as const, optionId: selected }
    : { outcome: "cancelled" as const };
}

export function mapPermissionRequest(
  requestId: string,
  request: RequestPermissionRequest,
  suppressSessionScope = false
): AcpPermissionMapping {
  const planOptions = planPermissionOptions(request);
  const planReview = planOptions.length > 0;
  const allowOnce = optionFor(request.options, "allow_once");
  const allowAlways = suppressSessionScope
    ? undefined
    : optionFor(request.options, "allow_always");
  const reject =
    optionFor(request.options, "reject_once") ??
    optionFor(request.options, "reject_always");
  const options = new Map<AgentApprovalDecision, string>();
  const choices = planOptions.map((option, index): AgentApprovalChoice => {
    const decision = `choice:${index}` as AgentApprovalChoiceDecision;
    options.set(decision, option.optionId);
    return {
      decision,
      optionId: option.optionId,
      label: planChoiceLabel(option),
      tone: planChoiceTone(option),
    };
  });
  if (!planReview) {
    if (allowOnce) options.set("accept", allowOnce.optionId);
    if (allowAlways) options.set("accept-for-session", allowAlways.optionId);
    if (reject) options.set("decline", reject.optionId);
  }
  const rejectAndExit = planOptions.find(
    (option) => option.optionId === "plan_reject_and_exit"
  );
  /* 请求被取消/超时时的安全默认：留在 Plan 里。claude 是 `plan`、
     kimi 是 `plan_revise`（走下面 reject 兜底）、codex 是 `revise_plan`。 */
  const keepPlanning = planOptions.find(
    (option) =>
      option.optionId === "plan" || option.optionId === "revise_plan"
  );
  /* plan-review：计划正文走原生 plan item 进 transcript，审批只剩决策；
     command 本就不是命令（Claude 发 "Ready to code?" 之类的标题回声），
     reason 仅在拿不到计划正文时兜底（如 Kimi 多方案无 content 的请求）。 */
  const plan = planReview ? planReviewPlanText(request) : undefined;
  const planItemId = planReview ? codexPlanItemId(request) : undefined;
  const reason = plan
    ? undefined
    : toolDetailText(
        request.toolCall.content,
        request.toolCall.rawInput,
        request.toolCall.rawOutput
      );
  return {
    approval: {
      approvalId: requestId,
      kind:
        request.toolCall.kind === "execute"
          ? "command"
          : ["edit", "delete", "move"].includes(
                request.toolCall.kind ?? ""
              )
            ? "file-change"
            : "permissions",
      ...(planReview ? { purpose: "plan-review" as const } : {}),
      ...(choices.length ? { choices } : {}),
      ...(planReview
        ? {}
        : {
            command:
              request.toolCall.title ?? request.toolCall.name ?? undefined,
          }),
      ...(reason ? { reason } : {}),
      canAcceptForSession: Boolean(allowAlways) && !planReview,
    },
    options,
    rejectOptionId:
      rejectAndExit?.optionId ?? keepPlanning?.optionId ?? reject?.optionId,
    planReview,
    ...(plan ? { plan } : {}),
    ...(planItemId ? { planItemId } : {}),
    sessionScopeSuppressed: suppressSessionScope,
  };
}

export function permissionOutcome(
  mapping: AcpPermissionMapping,
  decision: AgentApprovalDecision
) {
  const optionId =
    mapping.options.get(decision) ??
    (decision === "accept-for-session" && !mapping.sessionScopeSuppressed
      ? mapping.options.get("accept")
      : undefined);
  return optionId
    ? { outcome: "selected" as const, optionId }
    : { outcome: "cancelled" as const };
}

export function mapStopReason(stopReason: StopReason): {
  type: "done" | "cancelled" | "error";
  message?: string;
} {
  if (stopReason === "end_turn") return { type: "done" };
  if (stopReason === "cancelled") return { type: "cancelled" };
  return { type: "error", message: `ACP turn 已停止：${stopReason}` };
}

export type AcpSubagentMeta = {
  threadId: string;
  /** path 末段；缺席时由调用方回退到 threadId 前缀命名 */
  name?: string;
  status: "running" | "interrupted";
};

type CodexSubagentMeta = Readonly<{
  threadId?: unknown;
  path?: unknown;
  activity?: unknown;
}>;

/**
 * Codex emits a real child thread identity; Claude exposes only the parent
 * Task tool-use id. The latter is deliberately tool-attribution only: Claude
 * child text/thinking is filtered by the adapter and must not be implied here.
 */
export function mapAcpSubagentMeta(
  update: unknown,
  validateSessionId: (id: string) => boolean
): AcpSubagentMeta | undefined {
  const root = (
    update as {
      _meta?: {
        codex?: { subagent?: CodexSubagentMeta };
        claudeCode?: { parentToolUseId?: unknown };
      };
    } | null
  )?._meta;
  /* 两源互不耦合：codex 先问只因它的语义更全（真子线程），而不是 claude
     那支挂在它的失败分支上。摘掉任一支，另一支必须原样成立。 */
  return (
    codexSubagentMeta(root?.codex?.subagent, validateSessionId) ??
    claudeSubagentMeta(root?.claudeCode?.parentToolUseId)
  );
}

/** Codex 下发真实子线程身份：名字、活动态都由它自己说了算。 */
function codexSubagentMeta(
  meta: CodexSubagentMeta | undefined,
  validateSessionId: (id: string) => boolean
): AcpSubagentMeta | undefined {
  if (typeof meta?.threadId !== "string" || !validateSessionId(meta.threadId)) {
    return undefined;
  }
  const path =
    typeof meta.path === "string"
      ? meta.path.split("/").filter(Boolean)
      : Array.isArray(meta.path)
        ? meta.path.filter(
            (entry): entry is string => typeof entry === "string"
          )
        : [];
  return {
    threadId: meta.threadId,
    ...(path.at(-1) ? { name: path.at(-1) } : {}),
    status: meta.activity === "interrupted" ? "interrupted" : "running",
  };
}

/**
 * Claude 只给父 Task 的 tool-use id——那是**归属**，不是子线程。子 agent 的
 * text/thinking 被 adapter 过滤后压根不上 wire，所以这里能诚实说的只有
 * 「这些工具调用同属一次 Task」；UI 不得据此暗示与 Codex 同级。
 */
function claudeSubagentMeta(
  parentToolUseId: unknown
): AcpSubagentMeta | undefined {
  if (
    typeof parentToolUseId !== "string" ||
    Buffer.byteLength(parentToolUseId, "utf8") > 128 ||
    !/^[^\p{Cc}\p{Cf}]+$/u.test(parentToolUseId)
  ) {
    return undefined;
  }
  return {
    threadId: parentToolUseId,
    name: "Claude subagent tools",
    status: "running",
  };
}
