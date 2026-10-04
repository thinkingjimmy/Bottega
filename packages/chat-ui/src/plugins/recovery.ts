/**
 * [INPUT]: Host-owned local recovery persistence and serializable editor checkpoints.
 * [OUTPUT]: PluginRecoveryController serializes dirty recovery and flushes before forced exit/remount.
 * [POS]: Device-local editing custody; account cleanup is owned by the persistence adapter.
 */
import { PLUGIN_RECOVERY_INTERVAL_MS } from '@bottega/contracts/plugins/surface/contract';
export type PluginRecoveryPort<T> = { write(value: T): Promise<void>; remove(): Promise<void> };
export class PluginRecoveryController<T> {
  private latest?: { value: T; revision: number };
  private revision = 0;
  private persisted = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writes: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(private readonly port: PluginRecoveryPort<T>, private readonly delay = PLUGIN_RECOVERY_INTERVAL_MS) {}
  update(value: T, dirty: boolean) {
    if (this.closed || !dirty) return;
    this.latest = { value, revision: ++this.revision };
    // Throttle, not debounce: continuous pointer moves must still reach local disk.
    if (!this.timer) this.timer = setTimeout(() => { this.timer = null; void this.flush().catch(() => {}); }, this.delay);
  }
  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    const latest = this.latest;
    this.writes = this.writes.catch(() => {}).then(async () => {
      if (latest && latest.revision > this.persisted) { await this.port.write(latest.value); this.persisted = latest.revision; }
    });
    return this.writes;
  }
  async close(reason: 'saved' | 'discarded' | 'generation' | 'disabled' | 'revoked' | 'lease-expired' | 'crash') {
    this.closed = true;
    await this.flush();
    if (reason === 'saved' || reason === 'discarded') await this.port.remove();
  }
}
