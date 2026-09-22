/**
 * [INPUT]: Depends only on ambient promises and the public file-progress shape; no store, transport or account state is reachable from here.
 * [OUTPUT]: Provides bounded-lane per-item isolation, cheapest-first queue ordering, per-transfer byte metering and a doubling retry interval for the synchronization run.
 * [POS]: Pacing and accounting details of run.ts; ordering guarantees between phases stay in the run itself.
 */
import type { FileProgress } from "@ai-chat/cloud-protocol";
// Cheapest first: the count moves in seconds instead of after the largest items free their lanes. Keys cost a read, so read once.
export function smallestFirst<T>(items: readonly T[], key: (item: T) => readonly [number, string]): T[] {
  return items.map(item => ({ item, key: key(item) }))
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1].localeCompare(b.key[1])).map(entry => entry.item);
}
/* File progress is cumulative within one transfer and names no transfer, so concurrent transfers can only be
   summed through one counter each; hashing and downloading move no upload bytes. */
export function transferMeter(count: (bytes: number) => void) {
  return () => {
    let counted = 0;
    return (value: FileProgress) => {
      if (value.phase === "hashing" || value.phase === "downloading") return;
      const bytes = Math.min(value.bytes, value.total);
      if (bytes > counted) { count(bytes - counted); counted = bytes; }
    };
  };
}
export async function forEachIsolated<T>(items: readonly T[], lanes: number, run: (item: T) => Promise<void>, failed: (error: unknown) => void) {
  let next = 0;
  const lane = async () => {
    for (let index = next++; index < items.length; index = next++) {
      try { await run(items[index]!); } catch (error) { failed(error); }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(lanes, items.length)) }, lane));
}
export class RetrySchedule {
  private failures = 0;
  constructor(private readonly base: number, private readonly ceiling: number) {}
  get delay() { return Math.min(this.ceiling, this.base * 2 ** this.failures); }
  failed() { if (this.delay < this.ceiling) this.failures++; }
  reset() { this.failures = 0; }
}
