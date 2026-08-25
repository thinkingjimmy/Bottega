/**
 * [INPUT]: Depends on tabId, AbortSignal and asynchronous batch assignments
 * [OUTPUT]: Provides PerTabExecutionLane; The tabs are strictly in sequence with the different tabs being parallel
 * [POS]: The main/browser/execution batch is simultaneously loaded; Remove the queue semantics from the CDP implementation to prevent the old batch from clearing the new batch status
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
