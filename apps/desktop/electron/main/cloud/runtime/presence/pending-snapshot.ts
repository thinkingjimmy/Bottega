/**
 * [INPUT]: Depends on account-fenced asynchronous Store count reads, the heartbeat sampling cadence and the bounded recovery timeline.
 * [OUTPUT]: Provides PendingCountSnapshot with nullable timestamped counts, one unresolved read and bounded progress diagnostics.
 * [POS]: Runtime presence measurement; local Store progress never owns device liveness.
 */
import { recoveryDiagnostics } from "../diagnostics/timeline";
type Snapshot = { outboxPending: number | null; outboxSampledAt: number | null };
type Sample = { owner: string; startedAt: number; revision: number; stalled: boolean };
const unknown = (): Snapshot => ({ outboxPending: null, outboxSampledAt: null });
export class PendingCountSnapshot {
  private owner: string | null = null;
  private revision = 0;
  private value = unknown();
  private pending: Sample | null = null;
  private lastStartedAt: number | null = null;
  private failedAt: number | null = null;
  private failures = 0;
  constructor(private readonly intervalMs: number) {}
  snapshot(owner: string | null) {
    if (owner !== this.owner) {
      this.owner = owner; this.revision++; this.value = unknown();
      this.lastStartedAt = null; this.failedAt = null; this.failures = 0;
    }
    return { ...this.value };
  }
  sample(owner: string, read: () => Promise<number>, current: () => boolean) {
    const value = this.snapshot(owner), now = Date.now();
    // An obsolete read still owns its slot until it settles: repeated reconnects cannot grow the Store queue.
    if (this.pending && !this.pending.stalled && now - this.pending.startedAt >= this.intervalMs) {
      this.pending.stalled = true; recoveryDiagnostics.record({ stage: "presence", code: "timed-out" });
    }
    if (this.pending || this.lastStartedAt !== null && now - this.lastStartedAt < this.intervalMs || !current()) return value;
    const sample = { owner, startedAt: now, revision: this.revision, stalled: false };
    this.pending = sample; this.lastStartedAt = now; recoveryDiagnostics.record({ stage: "presence", code: "started" });
    const active = () => sample.revision === this.revision && sample.owner === this.owner && current();
    void Promise.resolve().then(() => active() ? read() : null).then(count => {
      if (!active()) return;
      if (count === null || !Number.isSafeInteger(count) || count < 0 || count > 1_000_000) throw new Error("invalid-pending-count");
      // A queued read keeps its start time, so late completion cannot pretend the measurement is fresh.
      this.value = { outboxPending: count, outboxSampledAt: sample.startedAt }; this.failedAt = null;
      recoveryDiagnostics.record({ stage: "presence", code: "ready" });
    }).catch(() => {
      if (active()) { this.failedAt = Date.now(); this.failures = Math.min(this.failures + 1, 1_000_000);
        recoveryDiagnostics.record({ stage: "presence", code: "failed", attempt: this.failures }); }
    }).finally(() => { if (this.pending === sample) this.pending = null; });
    return value;
  }
  diagnostics() {
    const pending = this.pending?.owner === this.owner ? this.pending : null;
    return { ...this.value, phase: pending ? Date.now() - pending.startedAt >= this.intervalMs ? "stalled" : "reading" :
      this.failedAt !== null ? "failed" : this.value.outboxSampledAt === null ? "unknown" : "sampled",
      startedAt: pending?.startedAt ?? null, failedAt: this.failedAt, failures: this.failures };
  }
  close() { this.snapshot(null); }
}
