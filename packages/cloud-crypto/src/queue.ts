/**
 * [INPUT]: Bounded in-memory crypto operations and foreground/background scheduling intent.
 * [OUTPUT]: Configurable bounded concurrency with waiting limits of 32 jobs/8 MiB and four background jobs/2 MiB.
 * [POS]: Shared client crypto scheduling; durable retries remain owned by each original business outbox.
 */
import { CryptoError } from "@ai-chat/cloud-protocol/encryption";
const WAITING_JOBS = 32, WAITING_BYTES = 8 * 1024 * 1024, BACKGROUND_JOBS = 4, BACKGROUND_BYTES = 2 * 1024 * 1024;
/* navigator is a DOM global: reading it off globalThis only typechecks privately, where
   @types/jsdom drags lib.dom into the desktop Node project. Narrow it explicitly so the
   public Node build compiles, and keep the lookup per call as the default parameter was. */
const hardwareConcurrency = () =>
  (globalThis as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency;
export function cryptoConcurrency(cores = hardwareConcurrency() ?? 2) {
  return Math.max(1, Math.min(Number.isFinite(cores) ? Math.floor(cores) - 1 : 1, 4));
}
interface Job { priority: "foreground" | "background"; bytes: number; start(): Promise<void>; reject(error: Error): void }
export class CryptoQueue {
  private jobs: Job[] = [];
  private running = 0;
  private closed = false;
  private waiters = new Set<() => void>();
  private admissions = new Set<() => void>();
  constructor(private readonly concurrency = 1) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new RangeError("crypto-concurrency");
  }
  private available(priority: Job["priority"], bytes: number) {
    const background = this.jobs.filter(job => job.priority === "background");
    return this.jobs.length < WAITING_JOBS && this.jobs.reduce((sum, job) => sum + job.bytes, bytes) <= WAITING_BYTES &&
      (priority !== "background" || background.length < BACKGROUND_JOBS && background.reduce((sum, job) => sum + job.bytes, bytes) <= BACKGROUND_BYTES);
  }
  assertCapacity(priority: Job["priority"], bytes = 0) {
    if (this.closed) throw new CryptoError("sync-operation-cancelled");
    if (!Number.isSafeInteger(bytes) || bytes < 0 || !this.available(priority, bytes)) throw new CryptoError("sync-operation-busy");
  }
  add<T>(operation: () => Promise<T>, priority: Job["priority"], signal?: AbortSignal, bytes = 0): Promise<T> {
    if (signal?.aborted) return Promise.reject(new CryptoError("sync-operation-cancelled"));
    if (priority === "foreground") {
      try { this.assertCapacity(priority, bytes); } catch (error) { return Promise.reject(error as Error); }
      return this.enqueue(operation, priority, signal, bytes);
    }
    return this.admit(operation, priority, signal, bytes);
  }
  // Bulk callers meter themselves against the background lane instead of failing; interactive work keeps the fail-fast throw.
  private async admit<T>(operation: () => Promise<T>, priority: Job["priority"], signal: AbortSignal | undefined, bytes: number): Promise<T> {
    for (;;) {
      if (this.closed || signal?.aborted) throw new CryptoError("sync-operation-cancelled");
      if (!Number.isSafeInteger(bytes) || bytes < 0) throw new CryptoError("sync-operation-busy");
      if (this.available(priority, bytes)) return this.enqueue(operation, priority, signal, bytes);
      // Nothing is waiting, so this job alone exceeds a limit and no completion can make room for it.
      if (!this.jobs.length) throw new CryptoError("sync-operation-busy");
      await this.admission(signal);
    }
  }
  private admission(signal?: AbortSignal) {
    return new Promise<void>(resolve => {
      const done = () => { signal?.removeEventListener("abort", done); this.admissions.delete(done); resolve(); };
      this.admissions.add(done); signal?.addEventListener("abort", done, { once: true });
    });
  }
  private release() { for (const done of [...this.admissions]) done(); }
  private enqueue<T>(operation: () => Promise<T>, priority: Job["priority"], signal: AbortSignal | undefined, bytes: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const remove = () => signal?.removeEventListener("abort", abort);
      const job: Job = { priority, bytes, reject(error) { remove(); reject(error); }, async start() {
        remove(); try { resolve(await operation()); } catch (error) { reject(error); }
      } };
      const abort = () => { const index = this.jobs.indexOf(job); if (index >= 0) { this.jobs.splice(index, 1); job.reject(new CryptoError("sync-operation-cancelled")); this.release(); } };
      signal?.addEventListener("abort", abort, { once: true });
      this.jobs.push(job); void this.drain();
    });
  }
  private drain() {
    while (this.jobs.length && this.running < this.concurrency) {
      const foreground = this.jobs.findIndex(job => job.priority === "foreground");
      const [job] = this.jobs.splice(foreground < 0 ? 0 : foreground, 1);
      this.running++; this.release();
      void job.start().finally(() => {
        this.running--; this.drain(); this.release();
        if (!this.running && !this.jobs.length) { for (const done of this.waiters) done(); this.waiters.clear(); }
      });
    }
  }
  clear() { for (const job of this.jobs.splice(0)) job.reject(new CryptoError("sync-operation-cancelled")); this.release(); }
  flush() { return this.running ? new Promise<void>(resolve => this.waiters.add(resolve)) : Promise.resolve(); }
  close() { this.closed = true; this.clear(); }
}
