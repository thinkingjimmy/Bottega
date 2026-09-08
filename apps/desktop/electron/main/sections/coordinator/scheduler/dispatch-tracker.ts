/**
 * [INPUT]: Depends on Stable StopOperation identities and deferred asynchronous dispatch work.
 * [OUTPUT]: Provides dispatchTracker synchronous registration/refinement, change subscriptions, and complete in-flight drain.
 * [POS]: Coordinator-owned preparation tracker shared by dispatch, safe quit, and task status.
 */

import type { StopOperation } from "../../../presence/lifecycle/start-fence";

export class DispatchTracker {
  private readonly listeners = new Set<() => void>();
  onChanged(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private notify() { for (const listener of this.listeners) { try { listener(); } catch (cause) { console.warn("[dispatch] observer failed", cause); } } }
  private readonly inFlight = new Map<symbol, { operation: StopOperation; settled: Promise<void> }>();

  track<T>(work: (refine: (operation: StopOperation) => void) => Promise<T>, operation: StopOperation): Promise<T> {
    const token = Symbol("dispatch");
    let finish!: () => void;
    const settled = new Promise<void>((resolve) => { finish = resolve; });
    this.inFlight.set(token, { operation: { startedAt: Date.now(), ...operation }, settled });
    this.notify();
    // Registration precedes even the first synchronous portion of async preparation.
    return Promise.resolve().then(() => work((next) => {
      const record = this.inFlight.get(token);
      if (record) { record.operation = { ...record.operation, ...next }; this.notify(); }
    })).finally(() => {
      this.inFlight.delete(token);
      finish(); this.notify();
    });
  }

  snapshot() { return [...this.inFlight.values()].map(({ operation }) => ({ ...operation })); }
  async drain() {
    while (this.inFlight.size) await Promise.all([...this.inFlight.values()].map(({ settled }) => settled));
  }
}
