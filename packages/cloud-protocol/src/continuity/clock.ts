/**
 * [INPUT]: Depends on an authenticated mutation port, monotonic time and explicit lifecycle invalidation.
 * [OUTPUT]: Provides single-flight fresh server time and conservative immutable command deadlines.
 * [POS]: Shared desktop/browser clock; query results and persisted clocks are never accepted.
 */
import { sampleTimeResultSchema, continuityIdentitySchema, type ContinuityIdentity } from "./functions";
type ClockIdentity = ContinuityIdentity;
export interface ClockScope { identity: ClockIdentity; generation: number; }
export interface ClockReply { sampleId: string; current: ClockIdentity; serverTime: number; }
interface ClockPort {
  /** Null denies offline, locked or unregistered clients. Generation changes on reconnect. */
  current(): ClockScope | null;
  sample(sampleId: string, scope: ClockScope): Promise<ClockReply>;
  monotonicNow(): number;
  randomId(): string;
}
export const CLOCK_MAX_RTT_MS = 5_000;
const CLOCK_MAX_AGE_MS = 30_000;
const commandTtl = { intent: 30 * 60_000, "list-workspace-files": 60_000, "read-workspace-file": 60_000, "start-turn": 120_000, "edit-message": 120_000, "retry-authentication": 120_000, steer: 120_000, cancel: 60_000,
  "withdraw-queued": 60_000, "reorder-queue": 60_000,
  "fork-chat": 60_000, "retry-without-session": 60_000, "retry-same-session": 60_000, "abandon-fatal-turn": 60_000,
  "respond-approval": 60_000, "respond-user-input": 60_000 } as const;
const identityFields = ["environmentId", "deploymentId", "userId", "sessionId", "deviceId", "restoreGeneration"] as const;
const sameScope = (left: ClockScope | null, right: ClockScope) => left?.generation === right.generation &&
  identityFields.every(field => left.identity[field] === right.identity[field]);
export class ClockUnavailableError extends Error {
  constructor() { super("sync-clock-unavailable"); }
}
interface Sample { scope: ClockScope; generation: number; responseAt: number; serverTime: number; rtt: number; }
export class ServerClock {
  private generation = 0;
  private cached: Sample | null = null;
  private flight: Promise<void> | null = null;
  private lastObserved = -Infinity;
  constructor(private readonly port: ClockPort) {}

  /** Call on disconnect, visibility resume, host wake, lock and account changes. */
  invalidate() { this.generation++; this.cached = null; }

  private now() {
    const value = this.port.monotonicNow();
    if (!Number.isFinite(value) || value < 0 || value < this.lastObserved) {
      this.invalidate(); this.lastObserved = value; throw new ClockUnavailableError();
    }
    this.lastObserved = value;
    return value;
  }

  estimate(): { lower: number; upper: number } | null {
    const now = this.now(), sample = this.cached;
    if (!sample || sample.generation !== this.generation || !sameScope(this.port.current(), sample.scope)) return null;
    const elapsed = now - sample.responseAt;
    if (elapsed < 0 || elapsed > CLOCK_MAX_AGE_MS) { this.cached = null; return null; }
    const lower = Math.floor(sample.serverTime + elapsed), upper = Math.ceil(sample.serverTime + elapsed + sample.rtt);
    if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper)) { this.cached = null; return null; }
    return { lower, upper };
  }

  async refresh(): Promise<void> {
    if (this.estimate()) return;
    if (this.flight) return this.flight;
    const current = this.port.current();
    if (!current || !continuityIdentitySchema.safeParse(current.identity).success || !Number.isSafeInteger(current.generation)) throw new ClockUnavailableError();
    const scope = { identity: { ...current.identity }, generation: current.generation };
    const generation = this.generation, sampleId = this.port.randomId(), startedAt = this.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let timedOut = false;
    // The slot remains occupied until the actual SDK request settles, even after timeout.
    // A disconnected SDK must not accumulate a new queued mutation on every retry.
    const request = Promise.resolve().then(() => {
      if (!sameScope(this.port.current(), scope) || generation !== this.generation) throw new ClockUnavailableError();
      return this.port.sample(sampleId, scope);
    }).then(input => {
      const parsed = sampleTimeResultSchema.safeParse(input);
      if (!parsed.success) throw new ClockUnavailableError();
      const reply = parsed.data;
      const responseAt = this.now(), rtt = responseAt - startedAt;
      if (timedOut || generation !== this.generation || !sameScope(this.port.current(), scope) ||
        reply.sampleId !== sampleId || !sameScope({ identity: reply.current, generation: scope.generation }, scope) ||
        !Number.isSafeInteger(reply.serverTime) || reply.serverTime < 0 || rtt > CLOCK_MAX_RTT_MS) throw new ClockUnavailableError();
      this.cached = { scope, generation, responseAt, serverTime: reply.serverTime, rtt };
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { timedOut = true; this.cached = null; reject(new ClockUnavailableError()); }, CLOCK_MAX_RTT_MS);
    });
    const flight = Promise.race([request, timeout]);
    this.flight = flight;
    void request.finally(() => {
      if (timer) clearTimeout(timer);
      if (this.flight === flight) this.flight = null;
    }).catch(() => {});
    return flight;
  }

  async freezeDeadline(kind: keyof typeof commandTtl): Promise<number> {
    if (!Object.hasOwn(commandTtl, kind)) throw new ClockUnavailableError();
    await this.refresh();
    const now = this.estimate();
    if (!now) throw new ClockUnavailableError();
    const deadline = now.lower + commandTtl[kind];
    if (!Number.isSafeInteger(deadline)) throw new ClockUnavailableError();
    return deadline;
  }

  async assertBeforeEffect(expiresAt: number): Promise<void> {
    await this.refresh();
    const now = this.estimate();
    if (!now || !Number.isSafeInteger(expiresAt) || now.upper >= expiresAt) throw new ClockUnavailableError();
  }
}
