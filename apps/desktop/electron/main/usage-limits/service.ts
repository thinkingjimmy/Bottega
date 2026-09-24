/**
 * [INPUT]: Depends on native quota source ports, the existing process admission owner, an optional durable snapshot port and bounded consumer demand.
 * [OUTPUT]: Owns quota snapshots, singleflight, identity fencing, the read cap and the completion window owed to a closed surface, last-known seeding across launches, refresh/reset scheduling, warm-channel demand reporting and cleanup.
 * [POS]: The sole main-process quota fact owner shared by Settings, composer menus and the Dock; foreground and demand are scoped per surface.
 */
import { AGENT_BACKEND_ORDER, type AgentBackendId } from "../../../shared/agent-ipc";
import { emptyAgentLimits } from "../../../shared/usage-limits/projection";
import { LIMITS_TIMING, type AgentUsageLimits, type LimitsDemand, type LimitsRefresh, type UsageLimitsSnapshot } from "../../../shared/usage-limits/types";
import { agentQuotaBlocked, subscribeQuotaAdmission, tryAcquireAgentQuotaLease } from "../agent-process-supervisor";
import { quotaError } from "./readers/common";
import type { QuotaSnapshotPersistence } from "./snapshot-store";
import type { QuotaDemandState } from "./channel";
import { nativeQuotaSource, type QuotaSourcePort } from "./source";

/* A flight waits before it reads: runtime discovery, quota admission and identity
   confirmation are the supervisor's time, so only the read phase carries a deadline. */
