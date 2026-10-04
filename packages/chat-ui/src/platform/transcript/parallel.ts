/**
 * [INPUT]: Depends on a bounded list, an abort signal, an asynchronous item reader and an optional concurrency width.
 * [OUTPUT]: Maps authenticated reads concurrently while preserving input order and cancellation.
 * [POS]: Shared transcript read scheduling; callers pick a width that leaves the crypto queue room for interactive work.
 */
export async function readInParallel<T, R>(items: readonly T[], signal: AbortSignal, read: (item: T) => Promise<R>, width = 4): Promise<R[]> {
  if (!Number.isInteger(width) || width < 1) throw new RangeError("read-concurrency");
  const result = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, async () => {
    while (next < items.length) {
      signal.throwIfAborted();
      const index = next++;
      result[index] = await read(items[index]!);
    }
  }));
  signal.throwIfAborted();
  return result;
}

/** One shared admission budget prevents independent page readers from multiplying worker pressure. */
export class ReadBudget {
  private active = 0;
  private waiting: (() => void)[] = [];
  constructor(private readonly width = 16) {
    if (!Number.isInteger(width) || width < 1) throw new RangeError("read-concurrency");
  }
  async run<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const start = () => { signal.removeEventListener("abort", abort); this.active++; resolve(); };
      const abort = () => { this.waiting = this.waiting.filter(item => item !== start); reject(signal.reason); };
      if (this.active < this.width) start();
      else { this.waiting.push(start); signal.addEventListener("abort", abort, { once: true }); }
    });
    try { signal.throwIfAborted(); return await read(); }
    finally { this.active--; this.waiting.shift()?.(); }
  }
}
