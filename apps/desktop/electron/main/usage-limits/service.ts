/**
 * [INPUT]: Depends on native quota source ports, process admission, durable snapshots, power lifecycle and bounded consumer demand.
 * [OUTPUT]: Owns quota snapshots, singleflight, identity fencing (a re-key under the same account fingerprint keeps the reading and re-reads), a deferred read that survives the retry backoff, a 5-second first retry after a transient failure, the read cap and the completion window owed to a closed surface, last-known seeding across launches, refresh/reset scheduling, idempotent surface demand, warm-channel demand reporting, blocker-transition traces and warnings for read failures, one read re-owed by a recheck after a terminal verdict the quota read reached itself, manual reads bound only by their minimum and a server retry-after, and cleanup.
 * [POS]: The sole main-process quota owner; application residency survives renderer teardown, shares every read with Settings/composer/Dock, and stops after three consecutive failures until a lifecycle or user wake.
 */
import type { AgentBackendId } from "../../../shared/ipc/agent/agent-ipc";
import { quotaProviders } from "../backends";
import { emptyAgentLimits } from "../../../shared/usage-limits/projection";
import { LIMITS_TIMING, type AgentUsageLimits, type LimitsDemand, type UsageLimitsSnapshot } from "../../../shared/usage-limits/types";
import { agentQuotaBlocked, agentQuotaBlockers, subscribeQuotaAdmission, tryAcquireAgentQuotaLease } from "../agent-process-supervisor";
import { quotaError, type QuotaVerdictOrigin } from "./readers/common";
import type { QuotaSnapshotPersistence } from "./snapshot-store";
import { PREFETCH_IDLE_MS, type QuotaDemandState } from "./channel";
import { nativeQuotaSource, type QuotaSourcePort } from "./source";

/* A flight waits before it reads: runtime discovery, quota admission and identity
   confirmation are the supervisor's time, so only the read phase carries a deadline. */
type Flight = { controller: AbortController; promise: Promise<void>; generation: number; phase: "waiting" | "reading"; deadline: number; settled: boolean; timer?: ReturnType<typeof setTimeout> };
type Entry = { value: AgentUsageLimits; interactive: boolean; identity?: string; flight?: Flight; failures: number; resetAttempts: Set<string>; manualAt: number | null; pending: boolean; menu: boolean; completionUntil: number | null;
  /** The last reported blockers for this deferred intent; repeated demand is not a transition. */
  blockedBy?: string;
  /** A server-issued retry-after: the one wait a manual Refresh honours beyond its own minimum. */
  serverRetryUntil: number | null;
  /** A recheck after a terminal verdict owes one read, whatever the backoff says. */
  recheckOwed: boolean;
  /** Where the current terminal verdict came from; only a `read` verdict is invisible to the registry. */
  verdictOrigin: QuotaVerdictOrigin | null;
  /** The account fingerprint when the reading on screen arrived; a re-key under the same one keeps that reading. */
  account?: string | null };
