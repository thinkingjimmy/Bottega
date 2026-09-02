/**
 * [INPUT]: Depends on unknown ACP/JSON-RPC original cause and outbound access to the limited stream snapshot
 * [OUTPUT]: Provides exact structured ACP/HTTP classification into coarse terminal kind plus Agent ProductFailure semantics; arbitrary prose remains unknown
 * [POS]: ACP transport failure classifier; renderer owns localized explanations and recovery instructions
 */

import type {
  UsageLimitInfo,
  UsageLimitWindow,
} from "../../../../shared/agent-ipc";
import type { BackendFailure, FailureHints } from "../types";
import {
  agentRuntimeFailure,
  diagnosticFailureDetails,
  type AgentRuntimeFailureCode,
} from "../../../../shared/product-failure";

const AUTH_CODES = new Set([-32000, -32001, 401]);
const AUTH_DATA_VALUES = new Set([
  "auth_required",
  "authentication_required",
  "unauthenticated",
]);
const LOCKED_AUTH_MESSAGES = new Set([
  "Authentication required",
  "Authentication required.",
]);
const ACP_REQUEST_CANCELLED = -32800;

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function authData(value: unknown) {
  const data = record(value);
  if (!data) return false;
  return [data.kind, data.code, data.type, data.reason].some(
    (entry) =>
      typeof entry === "string" &&
      AUTH_DATA_VALUES.has(entry.trim().toLowerCase())
  );
}

// ─── 额度耗尽：三家的判据形状完全不同，各按其结构化真值认，不做统一正则 ───
//
// Codex（codex-acp 1.1.7）：turn error 的 data 带 codexErrorInfo="usageLimitExceeded"。
//   结构化的 RateLimitSnapshot（resets_at/window_minutes）被 codex-acp 扣在 sessionState
//   只喂 /status，不经 ACP 透出——所以窗口只能是 unknown，卡片据此隐去周期与倒计时。
// Claude（claude-agent-acp 0.62.0）：rate_limit_event 经 usage_update 的
//   _meta["_claude/rateLimit"] 透出，status="rejected" 即已达上限，
//   rateLimitType/resetsAt 是结构化真值。
// Kimi（0.29.2）：只有 provider 层 429 / provider.rate_limit（RPM 短时限流，
//   retryable），没有订阅制窗口概念，故窗口恒为 provider，不谈额度周期。

const CODEX_USAGE_LIMIT = "usageLimitExceeded";

const CLAUDE_WINDOWS: Record<string, UsageLimitWindow> = {
  five_hour: "five-hour",
  seven_day: "weekly",
  seven_day_opus: "weekly",
  seven_day_sonnet: "weekly",
  seven_day_overage_included: "weekly",
};

/** Kimi 的限流只在 HTTP 语义上可辨：429 或 provider.rate_limit 错误码 */
const PROVIDER_LIMIT_CODES = new Set(["provider.rate_limit"]);
const CONNECTION_CODES = new Set([
  "ECONNABORTED",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ETIMEDOUT",
]);
const SERVICE_HTTP_CODES = new Set([500, 501, 502, 503, 504]);
const REQUEST_HTTP_CODES = new Set([400, 403, 404, 405, 409, 413, 422]);

const CODEX_FAILURE_CODES: Record<string, AgentRuntimeFailureCode> = {
  contextWindowExceeded: "context-exhausted",
  sessionBudgetExceeded: "context-exhausted",
  serverOverloaded: "service-unavailable",
  internalServerError: "service-unavailable",
  badRequest: "request-rejected",
  sandboxError: "request-rejected",
  cyberPolicy: "request-rejected",
  unauthorized: "auth-required",
};

function codexUsageLimit(data: unknown) {
  return record(data)?.codexErrorInfo === CODEX_USAGE_LIMIT;
}

/** Claude 的 resetsAt 是秒级 epoch；统一抬成毫秒，且拒绝非有限值 */
function claudeResetsAt(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value * 1000)
    : undefined;
}

function claudeUsageLimit(rateLimit: unknown): UsageLimitInfo | undefined {
  const info = record(rateLimit);
  if (!info || info.status !== "rejected") return undefined;
  const type = typeof info.rateLimitType === "string" ? info.rateLimitType : "";
  return {
    window: CLAUDE_WINDOWS[type] ?? "unknown",
    ...(claudeResetsAt(info.resetsAt) === undefined
      ? {}
      : { resetsAt: claudeResetsAt(info.resetsAt) }),
  };
}

