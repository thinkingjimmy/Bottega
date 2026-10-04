/**
 * [INPUT]: Depends on the registered Agent identity.
 * [OUTPUT]: Defines account quota snapshots, calendar-aware windows, native/API sources, consumer demand and the limits bridge (including the route-config reveal).
 * [POS]: Shared account quota contract, separate from local token history.
 */
import type { AgentBackendId } from "../ipc/agent/agent-ipc";

import type { AgentUsageLimits } from "@ai-chat/cloud-protocol/remote/quota";
export type { AgentQuotaWindow, AgentQuotaPool, AgentUsageLimits } from "@ai-chat/cloud-protocol/remote/quota";
export type QuotaReason = NonNullable<AgentUsageLimits["reasonCode"]>;
export type QuotaSource = NonNullable<AgentUsageLimits["source"]>;
export type UsageLimitsSnapshot = { revision: number; agents: AgentUsageLimits[] };
/** `backends` absent: every Provider with quota, as main decides; an id main does not read quota for is left out there. */
export type LimitsDemand = { id: string; active: boolean; mode: "settings" | "selector" | "prefetch"; backends?: AgentBackendId[] };
export type LimitsRefresh = { backend?: AgentBackendId };
export type UsageLimitsBridgeApi = {
  getSnapshot(): Promise<UsageLimitsSnapshot>;
  setDemand(demand: LimitsDemand): Promise<UsageLimitsSnapshot>;
  refresh(request: LimitsRefresh): Promise<UsageLimitsSnapshot>;
  /** Shows the file that routes this Agent to a custom endpoint in Finder (Claude: ~/.claude/settings.json). */
  revealRouteConfig?(backend: AgentBackendId): Promise<void>;
  onChanged(callback: (snapshot: UsageLimitsSnapshot) => void): () => void;
};
export { LIMITS_CHANNEL } from "../ipc-channels/agent";
export { LIMITS_TIMING } from "@ai-chat/cloud-protocol/remote/quota-view";
