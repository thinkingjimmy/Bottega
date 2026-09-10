/**
 * [INPUT]: Depends on the passive quota bridge, revisioned snapshots and consumer demand identities.
 * [OUTPUT]: Provides one renderer quota store with paired demand ownership and a presentation-only expiry clock.
 * [POS]: Shared in-memory cache for Settings and all composer instances; never polls a provider.
 */
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../shared/agent-ipc";
import { emptyAgentLimits } from "../../../shared/usage-limits/projection";
import { LIMITS_TIMING, type LimitsDemand, type UsageLimitsBridgeApi, type UsageLimitsSnapshot } from "../../../shared/usage-limits/types";
export type QuotaView = { snapshot: UsageLimitsSnapshot; now: number };
export class UsageLimitsStore {
  private view: QuotaView;
  private listeners = new Set<() => void>();
  private consumers = new Map<string, LimitsDemand>();
  private unsubscribe?: () => void;
  private clock?: ReturnType<typeof setTimeout>;
  private connected = false;
  private epoch = 0;
  constructor(private readonly bridge: () => UsageLimitsBridgeApi | undefined, private readonly now = Date.now) {
    this.view = { snapshot: { revision: -1, agents: AGENT_BACKEND_ORDER.map(emptyAgentLimits) }, now: now() };
  }
  getSnapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    this.connect(); this.armClock();
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.unsubscribe?.(); this.unsubscribe = undefined; this.connected = false; this.epoch++;
        if (this.clock) clearTimeout(this.clock);
      }
    };
  };
  private connect() {
    if (this.connected) return;
    const api = this.bridge();
    if (!api) return;
    this.connected = true;
    const epoch = ++this.epoch;
    const accept = (snapshot: UsageLimitsSnapshot) => { if (epoch === this.epoch) this.accept(snapshot); };
    this.unsubscribe = api.onChanged(accept);
    void api.getSnapshot().then(accept, () => undefined);
  }
  private accept(snapshot: UsageLimitsSnapshot) {
    if (snapshot.revision < this.view.snapshot.revision) return;
    this.view = { snapshot, now: this.now() };
    for (const listener of this.listeners) listener();
    this.armClock();
  }
  private armClock() {
    if (this.clock) clearTimeout(this.clock);
    if (!this.listeners.size) return;
    const now = this.now();
    const times = this.view.snapshot.agents.flatMap((agent) => [
      ...(agent.receivedAt === null ? [] : [agent.receivedAt + LIMITS_TIMING.staleMs]),
      ...(agent.lastAttemptAt === null ? [] : [agent.lastAttemptAt + LIMITS_TIMING.manualMs]),
      ...(agent.nextRetryAt === null ? [] : [agent.nextRetryAt]),
      ...agent.pools.flatMap((pool) => pool.windows.flatMap((window) => window.resetsAt === null ? [] : [window.resetsAt])),
    ]).filter((time) => time > now);
    if (times.length) this.clock = setTimeout(() => this.accept(this.view.snapshot), Math.min(2_147_483_647, Math.min(...times) - now));
  }
  demand(id: string, mode: LimitsDemand["mode"], backends: readonly AgentBackendId[]) {
    const demand: LimitsDemand = { id, mode, backends: [...backends], active: true };
    this.consumers.set(id, demand);
    const api = this.bridge();
    if (api) void api.setDemand(demand).then((snapshot) => this.accept(snapshot), () => undefined);
    return () => {
      // React can acquire the next surface in the same commit before releasing this one.
      queueMicrotask(() => {
        if (this.consumers.get(id) !== demand) return;
        this.consumers.delete(id);
        if (api) void api.setDemand({ ...demand, active: false }).then((snapshot) => this.accept(snapshot), () => undefined);
      });
    };
  }
  refresh = async (backend?: AgentBackendId) => {
    const snapshot = await this.bridge()?.refresh(backend ? { backend } : {}).catch(() => undefined);
    if (snapshot) this.accept(snapshot);
  };
}
export const usageLimitsStore = new UsageLimitsStore(() => typeof window === "undefined" ? undefined : window.usage?.limits);
