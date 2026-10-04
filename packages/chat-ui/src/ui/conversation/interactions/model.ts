/**
 * [INPUT]: The cloud live projection shapes.
 * [OUTPUT]: Provides ApprovalDecision, ApprovalRequest, ApprovalChoice and PendingQuestion — the types both cards and every host share — approvalChoiceLabel, a plan choice's text from the host catalog by kind (the adapter's label only for an unknown option), and approvalFailure/recoveryFailure/fullAccessFailure (over the closed APPROVAL_FAILURES/RECOVERY_FAILURES/FULL_ACCESS_FAILURES), which name the catalog line for a failed answer, recovery action or Full Access confirmation (a fallback line for anything unknown; the raw text is never a line).
 * [POS]: conversation/interactions' vocabulary; it renders nothing and decides nothing beyond which catalog key names a choice or a failure.
 */
import type { LiveProjection, PlanChoiceKind } from "@ai-chat/cloud-protocol/turns/live";
import { REMOTE_REASONS } from "@ai-chat/cloud-protocol/remote/reasons";
export type ApprovalDecision = "accept" | "accept-for-session" | "decline" | `choice:${number}`;
export type ApprovalRequest = Omit<LiveProjection["approvals"][number], "choices"> & {
  cwd?: string;
  choices?: ApprovalChoice[];
};
export type ApprovalChoice = { decision: ApprovalDecision; kind?: PlanChoiceKind; label?: string; tone: "primary" | "secondary" | "danger" };

/** A choice's text: its kind from the host's catalog, or, for an option no kind names, the adapter's own label. */
export const approvalChoiceLabel = (choice: Pick<ApprovalChoice, "kind" | "label">, t: (key: string) => string) =>
  choice.kind ? t(`chat.composer.approval.planChoice.${choice.kind}`) : choice.label ?? "";
export type PendingQuestion = {
  request: LiveProjection["userInputs"][number];
  index: number;
  queue: LiveProjection["userInputs"];
  busy: boolean;
  error: string | { copyKey: string };
  expiresAt?: number;
};

/* Failure lines. Main and the bridge throw codes and developer text (often Chinese); none of it is product copy, so each
   site maps what it can receive to one line per meaning, and anything else to the site's fallback. First match wins. */
type FailureRules<Line extends string> = ReadonlyArray<readonly [Line, RegExp]>;
const failureText = (cause: unknown) =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
const classify = <Line extends string>(rules: FailureRules<Line>, fallback: Line) => (cause: unknown): Line => {
  const text = failureText(cause);
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? fallback;
};
/* Patterns with Chinese text are built from string literals: the renderer is emitted with charset ascii, which escapes
   strings but leaves regex literals as they are, and one non-Latin-1 regex makes the whole chunk load as UTF-16. */
const anyOf = (...alternatives: string[]) => new RegExp(alternatives.join("|"));
const OUTCOME_UNKNOWN = /outcome-unknown|ChatMutationOutcomeUnknown/;
/* Another window holds the chat. The settings handler's non-resident refusal is not here: an App window can never pass
   it, which is a missing capability rather than a wrong window. */
const OTHER_WINDOW = anyOf("拒绝非主窗口", "resident in another window", "rejected from nonresident (App )?window", "App window cannot claim");
const REQUEST_ENDED = anyOf("interaction-expired", "request-not-active", "请求已结束", "审批选项已失效", "no live turn", "bridged turn has not started");

export const APPROVAL_FAILURES = ["ended", "otherWindow", "agentStopped", "unknown", "fallback"] as const;
export type ApprovalFailure = typeof APPROVAL_FAILURES[number];
export const approvalFailure = classify<ApprovalFailure>([
  ["unknown", OUTCOME_UNKNOWN],
  ["ended", REQUEST_ENDED],
  ["otherWindow", OTHER_WINDOW],
  ["agentStopped", /\bhost (\S+ )?(is not running|stopped|crashed|handshake-timeout|launch-failed)\b|invoke failed/],
], "fallback");

export const RECOVERY_FAILURES = ["changed", "otherWindow", "busy", "agentChanged", "confirmFullAccess", "worktree",
  "history", "remote", "unknown", "fallback"] as const;
export type RecoveryFailure = typeof RECOVERY_FAILURES[number];
const REMOTE_REASON = new RegExp(`(^|: )(${[...REMOTE_REASONS, "sync-clock-unavailable", "remote-authorization-busy"].join("|")})$`);
export const recoveryFailure = classify<RecoveryFailure>([
  ["unknown", OUTCOME_UNKNOWN],
  ["otherWindow", OTHER_WINDOW],
  ["busy", /TASK_START_DEFERRED/],
  ["worktree", /MANAGED_WORKTREE_FULL_ACCESS_FORBIDDEN/],
  ["confirmFullAccess", anyOf("FULL_ACCESS_ACK_REQUIRED", "请先确认 Full Access")],
  ["history", /CHAT_HISTORY_UNAVAILABLE/],
  ["agentChanged", anyOf("REVISION_STALE", "session 已被其他操作更新", "session backend 与聊天 agent 不一致", "已绑定到其他聊天")],
  ["changed", anyOf("interaction-expired", "request-not-active", "请求已结束", "resume retry (token|claim) 已失效", "与终态处理发生冲突")],
  ["remote", REMOTE_REASON],
], "fallback");

export const FULL_ACCESS_FAILURES = ["readOnly", "changed", "otherWindow", "storage", "fallback"] as const;
export type FullAccessFailure = typeof FULL_ACCESS_FAILURES[number];
export const fullAccessFailure = classify<FullAccessFailure>([
  ["readOnly", /CHAT_NOT_WRITABLE|readonly Chat only accepts/],
  ["changed", /REVISION_STALE|CHAT_OPTIONS_CONFLICT|AGENT_SWITCH_SUBMITTING|AGENT_SELECTION_REQUIRED/],
  ["otherWindow", OTHER_WINDOW],
  ["storage", anyOf("ChatMutationOutcomeUnknown", "持久化队列已关闭", "SQLite", "ZodError", "\\b(ENOENT|EACCES|EPERM|ENOSPC|EROFS|EBUSY|EIO|EEXIST|ENOTDIR|EISDIR)\\b")],
], "fallback");