type Flight = { controller: AbortController; promise: Promise<void>; generation: number; phase: "waiting" | "reading"; deadline: number; settled: boolean; timer?: ReturnType<typeof setTimeout> };
type Entry = { value: AgentUsageLimits; identity?: string; flight?: Flight; failures: number; resetAttempts: Set<string>; manualAt: number | null; pending: boolean; menu: boolean; completionUntil: number | null };
export type QuotaServiceOptions = {
  source?: QuotaSourcePort;
  persistence?: QuotaSnapshotPersistence;
  now?: () => number;
  blocked?: typeof agentQuotaBlocked;
  acquire?: typeof tryAcquireAgentQuotaLease;
  subscribeAdmission?: typeof subscribeQuotaAdmission;
  schedule?: (action: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelTimer?: (timer: ReturnType<typeof setTimeout>) => void;
};
export class AgentUsageLimitsService {
  private readonly entries = new Map<AgentBackendId, Entry>(AGENT_BACKEND_ORDER.map((backend) => [backend, {
    value: emptyAgentLimits(backend), failures: 0, resetAttempts: new Set(), manualAt: null, pending: false, menu: false, completionUntil: null,
  }]));
  /* Demand and foreground are per surface (main window, Dock bar, Dock panel): one surface's
     reload, blur or teardown never clears another surface's consumers (DCK-19). */
  private readonly demands = new Map<string, { demand: LimitsDemand; surface: string }>();
  private readonly listeners = new Set<(value: UsageLimitsSnapshot) => void>();
  private readonly source: QuotaSourcePort;
  private readonly persistence?: QuotaSnapshotPersistence;
  private readonly now: () => number;
  private readonly blocked: typeof agentQuotaBlocked;
  private readonly acquire: typeof tryAcquireAgentQuotaLease;
  private readonly schedule: NonNullable<QuotaServiceOptions["schedule"]>;
  private readonly cancelTimer: NonNullable<QuotaServiceOptions["cancelTimer"]>;
  private readonly releases: (() => void)[];
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private readonly foregroundSurfaces = new Set<string>();
  private get foreground() { return this.foregroundSurfaces.size > 0; }
  private remoteDemand = false;
  private closed = false;

  constructor(options: QuotaServiceOptions = {}) {
    this.source = options.source ?? nativeQuotaSource;
    this.persistence = options.persistence;
    this.now = options.now ?? Date.now;
    this.blocked = options.blocked ?? agentQuotaBlocked;
    this.acquire = options.acquire ?? tryAcquireAgentQuotaLease;
    this.schedule = options.schedule ?? ((action, delay) => { const timer = setTimeout(action, delay); timer.unref?.(); return timer; });
    this.cancelTimer = options.cancelTimer ?? clearTimeout;
    this.releases = [this.source.subscribe((backend) => this.invalidate(backend)),
      (options.subscribeAdmission ?? subscribeQuotaAdmission)((backend) => {
        if (this.entries.get(backend)?.pending && !this.blocked(backend)) this.reconcile();
      })];
  }
  /* Seeds the last known numbers before the window exists, so a launch opens the selector
     on real values instead of an empty card. Anything the service has already touched wins:
     the read owns the entry from its first publish on. */
  async load() {
    const records = await (this.persistence?.load() ?? Promise.resolve([])).catch(() => []);
    for (const record of records) {
      const entry = this.entries.get(record.backend);
      if (!entry || entry.flight || entry.value.generation > 0 || entry.value.receivedAt !== null) continue;
      this.publish(entry, { pools: record.pools, planLabel: record.planLabel, source: record.source,
        receivedAt: record.receivedAt, availability: "available", fetchState: "idle", reasonCode: null });
    }
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
    return !this.closed && (this.remoteDemand || this.live().some((demand) => demand.backends.includes(backend)));
  }
  private completing(backend: AgentBackendId) {
    return !this.closed && this.foreground && (this.entries.get(backend)!.completionUntil ?? 0) > this.now();
  }
  private requested(backend: AgentBackendId) {
    return this.wanted(backend) || this.completing(backend);
  }
  private selector(backend: AgentBackendId) {
    return this.wanted(backend) && this.live().some((demand) => demand.mode === "selector" && demand.backends.includes(backend));
  }
  /* What a warm reader process is allowed to do: stay while someone is asking, start its idle
     clock when the last consumer lets go, and go now when the window is hidden, the account
     changed or the service is closing (09-18 PRD §4.5). */
  private channelState(backend: AgentBackendId): QuotaDemandState {
    if (this.requested(backend)) return "wanted";
    return this.closed || !(this.foreground || this.remoteDemand) ? "closed" : "released";
  }
  private polling(backend: AgentBackendId) {
    return this.wanted(backend) && (this.remoteDemand || this.live().some((demand) => demand.mode === "settings" && demand.backends.includes(backend)));
  }
  /** Demands whose owning surface is currently in the foreground. */
  private live() {
    return [...this.demands.values()].filter((entry) => this.foregroundSurfaces.has(entry.surface)).map((entry) => entry.demand);
  }
  setRemoteDemand(value: boolean) {
    if (this.remoteDemand === value) return;
    this.remoteDemand = value; this.reconcile(true);
  }
  setForeground(value: boolean, surface = "main") {
    if (this.foregroundSurfaces.has(surface) === value) return;
    if (value) this.foregroundSurfaces.add(surface); else this.foregroundSurfaces.delete(surface);
    this.reconcile(true);
  }
  setDemand(demand: LimitsDemand, surface = "main") {
    if (this.closed) return;
    const key = `${surface}\u0000${demand.id}`;
    if (demand.active) {
      if (!this.demands.has(key) && this.demands.size >= 64) throw new Error("Too many quota consumers");
      this.demands.set(key, { demand, surface });
    } else this.demands.delete(key);
    this.reconcile(true);
  }
  clearDemands(surface = "main") {
    for (const [key, entry] of this.demands) if (entry.surface === surface) this.demands.delete(key);
    // An explicit teardown is not a menu closing: nobody is owed a completion window.
    for (const entry of this.entries.values()) { entry.completionUntil = null; entry.menu = false; }
    this.reconcile();
  }
  invalidate(backend: AgentBackendId) {
    const entry = this.entries.get(backend)!;
    entry.completionUntil = null;
    entry.flight?.controller.abort("identity");
    void this.source.demand?.(backend, "closed");
    /* Discovery finishing re-keys every backend once per launch, which is not an account
       change: until a read has observed an identity, a reading seeded from the last launch
       belongs to no account this process has seen and survives, stale clock and all. Once one
       was observed the account may have changed, so the numbers and the cache both go. */
    const observed = entry.identity !== undefined;
    entry.identity = undefined; entry.failures = 0; entry.manualAt = null; entry.pending = false; entry.resetAttempts.clear();
    if (observed) this.forget(backend);
    this.publish(entry, observed || entry.value.receivedAt === null
      ? { ...emptyAgentLimits(backend), generation: entry.value.generation + 1 }
      : { generation: entry.value.generation + 1, fetchState: "idle", reasonCode: null, nextRetryAt: null, lastAttemptAt: null });
    this.reconcile(true);
  }
  private resetKeys(entry: Entry, expiredOnly: boolean) {
    return entry.value.pools.flatMap((pool) => pool.windows.flatMap((window) =>
      window.resetsAt !== null && (!expiredOnly || window.resetsAt <= this.now())
        ? [`${pool.id}/${window.id}/${window.resetsAt}`] : []));
  }
  private needs(entry: Entry) {
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
      const menu = this.selector(backend);
      if (!this.foreground || this.closed) { entry.completionUntil = null; entry.menu = false; }
      // Nothing shortens a read someone is still waiting for; only its own cap applies.
      else if (menu) { entry.completionUntil = null; entry.menu = true; }
      else if (entry.menu) { entry.menu = false; this.owe(entry, backend); }
      if (entry.completionUntil !== null && entry.completionUntil <= this.now()) {
        /* The window closing is the consumer giving up, never the provider failing: only the
           read cap in beginRead() can call that a timeout. */
        entry.flight?.controller.abort("expired");
        this.expire(entry, backend);
      }
      void this.source.demand?.(backend, this.channelState(backend));
      if (!this.requested(backend)) {
        entry.pending = false;
        entry.flight?.controller.abort("hidden");
        if (entry.value.fetchState === "deferred") this.publish(entry, { fetchState: "idle", reasonCode: null });
        continue;
      }
      if ((open || this.polling(backend) || entry.pending ||
        this.resetKeys(entry, true).some((key) => !entry.resetAttempts.has(key))) && this.needs(entry)) void this.start(backend);
    }
    this.armTimer();
  }
  /* What a closing menu leaves behind: a started read keeps 15 seconds to land, a deferred
     intent keeps the same window to be admitted once, and a flight still waiting on discovery
     is dropped -- nothing is owed to a read that never reached the provider. */
  private owe(entry: Entry, backend: AgentBackendId) {
    if (entry.completionUntil !== null) return;
    const flight = entry.flight && !entry.flight.settled && !entry.flight.controller.signal.aborted ? entry.flight : undefined;
    if (flight?.phase === "reading") entry.completionUntil = Math.min(this.now() + LIMITS_TIMING.timeoutMs, flight.deadline);
    else if (!flight && entry.pending) entry.completionUntil = this.now() + LIMITS_TIMING.timeoutMs;
    else if (flight) { flight.controller.abort("expired"); this.expire(entry, backend); }
  }
  /* Waiting for admission is the supervisor's time, not the read's: a completion budget
     that ran out before a read was ever started reports no attempt at all -- no failure
     count, no 60/120/300s backoff -- so the next demand queries immediately. The deferred
     intent itself survives whenever a consumer is still asking for this Agent. */
  private expire(entry: Entry, backend: AgentBackendId) {
    entry.completionUntil = null;
    entry.pending = this.requested(backend);
    if (entry.value.fetchState !== "idle" || entry.value.reasonCode !== null) this.publish(entry, { fetchState: "idle", reasonCode: null });
  }
  private armTimer() {
    if (this.timer) this.cancelTimer(this.timer);
    this.timer = undefined;
    const times: number[] = [];
    for (const [backend, entry] of this.entries) {
      if (entry.completionUntil !== null) times.push(entry.completionUntil);
      // A deferred intent waits for an admission notification; it must never poll for one.
      if (!this.wanted(backend) || entry.flight || entry.pending) continue;
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
    if (!this.requested(backend)) return Promise.resolve();
    if (manual) {
      if (entry.value.nextRetryAt !== null && this.now() < entry.value.nextRetryAt) return Promise.resolve();
      if (entry.manualAt !== null && this.now() - entry.manualAt < LIMITS_TIMING.manualMs) return Promise.resolve();
      if (entry.value.lastAttemptAt !== null && this.now() - entry.value.lastAttemptAt < LIMITS_TIMING.manualMs) return Promise.resolve();
    } else if (!this.needs(entry)) return Promise.resolve();
    if (this.blocked(backend)) {
      entry.pending = true;
      if (entry.value.fetchState !== "deferred") this.publish(entry, { fetchState: "deferred", reasonCode: "busy" });
      this.armTimer();
      return Promise.resolve();
    }
    if (manual) entry.manualAt = this.now();
    const controller = new AbortController();
    const generation = entry.value.generation;
    const flight: Flight = { controller, generation, phase: "waiting", deadline: Infinity, settled: false, promise: Promise.resolve() };
    entry.flight = flight;
    entry.pending = false;
    controller.signal.addEventListener("abort", () => {
      if (entry.value.generation !== generation || flight.settled) return;
      if (controller.signal.reason === "timeout") this.fail(entry, { reason: "timeout" });
      // "expired" spent the menu's budget, not the read's: expire() owns that publication.
      else if (controller.signal.reason !== "expired") {
        entry.pending = this.requested(backend);
        this.publish(entry, { fetchState: entry.pending ? "deferred" : "idle", reasonCode: entry.pending ? "busy" : null });
      }
    }, { once: true });
    flight.promise = Promise.resolve().then(() => this.read(entry, flight)).finally(() => {
      if (flight.timer) this.cancelTimer(flight.timer);
      if (entry.flight === flight) entry.flight = undefined;
      // Demand or identity may change before the cancelled process finishes cleanup.
      if ((entry.value.generation !== generation || controller.signal.reason === "hidden") && this.wanted(backend)) this.reconcile(true);
      else if (entry.pending && this.requested(backend) && !this.blocked(backend)) this.reconcile();
      else this.armTimer();
    });
    this.publish(entry, { fetchState: "refreshing", reasonCode: null, lastAttemptAt: this.now() });
    return flight.promise;
  }
  /* The clock starts at the request the provider actually receives; everything before this
     point was waiting. A closed surface can still cut it short, but only as a cancellation. */
  private beginRead(flight: Flight) {
    flight.phase = "reading";
    flight.deadline = this.now() + LIMITS_TIMING.readMs;
    flight.timer = this.schedule(() => flight.controller.abort("timeout"), Math.max(0, flight.deadline - this.now()));
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
      this.beginRead(flight);
      for (const key of this.resetKeys(entry, true)) entry.resetAttempts.add(key);
      const result = await this.source.read(backend, target, signal);
      signal.throwIfAborted();
      if (!await this.source.confirm(backend, target, signal)) { this.invalidate(backend); return; }
      signal.throwIfAborted();
      if (entry.value.generation !== flight.generation) return;
      entry.failures = 0;
      entry.pending = false;
      entry.completionUntil = null;
      flight.settled = true;
      this.publish(entry, { ...result, availability: "available", fetchState: "idle", reasonCode: null, nextRetryAt: null });
      this.remember(entry);
      entry.resetAttempts = new Set(this.resetKeys(entry, true));
    } catch (cause) {
      if (!signal.aborted && entry.value.generation === flight.generation) this.fail(entry, quotaError(cause));
    } finally { lease?.release(); }
  }
  private fail(entry: Entry, failure: { reason: AgentUsageLimits["reasonCode"]; retryAfterMs?: number }) {
    entry.pending = false;
    entry.completionUntil = null;
    if (entry.flight) entry.flight.settled = true;
    const terminal = failure.reason === "needs-auth" || failure.reason === "not-installed" || failure.reason === "unsupported";
    /* Reason codes only, never reader diagnostics, identities or paths: a quota blackout has
       to be visible in the main log, and the phase says whether the provider ever answered. */
    console.warn("[usage-limits:%s] quota read failed: %s%s", entry.value.backend, failure.reason,
      entry.flight ? ` (${entry.flight.phase})` : "");
    if (terminal) this.forget(entry.value.backend);
    const delay = Math.max(LIMITS_TIMING.retryMs[Math.min(entry.failures++, LIMITS_TIMING.retryMs.length - 1)]!, failure.retryAfterMs ?? 0);
    this.publish(entry, { fetchState: "error", reasonCode: failure.reason,
      availability: terminal ? failure.reason as "needs-auth" | "not-installed" | "unsupported" : entry.value.pools.length ? "available" : "unavailable",
      nextRetryAt: this.now() + (terminal ? LIMITS_TIMING.refreshMs : delay),
      ...(terminal ? { pools: [], planLabel: null, source: null, receivedAt: null } : {}) });
  }
  /* Persistence is a cache, never a fact: a failed write only costs the next launch its
     seed, so it can neither fail a read nor delay a publication. */
  private remember(entry: Entry) {
    const { backend, pools, planLabel, source, receivedAt } = entry.value;
    if (!this.persistence || source === null || receivedAt === null) return;
    void this.persistence.save({ backend, pools, planLabel, source, receivedAt }).catch(() => undefined);
  }
  private forget(backend: AgentBackendId) {
    void this.persistence?.clear(backend).catch(() => undefined);
  }
  async shutdown() {
    this.closed = true; this.demands.clear();
    for (const entry of this.entries.values()) { entry.completionUntil = null; entry.menu = false; }
    if (this.timer) this.cancelTimer(this.timer);
    for (const release of this.releases) release();
    const flights = [...this.entries.values()].flatMap((entry) => entry.flight ? [entry.flight] : []);
    for (const flight of flights) flight.controller.abort("shutdown");
    await Promise.allSettled(flights.map((flight) => flight.promise));
    // No reader process outlives the service: a cancelled read closes its own channel, this closes the parked ones.
    await Promise.allSettled(AGENT_BACKEND_ORDER.map((backend) => this.source.demand?.(backend, "closed")));
    this.listeners.clear();
  }
}
