/**
 * [INPUT]: Depends on the registered Agent identity.
 * [OUTPUT]: Defines account quota snapshots, window identity, consumer demand and the limits bridge.
 * [POS]: Shared account quota contract, separate from local token history.
 */
import type { AgentBackendId } from "../agent-ipc";

export type AgentQuotaWindow = {
  id: string;
  windowDurationMins: number | null;
  usedPercent: number | null;
  resetsAt: number | null;
  receivedAt: number;
  sourceUpdatedAt: number | null;
};
export type AgentQuotaPool = {
  id: string;
  isGeneral: boolean;
  label: string | null;
  windows: AgentQuotaWindow[];
};
export type QuotaAvailability = "available" | "not-installed" | "needs-auth" | "unsupported" | "unavailable";
export type QuotaReason = "not-installed" | "needs-auth" | "unsupported" | "unavailable" | "timeout" | "invalid-response" | "startup-unavailable" | "rate-limited" | "busy";
export type QuotaSource = "codex-app-server" | "claude-sdk-query" | "kimi-local-api";
export type AgentUsageLimits = {
  backend: AgentBackendId;
  generation: number;
  revision: number;
  availability: QuotaAvailability;
  source: QuotaSource | null;
  fetchState: "idle" | "refreshing" | "deferred" | "error";
  planLabel: string | null;
  pools: AgentQuotaPool[];
  receivedAt: number | null;
  lastAttemptAt: number | null;
  nextRetryAt: number | null;
  reasonCode: QuotaReason | null;
};
export type UsageLimitsSnapshot = { revision: number; agents: AgentUsageLimits[] };
export type LimitsDemand = { id: string; active: boolean; mode: "settings" | "selector"; backends: AgentBackendId[] };
export type LimitsRefresh = { backend?: AgentBackendId };
export type UsageLimitsBridgeApi = {
  getSnapshot(): Promise<UsageLimitsSnapshot>;
  setDemand(demand: LimitsDemand): Promise<UsageLimitsSnapshot>;
  refresh(request: LimitsRefresh): Promise<UsageLimitsSnapshot>;
  onChanged(callback: (snapshot: UsageLimitsSnapshot) => void): () => void;
};
export const LIMITS_CHANNEL = {
  snapshot: "usage:limits:snapshot",
  demand: "usage:limits:demand",
  refresh: "usage:limits:refresh",
  changed: "usage:limits:changed",
} as const;
export const LIMITS_TIMING = {
  refreshMs: 5 * 60_000,
  staleMs: 10 * 60_000,
  manualMs: 30_000,
  timeoutMs: 15_000,
  retryMs: [60_000, 120_000, 300_000],
} as const;
