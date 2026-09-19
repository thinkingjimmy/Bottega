/**
 * [INPUT]: Depends only on ambient promises; no store, transport or account state is reachable from here.
 * [OUTPUT]: Provides bounded-lane per-item isolation and a doubling retry interval for the synchronization run.
 * [POS]: Scheduling detail of run.ts; ordering guarantees between phases stay in the run itself.
 */
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
