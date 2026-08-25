/**
 * [INPUT]: Depends on AbortController, Promise and the Hard Clock
 * [OUTPUT]: Provides Memory Network controller Registration, task tracking, draining→stopping Two-phase shutdown and border closure
 * [POS]: The owner of the main/memory/runtime network lifecycle; draining container controlled final flush, stopping before calling operation hard refused
 */

export class MemoryNetworkRuntime {
  private readonly controllers = new Set<AbortController>();
  private readonly tasks = new Set<Promise<unknown>>();
  private readonly changeWaiters = new Set<() => void>();
  private phase: "open" | "draining" | "stopping" = "open";

  get isStopping() {
    return this.phase === "stopping";
  }

  get isDraining() {
    return this.phase === "draining";
  }

  get isClosing() {
    return this.phase !== "open";
  }

  controller(allowDuringDrain = false) {
    if (this.isStopping || (this.isDraining && !allowDuringDrain)) {
      throw new Error("Memory network runtime 已停止");
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    return controller;
  }

  release(controller: AbortController) {
    this.controllers.delete(controller);
    this.signalChange();
  }

  track<T>(task: Promise<T>) {
    this.tasks.add(task);
    void task
      .finally(() => {
        this.tasks.delete(task);
        this.signalChange();
      })
      .catch(() => {});
    return task;
  }

  run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    allowDuringDrain = false
  ) {
    if (this.isStopping || (this.isDraining && !allowDuringDrain)) {
      return Promise.reject(new Error("Memory network runtime 已停止"));
    }
    const controller = this.controller(allowDuringDrain);
    let task: Promise<T>;
    try {
      task = operation(controller.signal);
    } catch (cause) {
      this.release(controller);
      return Promise.reject(cause);
    }
    task = task.finally(() => this.release(controller));
    return this.track(task);
  }

  abortAll() {
    for (const controller of this.controllers) controller.abort();
  }

  reopen() {
    this.phase = "open";
  }

  beginDraining() {
    if (this.phase === "open") this.phase = "draining";
  }

  async shutdown(graceMs: number) {
    this.beginDraining();
    let timeout: NodeJS.Timeout | null = null;
    const expired = new Promise<false>((resolve) => {
      timeout = setTimeout(() => resolve(false), graceMs);
      timeout.unref?.();
    });
    const drained = this.drain().then(() => true as const);
    const completed = await Promise.race([drained, expired]);
    if (timeout) clearTimeout(timeout);
    this.phase = "stopping";
    if (!completed || this.controllers.size > 0) {
      this.abortAll();
      this.controllers.clear();
      this.tasks.clear();
      this.signalChange();
    }
  }

  private async drain() {
    while (this.tasks.size > 0 || this.controllers.size > 0) {
      const changed = new Promise<void>((resolve) => {
        this.changeWaiters.add(resolve);
      });
      if (this.tasks.size === 0) {
        await changed;
      } else {
        await Promise.race([Promise.allSettled([...this.tasks]), changed]);
      }
    }
  }

  private signalChange() {
    for (const resolve of this.changeWaiters) resolve();
    this.changeWaiters.clear();
  }
}
