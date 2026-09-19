/**
 * [INPUT]: Depends on the registered Agent identity.
 * [OUTPUT]: Defines account quota snapshots, calendar-aware windows, native/API sources, consumer demand and the limits bridge.
 * [POS]: Shared account quota contract, separate from local token history.
 */
import type { AgentBackendId } from "../agent-ipc";

import type { AgentUsageLimits } from "@ai-chat/cloud-protocol/remote/quota";
export type { AgentQuotaWindow, AgentQuotaPool, AgentUsageLimits } from "@ai-chat/cloud-protocol/remote/quota";
export type QuotaAvailability = AgentUsageLimits["availability"];
export type QuotaReason = NonNullable<AgentUsageLimits["reasonCode"]>;
export type QuotaSource = NonNullable<AgentUsageLimits["source"]>;
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
export { LIMITS_TIMING } from "@ai-chat/cloud-protocol/remote/quota";
