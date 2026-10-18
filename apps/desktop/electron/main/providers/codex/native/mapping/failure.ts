/**
 * [INPUT]: Uses native RPC/Turn error fields and product runtime failure values.
 * [OUTPUT]: Exports nativeFailure with native auth, quota, policy, transport and protocol classifications.
 * [POS]: Native error boundary; ACP wrapper fields and free-form warnings do not determine success.
 */
import type { BackendFailure } from "../../../../backends/contracts/types";
import { agentRuntimeFailure, diagnosticFailureDetails, type AgentRuntimeFailureCode } from "@ai-chat/cloud-protocol/chats/content/failure-values";
import { nativeRecord } from "../transport/record";

export function nativeFailure(cause: unknown, redact: (text: string) => string = value => value): BackendFailure {
  const value = nativeRecord(cause), data = nativeRecord(value.data);
  const info = value.codexErrorInfo ?? data.codexErrorInfo;
  const message = redact(cause instanceof Error ? cause.message : typeof value.message === "string" ? value.message : "Native Codex execution failed");
  const known: Record<string, AgentRuntimeFailureCode> = {
    unauthorized: "auth-required", usageLimitExceeded: "quota-exhausted", rateLimitExceeded: "rate-limited",
    contextWindowExceeded: "context-exhausted", sessionBudgetExceeded: "context-exhausted",
    sandboxError: "request-rejected", cyberPolicy: "request-rejected", misalignmentPolicyViolation: "request-rejected", tooManyDenials: "request-rejected",
    flexUnavailable: "service-unavailable", serverOverloaded: "service-unavailable", internalServerError: "service-unavailable", badRequest: "request-rejected",
  };
  let code: AgentRuntimeFailureCode | undefined = value.nativeKind === "policy" ? "request-rejected" : value.nativeKind === "protocol" || value.nativeKind === "exit" ? "connection-lost" : value.nativeKind === "timeout" ? "service-unavailable" : undefined;
  code ??= typeof info === "string" ? known[info] : undefined;
  if (!code && (value.code === 401 || value.code === -32001)) code = "auth-required";
  if (!code && value.code === -32601) code = "mode-unsupported";
  if (!code && value.code === -32600) code = "request-rejected";
  if (!code && typeof info === "object" && info) {
    const details = nativeRecord(info);
    if (details.httpConnectionFailed || details.responseStreamConnectionFailed || details.responseStreamDisconnected || details.responseTooManyFailedAttempts) code = "connection-lost";
  }
  const failure = agentRuntimeFailure(code ?? "unknown", diagnosticFailureDetails(message));
  if (code === "quota-exhausted" || code === "rate-limited") return { kind: "usage-limit", message, limit: { window: code === "rate-limited" ? "provider" : "unknown" }, failure };
  return { kind: code === "auth-required" ? "auth-required" : "unknown", message, failure };
}
