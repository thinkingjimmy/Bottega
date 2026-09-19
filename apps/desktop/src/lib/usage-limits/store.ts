/**
 * [INPUT]: Depends on the passive quota bridge, revisioned snapshots and consumer demand identities.
 * [OUTPUT]: Provides one renderer quota store with paired demand ownership, bounded shared prefetch of missing or stale readings and a presentation-only expiry clock.
 * [POS]: Shared in-memory cache for Settings and all composer instances; never polls a provider.
 */
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../shared/agent-ipc";
import { emptyAgentLimits, quotaStale } from "../../../shared/usage-limits/projection";
import { LIMITS_TIMING, type AgentUsageLimits, type LimitsDemand, type UsageLimitsBridgeApi, type UsageLimitsSnapshot } from "../../../shared/usage-limits/types";
export type QuotaView = { snapshot: UsageLimitsSnapshot; now: number };
type Prefetch = { consumers: number; generation: number; stop: (remember?: boolean) => void };
export class UsageLimitsStore {
  private view: QuotaView;
  private listeners = new Set<() => void>();
  private consumers = new Map<string, LimitsDemand>();
  private unsubscribe?: () => void;
  private clock?: ReturnType<typeof setTimeout>;
  private connected = false;
  private epoch = 0;
  private prefetches = new Map<AgentBackendId, Prefetch>();
  private prefetched = new Map<AgentBackendId, number>();
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
  /* A reading seeded from the last launch is real data but not an answer: the warm-up runs
     for anything the main process would refresh anyway, and ends once a live one lands. */
  private fresh(agent: AgentUsageLimits) {
    return agent.receivedAt !== null && !quotaStale(agent, this.now());
  }
  prefetch(backends: readonly AgentBackendId[]) {
    const releases: (() => void)[] = [];
    if (!this.bridge()) return () => {};
    for (const backend of new Set(backends)) {
      let task = this.prefetches.get(backend);
      if (!task) {
        const agent = this.view.snapshot.agents.find((entry) => entry.backend === backend) ?? emptyAgentLimits(backend);
        if (this.fresh(agent) || agent.fetchState === "error" ||
          ["not-installed", "needs-auth", "unsupported"].includes(agent.availability) ||
          this.prefetched.get(backend) === agent.generation) continue;
        let stopped = false;
        let releaseSnapshot = () => {};
        let releaseDemand = () => {};
        /* Main-side singleflight and backoff bound the cost, so an unfinished warm-up is
           forgotten rather than remembered: the next composer mount may ask again. */
        const timer = setTimeout(() => task!.stop(false), LIMITS_TIMING.timeoutMs);
        task = { consumers: 0, generation: agent.generation, stop: (remember = true) => {
          if (stopped) return;
          stopped = true;
          if (remember) this.prefetched.set(backend, task!.generation);
          this.prefetches.delete(backend);
          clearTimeout(timer);
          releaseDemand();
          releaseSnapshot();
        } };
        this.prefetches.set(backend, task);
        releaseSnapshot = this.subscribe(() => {
          const current = this.view.snapshot.agents.find((entry) => entry.backend === backend);
          if (!current) return;
          task!.generation = current.generation;
          if (this.fresh(current) || current.fetchState === "error") task!.stop();
        });
        releaseDemand = this.demand(`quota:prefetch:${backend}`, "selector", [backend]);
      }
      const owned = task;
      owned.consumers++;
      releases.push(() => {
        // A route or StrictMode handoff may acquire the same read before releasing this owner.
        queueMicrotask(() => {
          if (--owned.consumers === 0 && this.prefetches.get(backend) === owned) owned.stop(false);
        });
      });
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const release of releases) release();
    };
  }
  refresh = async (backend?: AgentBackendId) => {
    const snapshot = await this.bridge()?.refresh(backend ? { backend } : {}).catch(() => undefined);
    if (snapshot) this.accept(snapshot);
  };
}
export const usageLimitsStore = new UsageLimitsStore(() => typeof window === "undefined" ? undefined : window.usage?.limits);
