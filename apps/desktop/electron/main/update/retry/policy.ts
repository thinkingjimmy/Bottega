/**
 * [INPUT]: Depends on shared update-failure reasons and native updater error/status/header facts
 * [OUTPUT]: Provides checkRetryDelay and classifyUpdateFailure with bounded transient recovery and Retry-After support
 * [POS]: Main update retry policy; UpdateService owns the single timer, request admission and connectivity lifecycle
 */

import type { UpdateFailureReason } from "../../../../shared/ipc/settings/update-ipc";

const MINUTE = 60_000;
export const DAILY_CHECK_MS = 24 * 60 * MINUTE;
const RETRY_DELAYS = [5 * MINUTE, 30 * MINUTE, 2 * 60 * MINUTE];

export function checkRetryDelay(attempt: number) {
  return RETRY_DELAYS[attempt] ?? DAILY_CHECK_MS;
}

export function classifyUpdateFailure(error: Error, now: number): Readonly<{
  reason: UpdateFailureReason;
  retryable: boolean;
  retryAfterMs: number;
}> {
  const details = error as Error & { statusCode?: number; status?: number; code?: string; headers?: Record<string, unknown> };
  const status = details.statusCode ?? details.status ?? Number(error.message.match(/\b([45]\d{2})\b/)?.[1]);
  const message = `${details.code ?? ""} ${error.message}`;
  const retryAfter = details.headers?.["retry-after"] ?? details.headers?.["Retry-After"]
    ?? error.message.match(/"?retry-after"?\s*:\s*"([^"\r\n]+)"/i)?.[1];
  const seconds = typeof retryAfter === "string" || typeof retryAfter === "number" ? Number(retryAfter) : NaN;
  const date = typeof retryAfter === "string" ? Date.parse(retryAfter) : NaN;
  const wait = Number.isFinite(seconds) ? seconds * 1_000 : Number.isFinite(date) ? date - now : 0;
  const retryAfterMs = Number.isFinite(wait) ? Math.max(0, wait) : 0;
  if (/UPDATE_NETWORK_OFFLINE/.test(message)) return { reason: "offline", retryable: false, retryAfterMs: 0 };
  if (status === 429) return { reason: "rate-limit", retryable: true, retryAfterMs };
  if (status === 408 || status === 504 || /ETIMEDOUT|ESOCKETTIMEDOUT|ERR_TIMED_OUT|timed?\s*out|timeout/i.test(message)) {
    return { reason: "timeout", retryable: true, retryAfterMs };
  }
  if (status >= 500 && status <= 599) return { reason: "service", retryable: true, retryAfterMs };
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ENETUNREACH|EHOSTUNREACH|ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|socket hang up/i.test(message)) {
    return { reason: "network", retryable: true, retryAfterMs };
  }
  return { reason: "unknown", retryable: false, retryAfterMs: 0 };
}