export type QuotaServiceOptions = {
  source?: QuotaSourcePort;
  /** The Providers with quota, in the order shown; by default every catalog entry whose descriptor has a quota hook. */
  providers?: readonly AgentBackendId[];
  persistence?: QuotaSnapshotPersistence;
  now?: () => number;
  blocked?: typeof agentQuotaBlocked;
  acquire?: typeof tryAcquireAgentQuotaLease;
  subscribeAdmission?: typeof subscribeQuotaAdmission;
  schedule?: (action: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancelTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  blockers?: typeof agentQuotaBlockers;
  /** One application-owned subscription; window teardown must not end resident caching. */
  subscribeSuspension?: (listener: (suspended: boolean) => void) => () => void;
  /** The transitions that decide whether a read happens, by name and reason only; the main log by default. */
  trace?: (backend: AgentBackendId | "*", event: string) => void;
};
/** The surface a remote refresh (R-32) holds its short demand on; it is foreground only while such a demand exists. */
const REMOTE_SURFACE = "remote-refresh";
/* A first "unavailable" (the bridge hiccuped, the CLI refreshed a token mid-read) is usually gone within seconds; a timeout
   keeps the normal backoff, since another 30-second read right away would only press a slow provider harder. */
const FIRST_RETRY_MS = 5_000;
const AUTOMATIC_FAILURE_LIMIT = 3;
export class AgentUsageLimitsService {
  private readonly providers: readonly AgentBackendId[];
  private readonly entries: Map<AgentBackendId, Entry>;
  /* Demand and foreground are per surface (main window, Dock bar, Dock panel): one surface's
     reload, blur or teardown never clears another surface's consumers (DCK-19). */
  private readonly demands = new Map<string, { demand: LimitsDemand & { backends: AgentBackendId[] }; surface: string }>();
  private remoteRefreshes = 0;
  private readonly listeners = new Set<(value: UsageLimitsSnapshot) => void>();
  private readonly source: QuotaSourcePort;
  private readonly persistence?: QuotaSnapshotPersistence;
  private readonly now: () => number;
  private readonly blocked: typeof agentQuotaBlocked;
  private readonly acquire: typeof tryAcquireAgentQuotaLease;
  private readonly schedule: NonNullable<QuotaServiceOptions["schedule"]>;
  private readonly cancelTimer: NonNullable<QuotaServiceOptions["cancelTimer"]>;
  private readonly blockers: typeof agentQuotaBlockers;
  private readonly trace: NonNullable<QuotaServiceOptions["trace"]>;
  private readonly releases: (() => void)[];
  private timer?: ReturnType<typeof setTimeout>;
  private revision = 0;
  private readonly foregroundSurfaces = new Set<string>();
  private get foreground() { return this.foregroundSurfaces.size > 0; }
  private closed = false;
  private resident = false;
  private suspended = false;

  constructor(options: QuotaServiceOptions = {}) {
    // The built-in catalog is static; d4's dynamic catalog will need this list re-evaluated when Providers come and go.
    this.providers = options.providers ?? quotaProviders();
    this.entries = new Map(this.providers.map((backend) => [backend, {
      value: emptyAgentLimits(backend), interactive: false, failures: 0, resetAttempts: new Set(), manualAt: null, pending: false, menu: false, completionUntil: null,
      serverRetryUntil: null, recheckOwed: false, verdictOrigin: null,
    }]));
    this.source = options.source ?? nativeQuotaSource;
    this.persistence = options.persistence;
    this.now = options.now ?? Date.now;
    this.blocked = options.blocked ?? agentQuotaBlocked;
    this.acquire = options.acquire ?? tryAcquireAgentQuotaLease;
    this.schedule = options.schedule ?? ((action, delay) => { const timer = setTimeout(action, delay); timer.unref?.(); return timer; });
    this.cancelTimer = options.cancelTimer ?? clearTimeout;
    this.blockers = options.blockers ?? agentQuotaBlockers;
    this.trace = options.trace ?? ((backend, event) => console.info("[usage-limits:%s] %s", backend, event));
    this.releases = [this.source.subscribe((backend, kind) => kind === "recheck" ? this.recheck(backend) : this.invalidate(backend)),
      (options.subscribeAdmission ?? subscribeQuotaAdmission)((backend) => {
        const entry = this.entries.get(backend);
        if (!entry?.pending) return;
        if (this.blocked(backend)) this.defer(entry);
        else { this.trace(backend, "admission notice, resuming"); this.reconcile(); }
      })];
    if (options.subscribeSuspension) this.releases.push(options.subscribeSuspension(value => this.setSuspended(value)));
  }
  /** Called once after loading the last reading, independently of renderer lifetime. */
  startResident() {
    if (this.closed || this.resident) return;
    this.resident = true;
    this.reconcile(true);
  }
  setSuspended(value: boolean) {
    if (this.closed || this.suspended === value) return;
    this.suspended = value;
    if (!value) this.wake();
    this.reconcile(true);
  }
  private wake() {
    for (const entry of this.entries.values()) {
      if (entry.failures >= AUTOMATIC_FAILURE_LIMIT) entry.failures = 0;
    }
  }
  private residentDemand(backend: AgentBackendId) {
    const entry = this.entries.get(backend)!;
    return this.resident && !this.suspended && entry.failures < AUTOMATIC_FAILURE_LIMIT &&
      (entry.recheckOwed || !["not-installed", "needs-auth", "unsupported"].includes(entry.value.availability));
  }
  /* Seeds the last known numbers before the window exists, so a launch opens the selector
     on real values instead of an empty card. Anything the service has already touched wins:
     the read owns the entry from its first publish on. */
  async load() {
    const records = await (this.persistence?.load() ?? Promise.resolve([])).catch(() => []);
    for (const record of records) {
      if (!this.known(record.backend)) continue; // a Provider this build does not read quota for
      const entry = this.entries.get(record.backend);
      if (!entry || entry.flight || entry.value.generation > 0 || entry.value.receivedAt !== null) continue;
      this.publish(entry, { pools: record.pools, planLabel: record.planLabel, source: record.source,
        receivedAt: record.receivedAt, availability: "available", fetchState: "idle", reasonCode: null });
    }
  }
  snapshot(): UsageLimitsSnapshot {
    return { revision: this.revision, agents: this.providers.map((backend) => this.entries.get(backend)!.value) };
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
    return !this.closed && !this.suspended && (this.residentDemand(backend) ||
      this.live().some((demand) => demand.backends.includes(backend)));
  }
  private completing(backend: AgentBackendId) {
    return !this.closed && this.foreground && (this.entries.get(backend)!.completionUntil ?? 0) > this.now();
  }
  private requested(backend: AgentBackendId) {
    return !this.suspended && (this.wanted(backend) || this.completing(backend));
  }
  private selector(backend: AgentBackendId) {
    return this.wanted(backend) && this.live().some((demand) => demand.mode === "selector" && demand.backends.includes(backend));
  }
  /* Application residency keeps one reader warm across surface closure. Sleep, terminal
     authentication verdicts and exhausted retries close it; interactive admission still preempts it. */
  private channelState(backend: AgentBackendId): QuotaDemandState {
    if (this.suspended || this.entries.get(backend)!.failures >= AUTOMATIC_FAILURE_LIMIT) return "closed";
    if (this.requested(backend)) return "wanted";
    return this.closed || !this.foreground ? "closed" : "released";
  }
  private polling(backend: AgentBackendId) {
    return this.residentDemand(backend) || this.wanted(backend) && this.live().some((demand) => demand.mode === "settings" && demand.backends.includes(backend));
  }
  /** Demands whose owning surface is currently in the foreground. */
  private live() {
    return [...this.demands.values()].filter((entry) => this.foregroundSurfaces.has(entry.surface)).map((entry) => entry.demand);
  }
  setForeground(value: boolean, surface = "main") {
    if (this.foregroundSurfaces.has(surface) === value) return;
    if (value) this.foregroundSurfaces.add(surface); else this.foregroundSurfaces.delete(surface);
    if (value) this.wake();
    this.trace("*", `foreground ${surface}=${value ? "on" : "off"}`);
    this.reconcile(true);
  }
  /** `backends` are plain bounded ids from IPC: narrowed here with known(), never cast. */
  setDemand(request: Omit<LimitsDemand, "backends"> & { backends?: readonly string[] }, surface = "main") {
    if (this.closed) return;
    /* No list means every Provider with quota; an id this service does not read is left out and logged, never thrown. */
    const unknown = request.backends?.filter((backend) => !this.known(backend)) ?? [];
    if (unknown.length) this.trace("*", `demand ${request.id}: no quota for ${unknown.join(", ")}`);
    const demand = { ...request, backends: request.backends ? [...new Set(request.backends.filter((backend) => this.known(backend)))] : [...this.providers] };
    const key = `${surface}\u0000${demand.id}`;
    const previous = this.demands.get(key)?.demand;
    // Dock snapshots and renderer updates reassert demand; only a changed subscription needs reconciliation.
    if (demand.active ? previous?.mode === demand.mode && previous.backends.length === demand.backends.length &&
      demand.backends.every(backend => previous.backends.includes(backend)) : !previous) return;
    if (demand.active) {
      if (!previous) this.wake();
      if (!previous && this.demands.size >= 64) throw new Error("Too many quota consumers");
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
       was observed, a file under the same account changing (Codex writing config.toml, a
       recheck) keeps the reading too and re-reads; only a different account fingerprint, or
       none (signed out, or a Provider that has none), clears the numbers and the cache. */
    const observed = entry.identity !== undefined;
    const account = this.source.account?.(backend) ?? null;
    const clear = observed && (account === null || entry.account !== account);
    this.trace(backend, `runtime re-keyed: ${clear ? "numbers cleared" : "reading kept"}${entry.flight ? ` (read ${entry.flight.phase})` : ""}`);
    entry.identity = undefined; entry.failures = 0; entry.manualAt = null; entry.pending = false; entry.resetAttempts.clear();
    entry.serverRetryUntil = null; entry.recheckOwed = false;
    if (clear) { this.forget(backend); entry.account = undefined; }
    this.publish(entry, clear || entry.value.receivedAt === null
      ? { ...emptyAgentLimits(backend), generation: entry.value.generation + 1 }
      : { generation: entry.value.generation + 1, fetchState: "idle", reasonCode: null, nextRetryAt: null, lastAttemptAt: null });
    this.reconcile(true);
  }
  /* A completed recheck that concluded the same facts changes nothing shown. Only a terminal quota verdict (needs-auth,
     unsupported) that the quota read reached itself -- a fact the registry's check cannot see -- is re-owed one read: the person
     rechecks because they fixed it. A healthy Agent ignores rechecks. */
  private recheck(backend: AgentBackendId) {
    const entry = this.entries.get(backend)!;
    if (entry.failures >= AUTOMATIC_FAILURE_LIMIT && !["needs-auth", "not-installed", "unsupported"].includes(entry.value.availability)) {
      entry.failures = 0;
      this.reconcile(true);
      return;
    }
    const availability = entry.value.availability;
    /* Only what the registry cannot see: its own verdicts (not installed, signed out, unsupported version) re-key when they change. */
    if ((availability !== "needs-auth" && availability !== "unsupported") || entry.verdictOrigin !== "read") return;
    if (entry.flight) return;
    this.trace(backend, `recheck after ${availability}: one read owed`);
    entry.failures = 0; entry.recheckOwed = true;
    this.publish(entry, { nextRetryAt: null });
    this.reconcile(true);
  }
  private resetKeys(entry: Entry, expiredOnly: boolean) {
    return entry.value.pools.flatMap((pool) => pool.windows.flatMap((window) =>
      window.resetsAt !== null && (!expiredOnly || window.resetsAt <= this.now())
        ? [`${pool.id}/${window.id}/${window.resetsAt}`] : []));
  }
  private needs(entry: Entry) {
    if (entry.recheckOwed) return true;
    if (entry.failures >= AUTOMATIC_FAILURE_LIMIT ||
      ["not-installed", "needs-auth", "unsupported"].includes(entry.value.availability)) return false;
    /* A deferred intent is a read someone asked for (a Refresh honoured the server's retry-after in start()); the backoff below
       must not strand it once the Agent frees up. */
    if (entry.pending) return true;
    if (entry.value.nextRetryAt !== null && this.now() < entry.value.nextRetryAt) return false;
    // Cancelling an initial read did not populate the cache or satisfy its demand.
    if (entry.value.receivedAt === null && entry.value.fetchState === "idle") return true;
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
      if (!this.foreground || this.closed || this.residentDemand(backend)) { entry.completionUntil = null; entry.menu = false; }
      // Nothing shortens a read someone is still waiting for; only its own cap applies.
      else if (menu) { entry.completionUntil = null; entry.menu = true; }
      else if (entry.menu) { entry.menu = false; this.owe(entry, backend); }
      if (entry.completionUntil !== null && entry.completionUntil <= this.now()) {
        /* The window closing is the consumer giving up, never the provider failing: only the
           read cap in beginRead() can call that a timeout. */
        entry.flight?.controller.abort("expired");
        this.expire(entry, backend);
      }
      const state = this.channelState(backend), asking = this.live().filter((demand) => demand.backends.includes(backend));
      /* A person asking keeps the reader for the interactive idle; a prefetch alone gets it back within 30 s (C-09). */
      if (asking.some((demand) => demand.mode !== "prefetch")) entry.interactive = true;
      else if (asking.length || state === "closed") entry.interactive = false;
      void this.source.demand?.(backend, state, entry.interactive ? LIMITS_TIMING.channelIdleMs : PREFETCH_IDLE_MS);
      if (!this.requested(backend)) {
        if (entry.pending) this.trace(backend, "deferred read withdrawn: nobody asking");
        entry.pending = false; entry.blockedBy = undefined;
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
      if (this.suspended || !this.wanted(backend) || entry.flight || entry.pending || entry.failures >= AUTOMATIC_FAILURE_LIMIT) continue;
      if (entry.value.availability === "not-installed" || entry.value.availability === "needs-auth" || entry.value.availability === "unsupported") continue;
      if (this.polling(backend)) times.push(Math.max(entry.value.nextRetryAt ?? 0,
        entry.value.fetchState === "error" ? this.now() + 1 : (entry.value.receivedAt ?? entry.value.lastAttemptAt ?? this.now()) + LIMITS_TIMING.refreshMs));
      for (const pool of entry.value.pools) for (const window of pool.windows) {
        if (window.resetsAt !== null && window.resetsAt > this.now()) times.push(Math.max(window.resetsAt, entry.value.nextRetryAt ?? 0));
      }
    }
    if (times.length) this.timer = this.schedule(() => { this.timer = undefined; this.reconcile(); }, Math.min(2_147_483_647, Math.max(1, Math.min(...times) - this.now())));
  }
  /**
   * A refresh another device asked for (P13 R-32): one read under a demand of its own surface, joining a read already running
   * and subject to the same manual throttle; the demand ends with the read.
   */
  /** Whether a Provider id names one this service reads (a remote refresh for anything else is refused). */
  known(provider: string): provider is AgentBackendId { return this.entries.has(provider as AgentBackendId); }
  async refreshRemote(backend: AgentBackendId) {
    const demand: LimitsDemand = { id: `remote:${backend}:${++this.remoteRefreshes}`, active: true, mode: "prefetch", backends: [backend] };
    this.setForeground(true, REMOTE_SURFACE);
    this.setDemand(demand, REMOTE_SURFACE);
    try { await this.refresh({ backend }); }
    finally {
      this.setDemand({ ...demand, active: false }, REMOTE_SURFACE);
      if (![...this.demands.values()].some(entry => entry.surface === REMOTE_SURFACE)) this.setForeground(false, REMOTE_SURFACE);
    }
  }
  async refresh(request: { backend?: string } = {}) {
    const backends = request.backend ? (this.known(request.backend) ? [request.backend] : []) : this.providers;
    await Promise.all(backends.map((backend) => this.start(backend, true)));
    return this.snapshot();
  }
  private defer(entry: Entry) {
    const backend = entry.value.backend, blockers = this.blockers(backend).join(", ");
    entry.pending = true;
    if (entry.blockedBy !== blockers) {
      entry.blockedBy = blockers;
      this.trace(backend, `deferred: ${blockers}`);
    }
    if (entry.value.fetchState !== "deferred") this.publish(entry, { fetchState: "deferred", reasonCode: "busy" });
  }
  private start(backend: AgentBackendId, manual = false): Promise<void> {
    const entry = this.entries.get(backend)!;
    if (entry.flight) return entry.flight.promise;
    if (!this.requested(backend)) return Promise.resolve();
    if (manual) {
      /* A person asking waits only the 30-second minimum and a server's retry-after, never the automatic backoff. */
      if (entry.serverRetryUntil !== null && this.now() < entry.serverRetryUntil) return Promise.resolve();
      if (entry.manualAt !== null && this.now() - entry.manualAt < LIMITS_TIMING.manualMs) return Promise.resolve();
      if (entry.value.lastAttemptAt !== null && this.now() - entry.value.lastAttemptAt < LIMITS_TIMING.manualMs) return Promise.resolve();
    } else if (!this.needs(entry)) return Promise.resolve();
    if (this.blocked(backend)) {
      this.defer(entry);
      this.armTimer();
      return Promise.resolve();
    }
    if (manual) entry.manualAt = this.now();
    const controller = new AbortController();
    const generation = entry.value.generation;
    const flight: Flight = { controller, generation, phase: "waiting", deadline: Infinity, settled: false, promise: Promise.resolve() };
    entry.flight = flight;
    entry.pending = false; entry.blockedBy = undefined;
    entry.recheckOwed = false;
    controller.signal.addEventListener("abort", () => {
      if (entry.value.generation !== generation || flight.settled) return;
      this.trace(backend, `read cancelled: ${String(controller.signal.reason)} (${flight.phase})`);
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
      /* Demand, focus or identity may change before the cancelled process finishes cleanup, and a reopen meanwhile only
         joined this flight: whatever cancelled it, a read someone still wants starts now, not at the next poll. */
      if (controller.signal.aborted && this.wanted(backend)) this.reconcile(true);
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
      if (!lease) { this.defer(entry); return; }
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
      entry.serverRetryUntil = null;
      entry.account = this.source.account?.(backend) ?? null;
      flight.settled = true;
      this.publish(entry, { ...result, availability: "available", fetchState: "idle", reasonCode: null, nextRetryAt: null });
      this.remember(entry);
      entry.resetAttempts = new Set(this.resetKeys(entry, true));
    } catch (cause) {
      if (!signal.aborted && entry.value.generation === flight.generation) this.fail(entry, quotaError(cause));
    } finally { lease?.release(); }
  }
  private fail(entry: Entry, failure: { reason: AgentUsageLimits["reasonCode"]; retryAfterMs?: number; origin?: QuotaVerdictOrigin }) {
    entry.pending = false;
    entry.completionUntil = null;
    if (entry.flight) entry.flight.settled = true;
    const terminal = failure.reason === "needs-auth" || failure.reason === "not-installed" || failure.reason === "unsupported";
    // Availability is an expected state; read failures retain warnings with reason codes only.
    const phase = entry.flight ? ` (${entry.flight.phase})` : "";
    if (terminal) this.trace(entry.value.backend, `quota unavailable: ${failure.reason}${phase}`);
    else console.warn("[usage-limits:%s] quota read failed: %s%s", entry.value.backend, failure.reason, phase);
    if (terminal) this.forget(entry.value.backend);
    const steps = failure.reason === "unavailable" ? [FIRST_RETRY_MS, ...LIMITS_TIMING.retryMs] : LIMITS_TIMING.retryMs;
    const delay = Math.max(steps[Math.min(entry.failures, steps.length - 1)]!, failure.retryAfterMs ?? 0);
    entry.failures += 1;
    /* A rate limit without a retry-after holds manual Refresh for its whole backoff too: the server just refused, and the button
       (which greys out until nextRetryAt) must agree with what a press would do. */
    entry.serverRetryUntil = failure.retryAfterMs ? this.now() + failure.retryAfterMs : failure.reason === "rate-limited" ? this.now() + delay : null;
    entry.verdictOrigin = failure.origin ?? "read";
    this.publish(entry, { fetchState: "error", reasonCode: failure.reason,
      availability: terminal ? failure.reason as "needs-auth" | "not-installed" | "unsupported" : entry.value.pools.length ? "available" : "unavailable",
      nextRetryAt: this.now() + (terminal ? LIMITS_TIMING.refreshMs : delay),
      ...(terminal ? { pools: [], planLabel: null, source: null, receivedAt: null } : {}) });
    if (terminal || entry.failures >= AUTOMATIC_FAILURE_LIMIT) void this.source.demand?.(entry.value.backend, "closed");
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
    if (this.closed) return;
    this.closed = true; this.demands.clear();
    for (const entry of this.entries.values()) { entry.completionUntil = null; entry.menu = false; }
    if (this.timer) this.cancelTimer(this.timer);
    for (const release of this.releases) release();
    const flights = [...this.entries.values()].flatMap((entry) => entry.flight ? [entry.flight] : []);
    for (const flight of flights) flight.controller.abort("shutdown");
    await Promise.allSettled(flights.map((flight) => flight.promise));
    // No reader process outlives the service: a cancelled read closes its own channel, this closes the parked ones.
    await Promise.allSettled(this.providers.map((backend) => this.source.demand?.(backend, "closed")));
    this.listeners.clear();
  }
}
