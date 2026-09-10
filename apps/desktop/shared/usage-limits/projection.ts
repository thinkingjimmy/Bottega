/**
 * [INPUT]: Depends on quota DTOs and timing constants.
 * [OUTPUT]: Projects remaining percentages, reset status, staleness and stable pool/window order.
 * [POS]: Pure quota rules shared by scheduling and both renderer surfaces.
 */
import { LIMITS_TIMING, type AgentQuotaPool, type AgentQuotaWindow, type AgentUsageLimits } from "./types";

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
  return sortQuotaPools(agent.pools).find((pool) => pool.isGeneral)?.windows.slice(0, 2) ?? [];
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
  return { backend, generation: 0, revision: 0, availability: backend === "opencode" ? "unsupported" : "unavailable",
    source: null, fetchState: "idle", planLabel: null, pools: [], receivedAt: null,
    lastAttemptAt: null, nextRetryAt: null, reasonCode: backend === "opencode" ? "unsupported" : null };
}
