/**
 * [INPUT]: One exact frozen source digest, current binding/flight authority, per-demand content inspection and asynchronous invalidation ports.
 * [OUTPUT]: PluginSourceEpoch acknowledges bytes and failed-flight demands, fences pending checks and retries only proven superseded compiler input.
 * [POS]: Operation-loaded source-event owner; old/closed inspection results cannot invalidate a replacement build.
 */
import { PluginSourceSupersededError } from "../../platform/model";
type Ports = { sourceDigest: string; current(): boolean; bindingCurrent(): boolean; inspect(): Promise<string>; invalidate(): Promise<void> };
export class PluginSourceEpoch {
  private readonly pending = new Set<Promise<void>>();
  private invalidated = false;
  private closed = false;
  private failure: unknown;
  private failedAttempt: Error | undefined;
  constructor(private readonly ports: Ports) {}
  notify() {
    if (this.closed || !this.ports.current()) return;
    const work = (async () => {
      let digest: string | undefined;
      try { digest = await this.ports.inspect(); } catch { /* A changed or missing input needs a complete new snapshot. */ }
      if (this.closed || !this.ports.current() || digest === this.ports.sourceDigest || this.invalidated) return;
      this.invalidated = true; await this.ports.invalidate();
    })().catch(cause => { if (!this.closed && this.ports.current()) this.failure = cause; }).finally(() => this.pending.delete(work));
    this.pending.add(work);
  }
  async drain() { while (this.pending.size) await Promise.all([...this.pending]); }
  assertCurrent() {
    if (this.failure) throw this.failure;
    if (this.closed || !this.ports.current() || this.invalidated || this.pending.size) throw new PluginSourceSupersededError();
  }
  async run<T>(body: () => Promise<T>): Promise<T> {
    try { return await body(); }
    catch (cause) {
      // Cleanup/control failures retain their own authority even when a writer changed source.
      if (!(cause instanceof Error) || cause instanceof AggregateError || "code" in cause || !this.ports.current()) throw cause;
      this.failedAttempt = cause;
      await this.drain();
      if (this.failure) throw this.failure;
      let latest: string;
      try { latest = await this.ports.inspect(); } catch { throw cause; }
      if (this.ports.current() && latest !== this.ports.sourceDigest) throw new PluginSourceSupersededError();
      throw cause;
    }
  }
  async join<T>(work: Promise<T>, retry: () => Promise<T>): Promise<T> {
    try { return await work; }
    catch (cause) {
      if (!this.failedAttempt || cause !== this.failedAttempt || !this.ports.bindingCurrent()) throw cause;
      let latest: string;
      try { latest = await this.ports.inspect(); } catch { throw cause; }
      if (!this.ports.bindingCurrent() || latest === this.ports.sourceDigest) throw cause;
      return retry();
    }
  }
  close() { this.closed = true; }
}
