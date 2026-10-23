/**
 * [INPUT]: One request epoch, authorized expiring leases and release/failure callbacks.
 * [OUTPUT]: PreviewLifetime with bounded acquisition/content readiness and terminal cleanup.
 * [POS]: Portable ordinary, Design and popup preview lifecycle; late leases cannot revive it.
 */
export class PreviewLifetime<T extends { expiresAt: number }> {
  phase: "queued" | "acquiring" | "mounting" | "ready" | "failed" | "expired" = "queued";
  readonly controller = new AbortController();
  private lease?: T;
  private deadline?: ReturnType<typeof setTimeout>;
  private expiry?: ReturnType<typeof setTimeout>;
  constructor(private readonly release: (lease: T) => void, private readonly failure: () => void, timeout = 30_000) {
    this.deadline = setTimeout(() => this.fail(), timeout);
  }
  get closed() { return this.controller.signal.aborted; }
  acquiring() { if (!this.closed) this.phase = "acquiring"; }
  accept(lease: T) {
    if (this.closed || lease.expiresAt <= Date.now()) { this.release(lease); if (!this.closed) this.fail(true); return false; }
    this.lease = lease; this.phase = "mounting";
    this.expiry = setTimeout(() => this.fail(true), Math.min(2_147_483_647, lease.expiresAt - Date.now()));
    return true;
  }
  ready() { if (!this.closed) { this.phase = "ready"; clearTimeout(this.deadline); } }
  fail(expired = false) { if (this.closed) return; this.phase = expired ? "expired" : "failed"; this.dispose(); this.failure(); }
  dispose() {
    clearTimeout(this.deadline); clearTimeout(this.expiry); this.controller.abort();
    const lease = this.lease; this.lease = undefined; if (lease) this.release(lease);
  }
}
