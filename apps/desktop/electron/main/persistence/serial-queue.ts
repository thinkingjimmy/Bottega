/**
 * [INPUT]: Depends on the original Promise
 * [OUTPUT]: Provides anti-toxic SerialQueue, supporting sequential enqueue, shutdown, re-opening and flush barriers
 * [POS]: Electron main's general perpetuation write sequence kernel, consumed jointly by ChatStore and SettingsStore
 */

export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private accepting = true;

  enqueue<T>(job: () => Promise<T>): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error("持久化队列已关闭"));
    const run = this.tail.then(job);
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  close() {
    this.accepting = false;
  }

  reopen() {
    this.accepting = true;
  }

  flush() {
    return this.tail;
  }
}
