/**
 * [INPUT]: Registered Agent identities and bounded provider quota readings.
 * [OUTPUT]: Private quota snapshots with explicit missing, stale and reset semantics, and the separate read/completion time budgets.
 * [POS]: Shared native/remote quota contract; a reading never authorizes execution.
 */
import { z } from "zod";
import { agentBackendIdSchema } from "../chats/options";
const time = z.number().int().nonnegative().safe().nullable();
export const quotaWindowSchema = z.object({ id: z.string().min(1).max(256), windowDurationMins: z.number().positive().nullable(), calendarPeriod: z.literal("month").optional(),
  usedPercent: z.number().nonnegative().nullable(), resetsAt: time, receivedAt: time.unwrap(), sourceUpdatedAt: time }).strict();
export const quotaPoolSchema = z.object({ id: z.string().min(1).max(256), isGeneral: z.boolean(), label: z.string().max(256).nullable(), windows: z.array(quotaWindowSchema).max(16) }).strict();
export const agentUsageLimitsSchema = z.object({ backend: agentBackendIdSchema, generation: time.unwrap(), revision: time.unwrap(),
  availability: z.enum(["available", "not-installed", "needs-auth", "unsupported", "unavailable"]),
  source: z.enum(["codex-app-server", "claude-sdk-query", "kimi-local-api", "opencode-go-api"]).nullable(),
  fetchState: z.enum(["idle", "refreshing", "deferred", "error"]), planLabel: z.string().max(256).nullable(), pools: z.array(quotaPoolSchema).max(16),
  receivedAt: time, lastAttemptAt: time, nextRetryAt: time,
  reasonCode: z.enum(["not-installed", "needs-auth", "unsupported", "unavailable", "timeout", "invalid-response", "startup-unavailable", "rate-limited", "busy"]).nullable(),
}).strict();
export type AgentQuotaWindow = z.infer<typeof quotaWindowSchema>;
export type AgentQuotaPool = z.infer<typeof quotaPoolSchema>;
export type AgentUsageLimits = z.infer<typeof agentUsageLimitsSchema>;
/* Two different budgets: readMs caps a request the provider has actually received (a logged-in
   Claude read idles at 6.5-11s, so 15s was a coin flip under load), while timeoutMs is how long
   a closed surface still owes a read it started. Waiting for discovery or admission spends
   neither, and channelIdleMs is how long a warm reader process outlives its last consumer. */
export const LIMITS_TIMING = { refreshMs: 5 * 60_000, staleMs: 10 * 60_000, manualMs: 30_000, readMs: 30_000, timeoutMs: 15_000, channelIdleMs: 5 * 60_000, retryMs: [60_000, 120_000, 300_000] } as const;

export function remainingPercent(used: number | null): number | null {
  return used !== null && Number.isFinite(used) && used >= 0 ? Math.max(0, 100 - used) : null;
}
export function quotaWindowExpired(window: AgentQuotaWindow, now: number) {
  return window.resetsAt !== null && window.resetsAt <= now;
}
export function quotaStale(agent: AgentUsageLimits, now: number) {
  return agent.receivedAt !== null && now - agent.receivedAt >= LIMITS_TIMING.staleMs;
}
export function currentRemaining(window: AgentQuotaWindow, now: number) {
  return quotaWindowExpired(window, now) ? null : remainingPercent(window.usedPercent);
}
export function sortQuotaPools(pools: AgentQuotaPool[]): AgentQuotaPool[] {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  return pools.map((pool) => ({ ...pool, windows: [...pool.windows].sort((a, b) =>
    (a.windowDurationMins ?? Infinity) - (b.windowDurationMins ?? Infinity) || compare(a.id, b.id))
  })).sort((a, b) => Number(b.isGeneral) - Number(a.isGeneral) || compare(a.id, b.id));
}
export function generalQuotaWindows(agent: AgentUsageLimits) {
  return sortQuotaPools(agent.pools).find((pool) => pool.isGeneral)?.windows ?? [];
}
/* One number for the whole agent, for a tab or a badge. It reads the general pool only --
   percentages never aggregate across pools -- and within it reports the tightest window,
   because that is the one that stops the next turn. */
export function generalRemaining(agent: AgentUsageLimits, now: number): number | null {
  const values = generalQuotaWindows(agent)
    .map((window) => currentRemaining(window, now))
    .filter((value): value is number => value !== null);
  return values.length ? Math.min(...values) : null;
}
export function emptyAgentLimits(backend: AgentUsageLimits["backend"]): AgentUsageLimits {
  return { backend, generation: 0, revision: 0, availability: "unavailable",
    source: null, fetchState: "idle", planLabel: null, pools: [], receivedAt: null,
    lastAttemptAt: null, nextRetryAt: null, reasonCode: null };
}
