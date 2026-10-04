/**
 * [INPUT]: Depends on the shared quota DTO types only (type imports; no Node built-in, no zod).
 * [OUTPUT]: Provides QuotaReadResult, QuotaVerdictOrigin, QuotaReadError, quotaError, whenAborted and object — the quota readers'
 *           finite errors and response guards.
 * [POS]: The pure leaf of the quota readers (TASK-13 B2): the Codex and Claude exchanges run inside a pinned Provider bridge module,
 *        which may require nothing, so everything they reach is built from this file, protocol.ts, exchange.ts and ../normalization.ts.
 *        common.ts re-exports it beside main's workspace half.
 */
import type { AgentQuotaPool, QuotaReason, QuotaSource } from "../../../../shared/usage-limits/types";

export type QuotaReadResult = { source: QuotaSource; pools: AgentQuotaPool[]; planLabel: string | null; receivedAt: number };
/** `runtime`: taken from the registry's snapshot, so a change to it re-keys the source. `read`: the provider said so. */
export type QuotaVerdictOrigin = "read" | "runtime";
export class QuotaReadError extends Error {
  constructor(readonly reason: QuotaReason, readonly retryAfterMs?: number, readonly origin: QuotaVerdictOrigin = "read") { super(reason); }
}
export function quotaError(cause: unknown): QuotaReadError {
  if (cause instanceof QuotaReadError) return cause;
  /* A Provider turned off in Plugins & Apps is refused at admission: a settled verdict, not a failure to retry every minute. */
  if ((cause as { code?: unknown } | null)?.code === "plugin-disabled") return new QuotaReadError("unsupported", undefined, "runtime");
  return new QuotaReadError("unavailable");
}
/* A read may be cancelled without the channel being closed, so the caller's signal is raced
   rather than wired into the process: only the pool decides that the process goes. */
export function whenAborted(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) reject(signal.reason);
    else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new QuotaReadError("invalid-response");
  return value as Record<string, unknown>;
}