function providerUsageLimit(code: number | undefined, data: unknown) {
  const errorCode = record(data)?.code;
  return (
    code === 429 ||
    (typeof errorCode === "string" && PROVIDER_LIMIT_CODES.has(errorCode))
  );
}

function stringCode(source: Record<string, unknown> | undefined, data: unknown) {
  const candidates = [source?.code, record(source?.cause)?.code, record(data)?.code];
  return candidates.find((value): value is string => typeof value === "string");
}

function httpStatus(source: Record<string, unknown> | undefined, data: unknown) {
  const values = [
    source?.status,
    source?.statusCode,
    record(source?.cause)?.status,
    record(source?.cause)?.statusCode,
    record(data)?.status,
    record(data)?.statusCode,
  ];
  return values.find((value): value is number => typeof value === "number");
}

function backendFailure(
  code: AgentRuntimeFailureCode,
  message: string,
  limit?: UsageLimitInfo
): BackendFailure {
  const failure = agentRuntimeFailure(code);
  if (code === "auth-required") {
    return { kind: "auth-required", message, failure };
  }
  if (code === "rate-limited" || code === "quota-exhausted") {
    return {
      kind: "usage-limit",
      message,
      limit: limit ?? {
        window: code === "rate-limited" ? "provider" : "unknown",
      },
      failure,
    };
  }
  return { kind: "unknown", message, failure };
}

/** Transport owns exact secret redaction; this helper adds the bounded shared
 * diagnostic envelope only after that redaction has completed. */
export function withFailureDiagnostic(
  failure: BackendFailure,
  message: string
): BackendFailure {
  return {
    ...failure,
    message,
    failure: agentRuntimeFailure(
      failure.failure.domain === "agent-runtime" ? failure.failure.code : "unknown",
      diagnosticFailureDetails(message)
    ),
  };
}

export function isAcpCancelledError(cause: unknown): boolean {
  const source = record(cause);
  return (
    source?.code === ACP_REQUEST_CANCELLED ||
    record(source?.cause)?.code === ACP_REQUEST_CANCELLED
  );
}

export function classifyAcpFailure(
  cause: unknown,
  hints?: FailureHints
): BackendFailure {
  const source = record(cause);
  const code =
    typeof source?.code === "number"
      ? source.code
      : typeof record(source?.cause)?.code === "number"
        ? (record(source?.cause)!.code as number)
        : undefined;
  const data = source?.data ?? record(source?.cause)?.data;
  const message =
    typeof source?.message === "string"
      ? source.message
      : cause instanceof Error
        ? cause.message
        : String(cause);
  const codexCode = record(data)?.codexErrorInfo;
  const isAuth =
    (code !== undefined &&
      AUTH_CODES.has(code) &&
      (authData(data) || LOCKED_AUTH_MESSAGES.has(message.trim()))) ||
    codexCode === "unauthorized";
  if (isAuth) return backendFailure("auth-required", message);
  // 限流判据按证据强弱排序：Claude 的结构化快照 > Codex 的错误码 > provider 429
  const claudeLimit = claudeUsageLimit(hints?.rateLimit);
  if (claudeLimit) return backendFailure("quota-exhausted", message, claudeLimit);
  if (codexUsageLimit(data)) {
    return backendFailure("quota-exhausted", message, { window: "unknown" });
  }
  if (providerUsageLimit(code, data)) {
    return backendFailure("rate-limited", message, { window: "provider" });
  }
  if (codexCode === "usageLimitExceeded") {
    return backendFailure("quota-exhausted", message);
  }
  if (typeof codexCode === "string" && CODEX_FAILURE_CODES[codexCode]) {
    return backendFailure(CODEX_FAILURE_CODES[codexCode], message);
  }
  const wireCode = stringCode(source, data);
  if (wireCode && CONNECTION_CODES.has(wireCode.toUpperCase())) {
    return backendFailure("connection-lost", message);
  }
  const status = code && code >= 100 ? code : httpStatus(source, data);
  if (status === 402) return backendFailure("quota-exhausted", message);
  if (status === 408) return backendFailure("connection-lost", message);
  if (status && SERVICE_HTTP_CODES.has(status)) {
    return backendFailure("service-unavailable", message);
  }
  if (status && REQUEST_HTTP_CODES.has(status)) {
    return backendFailure("request-rejected", message);
  }
  return backendFailure("unknown", message);
}
