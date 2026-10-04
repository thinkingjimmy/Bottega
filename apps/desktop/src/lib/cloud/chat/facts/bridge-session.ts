/**
 * [INPUT]: Depends only on a local-change subscription supplied by the Chat bridge.
 * [OUTPUT]: Provides BridgeSession: the shared snapshot/subscribe surface and the generation fence both facts controllers use.
 * [POS]: Base of facts/session.ts and facts/deletion.ts; it owns no request and no view shape of its own.
 */
export abstract class BridgeSession<State> {
  private readonly listeners = new Set<() => void>();
  private stop: (() => void) | null = null;
  protected generation = 0;
  protected reading = 0;
  protected busy = false;
  protected closed = false;
  protected constructor(protected value: State, private readonly onLocalChanged: (listener: () => void) => () => void) {}
  snapshot = () => this.value;
  subscribe = (changed: () => void) => { this.listeners.add(changed); return () => { this.listeners.delete(changed); }; };
  protected update(value: State) { this.value = value; for (const changed of this.listeners) changed(); }
  /** A reply may only be installed while this session still owns the newest read and holds no request of its own. */
  protected owns(generation: number, reading: number) {
    return !this.closed && generation === this.generation && reading === this.reading && !this.busy && !this.pending;
  }
  open() { this.closed = false; this.stop?.(); this.stop = this.onLocalChanged(() => { void this.refresh(); }); return this.refresh(); }
  async retry() { if (this.pending) await this.deliver(); else await this.refresh(); }
  close() { this.closed = true; this.generation++; this.reading++; this.busy = false; this.stop?.(); this.stop = null; }
  protected abstract get pending(): boolean;
  abstract refresh(): Promise<void>;
  protected abstract deliver(): Promise<void>;
}
