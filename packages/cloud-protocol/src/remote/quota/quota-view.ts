/**
 * [INPUT]: Depends on the quota contract's types only (type imports erase at build).
 * [OUTPUT]: Provides LIMITS_TIMING and the pure quota readers: remainingPercent, quotaWindowExpired, quotaStale (drives refreshes only, never hides a reading), currentRemaining (a window past its reset reads as renewed), sortQuotaPools, generalQuotaWindows, generalRemaining, emptyAgentLimits.
 * [POS]: packages/cloud-protocol/src/remote/quota; Zod-free half of the quota contract (OPT-34 step 2a), so the Dock panel and composer badges read quotas without bundling the schemas; quota.ts re-exports everything here.
 */
import type { AgentQuotaPool, AgentQuotaWindow, AgentUsageLimits } from "./quota";

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
/* A window past its reset time has renewed: the provider started it over and main re-reads at that moment. Until that read
   lands, a fresh window is the best estimate there is; the number it had before always understated what is left now. */
export function currentRemaining(window: AgentQuotaWindow, now: number) {
  return quotaWindowExpired(window, now) ? 100 : remainingPercent(window.usedPercent);
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
