/**
 * [INPUT]: Depends on host watch factories and one account/key lifetime signal.
 * [OUTPUT]: Provides bounded, expiring watch retention with synchronous cached results.
 * [POS]: Transport-independent read cache; retains wire results and never admits plaintext itself.
 */
export interface RetainableWatch<T> { localQueryResult(): T | undefined; onUpdate(listener: () => void): () => void }
type Entry = { watch: RetainableWatch<unknown>; listeners: Set<() => void>; stop(): void; timer?: ReturnType<typeof setTimeout>; retained: boolean };
export class RetainedWatchCache {
  private readonly entries = new Map<string, Entry>();
  private readonly active = new Set<Entry>();
  private closed = false;
  constructor(signal: AbortSignal, private readonly max = 40, private readonly ttl = 45_000) {
    if (!Number.isInteger(max) || max < 1 || ttl < 0) throw new RangeError("Invalid watch retention budget");
    if (signal.aborted) this.clear(); else signal.addEventListener("abort", () => this.clear(), { once: true });
  }
  watch<T>(key: string, create: () => RetainableWatch<T>): RetainableWatch<T> {
    if (this.closed) throw new DOMException("Workspace expired", "AbortError");
    let entry = this.entries.get(key);
    if (!entry) {
      this.makeRoom();
      const watch = create();
      entry = { watch, listeners: new Set(), stop: () => {}, retained: this.entries.size < this.max };
      const current = entry;
      current.stop = watch.onUpdate(() => { for (const listener of [...current.listeners]) listener(); });
      this.active.add(current);
      if (current.retained) this.entries.set(key, current);
      this.idle(key, current);
    }
    const current = entry;
    return { localQueryResult: () => this.closed ? undefined : current.watch.localQueryResult() as T | undefined,
      onUpdate: listener => {
        if (this.closed || !this.active.has(current)) return () => {};
        const notify = () => listener();
        clearTimeout(current.timer); current.listeners.add(notify);
        if (current.retained) { this.entries.delete(key); this.entries.set(key, current); }
        let live = true;
        return () => { if (!live) return; live = false; current.listeners.delete(notify); if (!current.listeners.size) this.idle(key, current); };
      } };
  }
  private idle(key: string, entry: Entry) {
    clearTimeout(entry.timer);
    if (!this.active.has(entry)) return;
    entry.timer = setTimeout(() => this.drop(key, entry), entry.retained ? this.ttl : 0);
  }
  private makeRoom() {
    if (this.entries.size < this.max) return;
    for (const [key, entry] of this.entries) if (!entry.listeners.size) { this.drop(key, entry); return; }
  }
  private drop(key: string, entry: Entry) {
    if (!this.active.delete(entry)) return;
    clearTimeout(entry.timer); entry.stop(); entry.listeners.clear();
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }
  clear() { this.closed = true; for (const entry of this.active) this.drop("", entry); this.entries.clear(); }
}
