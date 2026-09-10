/**
 * [INPUT]: Depends on native quota source ports, the existing process admission owner and bounded consumer demand.
 * [OUTPUT]: Owns quota snapshots, singleflight, identity fencing, refresh/reset scheduling, cancelled initial-read resumption and cleanup.
 * [POS]: The sole main-process quota fact owner shared by Settings and composer menus.
 */
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../shared/agent-ipc";
import { emptyAgentLimits } from "../../../shared/usage-limits/projection";
import { LIMITS_TIMING, type AgentUsageLimits, type LimitsDemand, type LimitsRefresh, type UsageLimitsSnapshot } from "../../../shared/usage-limits/types";
import { agentQuotaBlocked, subscribeQuotaAdmission, tryAcquireAgentQuotaLease } from "../agent-process-supervisor";
import { quotaError } from "./readers/common";
import { nativeQuotaSource, type QuotaSourcePort } from "./source";

type Flight = { controller: AbortController; promise: Promise<void>; generation: number; timer?: ReturnType<typeof setTimeout> };
type Entry = { value: AgentUsageLimits; identity?: string; flight?: Flight; failures: number; resetAttempts: Set<string>; manualAt: number | null; pending: boolean };
export type QuotaServiceOptions = {
  source?: QuotaSourcePort;
  now?: () => number;
  blocked?: typeof agentQuotaBlocked;
  acquire?: typeof tryAcquireAgentQuotaLease;
  subscribeAdmission?: typeof subscribeQuotaAdmission;
  schedule?: (action: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};
export class AgentUsageLimitsService {
  private readonly entries = new Map<AgentBackendId, Entry>(AGENT_BACKEND_ORDER.map((backend) => [backend, {
    value: emptyAgentLimits(backend), failures: 0, resetAttempts: new Set(), manualAt: null, pending: false,
  }]));
  private readonly demands = new Map<string, LimitsDemand>();
  private readonly listeners = new Set<(value: UsageLimitsSnapshot) => void>();
  private readonly source: QuotaSourcePort;
  private readonly now: () => number;
  private readonly blocked: typeof agentQuotaBlocked;
  private readonly acquire: typeof tryAcquireAgentQuotaLease;
  private readonly schedule: NonNullable<QuotaServiceOptions["schedule"]>;
  private readonly cancelTimer: NonNullable<QuotaServiceOptions["cancelTimer"]>;
  private readonly releases: (() => void)[];
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private foreground = false;
  private closed = false;

  constructor(options: QuotaServiceOptions = {}) {
    this.source = options.source ?? nativeQuotaSource;
    this.now = options.now ?? Date.now;
    this.blocked = options.blocked ?? agentQuotaBlocked;
    this.acquire = options.acquire ?? tryAcquireAgentQuotaLease;
    this.schedule = options.schedule ?? ((action, delay) => { const timer = setTimeout(action, delay); timer.unref?.(); return timer; });
    this.cancelTimer = options.cancelTimer ?? clearTimeout;
    this.releases = [this.source.subscribe((backend) => this.invalidate(backend)),
      (options.subscribeAdmission ?? subscribeQuotaAdmission)((backend) => {
        if (this.entries.get(backend)?.value.fetchState === "deferred" && !this.blocked(backend)) this.reconcile();
      })];
  }
  snapshot(): UsageLimitsSnapshot {
    return { revision: this.revision, agents: AGENT_BACKEND_ORDER.map((backend) => this.entries.get(backend)!.value) };
  }
  subscribe(listener: (value: UsageLimitsSnapshot) => void) {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  private publish(entry: Entry, patch: Partial<AgentUsageLimits>) {
    entry.value = { ...entry.value, ...patch, revision: ++this.revision };
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
  private wanted(backend: AgentBackendId) {
    return !this.closed && this.foreground && [...this.demands.values()].some((demand) => demand.backends.includes(backend));
  }
  private polling(backend: AgentBackendId) {
    return this.wanted(backend) && [...this.demands.values()].some((demand) => demand.mode === "settings" && demand.backends.includes(backend));
  }
  setForeground(value: boolean) {
    if (this.foreground === value) return;
    this.foreground = value;
    this.reconcile(true);
  }
  setDemand(demand: LimitsDemand) {
    if (this.closed) return;
    if (demand.active) {
      if (!this.demands.has(demand.id) && this.demands.size >= 64) throw new Error("Too many quota consumers");
      this.demands.set(demand.id, demand);
    } else this.demands.delete(demand.id);
    this.reconcile(true);
  }
  clearDemands() { this.demands.clear(); this.reconcile(); }
  invalidate(backend: AgentBackendId) {
    const entry = this.entries.get(backend)!;
    entry.flight?.controller.abort("identity");
    entry.identity = undefined; entry.failures = 0; entry.manualAt = null; entry.pending = false; entry.resetAttempts.clear();
    this.publish(entry, { ...emptyAgentLimits(backend), generation: entry.value.generation + 1 });
    this.reconcile(true);
  }
  private resetKeys(entry: Entry, expiredOnly: boolean) {
    return entry.value.pools.flatMap((pool) => pool.windows.flatMap((window) =>
      window.resetsAt !== null && (!expiredOnly || window.resetsAt <= this.now())
        ? [`${pool.id}/${window.id}/${window.resetsAt}`] : []));
  }
  private needs(entry: Entry) {
    if (entry.value.backend === "opencode") return false;
    if (entry.value.nextRetryAt !== null && this.now() < entry.value.nextRetryAt) return false;
    // Cancelling an initial read did not populate the cache or satisfy its demand.
    if (entry.value.receivedAt === null && entry.value.fetchState === "idle") return true;
    if (entry.pending) return true;
    if (this.resetKeys(entry, true).some((key) => !entry.resetAttempts.has(key))) return true;
    const time = entry.value.receivedAt ?? entry.value.lastAttemptAt;
    return time === null || this.now() - time >= LIMITS_TIMING.refreshMs ||
      (entry.value.fetchState === "error" && entry.value.nextRetryAt !== null && this.now() >= entry.value.nextRetryAt);
  }
  private reconcile(open = false) {
    if (this.timer) this.cancelTimer(this.timer);
    this.timer = undefined;
    for (const [backend, entry] of this.entries) {
      if (!this.wanted(backend)) {
        entry.pending = false;
        entry.flight?.controller.abort("hidden");
        if (entry.value.fetchState === "deferred") this.publish(entry, { fetchState: "idle", reasonCode: null });
        continue;
      }
      if ((open || this.polling(backend) || entry.value.fetchState === "deferred" ||
        this.resetKeys(entry, true).some((key) => !entry.resetAttempts.has(key))) && this.needs(entry)) void this.start(backend);
    }
    this.armTimer();
  }
  private armTimer() {
    if (this.timer) this.cancelTimer(this.timer);
    this.timer = undefined;
    const times: number[] = [];
    for (const [backend, entry] of this.entries) {
      if (!this.wanted(backend) || backend === "opencode" || entry.flight || entry.value.fetchState === "deferred") continue;
      if (entry.value.availability === "not-installed" || entry.value.availability === "needs-auth" || entry.value.availability === "unsupported") continue;
      if (this.polling(backend)) times.push(Math.max(entry.value.nextRetryAt ?? 0,
        entry.value.fetchState === "error" ? this.now() + 1 : (entry.value.receivedAt ?? entry.value.lastAttemptAt ?? this.now()) + LIMITS_TIMING.refreshMs));
      for (const pool of entry.value.pools) for (const window of pool.windows) {
        if (window.resetsAt !== null && window.resetsAt > this.now()) times.push(Math.max(window.resetsAt, entry.value.nextRetryAt ?? 0));
      }
    }
    if (times.length) this.timer = this.schedule(() => { this.timer = undefined; this.reconcile(); }, Math.min(2_147_483_647, Math.max(1, Math.min(...times) - this.now())));
  }
  async refresh(request: LimitsRefresh = {}) {
    const backends = request.backend ? [request.backend] : AGENT_BACKEND_ORDER;
    await Promise.all(backends.map((backend) => this.start(backend, true)));
    return this.snapshot();
  }
  private start(backend: AgentBackendId, manual = false): Promise<void> {
    const entry = this.entries.get(backend)!;
    if (entry.flight) return entry.flight.promise;
    if (!this.wanted(backend) || backend === "opencode") return Promise.resolve();
    if (manual) {
      if (entry.value.nextRetryAt !== null && this.now() < entry.value.nextRetryAt) return Promise.resolve();
      if (entry.manualAt !== null && this.now() - entry.manualAt < LIMITS_TIMING.manualMs) return Promise.resolve();
      if (entry.value.lastAttemptAt !== null && this.now() - entry.value.lastAttemptAt < LIMITS_TIMING.manualMs) return Promise.resolve();
    } else if (!this.needs(entry)) return Promise.resolve();
    if (this.blocked(backend)) {
      entry.pending = true;
      if (entry.value.fetchState !== "deferred") this.publish(entry, { fetchState: "deferred", reasonCode: "busy" });
      return Promise.resolve();
    }
    if (manual) entry.manualAt = this.now();
    const controller = new AbortController();
    const generation = entry.value.generation;
    const flight: Flight = { controller, generation, promise: Promise.resolve() };
    entry.flight = flight;
    entry.pending = false;
    flight.timer = this.schedule(() => controller.abort("timeout"), LIMITS_TIMING.timeoutMs);
    controller.signal.addEventListener("abort", () => {
      if (entry.value.generation !== generation) return;
      if (controller.signal.reason === "timeout") this.fail(entry, { reason: "timeout" });
      else {
        entry.pending = this.wanted(backend);
        this.publish(entry, { fetchState: entry.pending ? "deferred" : "idle", reasonCode: entry.pending ? "busy" : null });
      }
    }, { once: true });
    flight.promise = Promise.resolve().then(() => this.read(entry, flight)).finally(() => {
      if (flight.timer) this.cancelTimer(flight.timer);
      if (entry.flight === flight) entry.flight = undefined;
      // Demand or identity may change before the cancelled process finishes cleanup.
      if ((entry.value.generation !== generation || controller.signal.reason === "hidden") && this.wanted(backend)) this.reconcile(true);
      else if (entry.value.fetchState === "deferred" && this.wanted(backend) && !this.blocked(backend)) this.reconcile();
      else this.armTimer();
    });
    this.publish(entry, { fetchState: "refreshing", reasonCode: null, lastAttemptAt: this.now() });
    return flight.promise;
  }
  private async read(entry: Entry, flight: Flight) {
    const backend = entry.value.backend, signal = flight.controller.signal;
    let lease: ReturnType<typeof tryAcquireAgentQuotaLease> = null;
    try {
      const target = await this.source.resolve(backend, signal);
      signal.throwIfAborted();
      if (entry.identity !== undefined && entry.identity !== target.identity) {
        this.invalidate(backend); return;
      }
      entry.identity = target.identity;
      lease = this.acquire(backend, () => flight.controller.abort("busy"));
      if (!lease) { entry.pending = true; this.publish(entry, { fetchState: "deferred", reasonCode: "busy" }); return; }
      if (!await this.source.confirm(backend, target, signal)) { this.invalidate(backend); return; }
      signal.throwIfAborted();
      for (const key of this.resetKeys(entry, true)) entry.resetAttempts.add(key);
      const result = await this.source.read(backend, target, signal);
      signal.throwIfAborted();
      if (!await this.source.confirm(backend, target, signal)) { this.invalidate(backend); return; }
      signal.throwIfAborted();
      if (entry.value.generation !== flight.generation) return;
      entry.failures = 0;
      entry.pending = false;
      this.publish(entry, { ...result, availability: "available", fetchState: "idle", reasonCode: null, nextRetryAt: null });
      entry.resetAttempts = new Set(this.resetKeys(entry, true));
    } catch (cause) {
      if (!signal.aborted && entry.value.generation === flight.generation) this.fail(entry, quotaError(cause));
    } finally { lease?.release(); }
  }
  private fail(entry: Entry, failure: { reason: AgentUsageLimits["reasonCode"]; retryAfterMs?: number }) {
    entry.pending = false;
    const terminal = failure.reason === "needs-auth" || failure.reason === "not-installed" || failure.reason === "unsupported";
    const delay = Math.max(LIMITS_TIMING.retryMs[Math.min(entry.failures++, LIMITS_TIMING.retryMs.length - 1)]!, failure.retryAfterMs ?? 0);
    this.publish(entry, { fetchState: "error", reasonCode: failure.reason,
      availability: terminal ? failure.reason as "needs-auth" | "not-installed" | "unsupported" : entry.value.pools.length ? "available" : "unavailable",
      nextRetryAt: this.now() + (terminal ? LIMITS_TIMING.refreshMs : delay),
      ...(terminal ? { pools: [], planLabel: null, source: null, receivedAt: null } : {}) });
  }
  async shutdown() {
    this.closed = true; this.demands.clear();
    if (this.timer) this.cancelTimer(this.timer);
    for (const release of this.releases) release();
    const flights = [...this.entries.values()].flatMap((entry) => entry.flight ? [entry.flight] : []);
    for (const flight of flights) flight.controller.abort("shutdown");
    await Promise.allSettled(flights.map((flight) => flight.promise));
    this.listeners.clear();
  }
}
