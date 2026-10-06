/**
 * [INPUT]: A host-owned initialization operation and its catalog change notifier.
 * [OUTPUT]: PluginInitializer coalesces initialization/retry, retains the cause and drains during shutdown.
 * [POS]: Plugin startup lifecycle leaf; filesystem, compilation and abort authority stay with the caller.
 */
export class PluginInitializer {
  state: "preparing" | "failed" | "ready" = "preparing";
  error: string | null = null;
  private pending: Promise<void> | null = null;

  constructor(private readonly run: () => Promise<void>, private readonly changed: () => void) {}

  start(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.state === "ready") return Promise.resolve();
    this.state = "preparing";
    this.error = null;
    this.pending = Promise.resolve().then(this.run).then(() => { this.state = "ready"; }, cause => {
      this.state = "failed";
      this.error = cause instanceof Error ? cause.message : String(cause);
      throw cause;
    }).finally(() => { this.pending = null; this.changed(); });
    this.changed();
    return this.pending;
  }

  async wait() { await this.pending?.catch(() => undefined); }
}
