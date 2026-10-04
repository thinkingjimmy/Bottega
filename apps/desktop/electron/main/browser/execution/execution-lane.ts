/**
 * [INPUT]: Depends on tabId, AbortSignal and asynchronous batch assignments
 * [OUTPUT]: Provides PerTabExecutionLane: tasks for the same tab run strictly in sequence, while different tabs run in parallel
 * [POS]: main/browser/execution's per-tab serialization primitive; keeps queue ordering out of the CDP implementation so an aborted older batch can't clobber a newer batch's state
 */

export class PerTabExecutionLane {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(
    tabId: string,
    signal: AbortSignal,
    task: () => Promise<T>
  ): Promise<T> {
    const previous = this.tails.get(tabId) ?? Promise.resolve();
    const result = waitForTurn(previous, signal).then(task);
    const tail = Promise.allSettled([previous, result]).then(() => undefined);
    this.tails.set(tabId, tail);
    void tail.then(() => {
      if (this.tails.get(tabId) === tail) this.tails.delete(tabId);
    });
    return result;
  }
}

function waitForTurn(previous: Promise<void>, signal: AbortSignal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    void previous.then(() => {
      cleanup();
      if (signal.aborted) reject(signal.reason);
      else resolve();
    });
  });
}
