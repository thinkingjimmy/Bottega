/**
 * [INPUT]: Depends on the original Promise
 * [OUTPUT]: Provides anti-toxic SerialQueue, supporting sequential enqueue, shutdown, re-opening, flush barriers and bounded path-free queue observations
 * [POS]: Electron main's reusable write-order kernel, consumed by durable stores that must serialize state and side effects through shutdown
 */

type Operation = "operation" | "sync-read" | "sync-write";
const observed = new Set<SerialQueue>();
export function serialQueueDiagnostics() { return [...observed].slice(-8).map(queue => queue.diagnostics()); }
export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private accepting = true;

  private queued = new Map<object, number>();
  private active: { operation: Operation; startedAt: number } | null = null;
  private completed = 0;
  private lastWaitMs = 0;
  private lastRunMs = 0;
  constructor(private readonly label?: "chat-store") { if (label && observed.size < 8) observed.add(this); }
  diagnostics() {
    const now = Date.now();
    return { label: this.label ?? "queue", sampledAt: now, pending: this.queued.size, completed: this.completed,
      oldestWaitMs: this.queued.size ? Math.max(0, now - this.queued.values().next().value!) : 0,
      active: this.active ? { operation: this.active.operation, elapsedMs: Math.max(0, now - this.active.startedAt) } : null,
      lastWaitMs: this.lastWaitMs, lastRunMs: this.lastRunMs };
  }
  enqueue<T>(job: () => Promise<T>, operation: Operation = "operation"): Promise<T> {
    if (!this.accepting) return Promise.reject(new Error("持久化队列已关闭"));
    const item = {}, queuedAt = Date.now(); this.queued.set(item, queuedAt);
    const run = this.tail.then(async () => {
      const startedAt = Date.now(); this.lastWaitMs = Math.max(0, startedAt - queuedAt); this.active = { operation, startedAt };
      try { return await job(); }
      finally { this.lastRunMs = Math.max(0, Date.now() - startedAt); this.active = null; this.queued.delete(item); this.completed++; }
    });
    this.tail = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  close() {
    this.accepting = false; observed.delete(this);
  }

  reopen() {
    this.accepting = true; if (this.label && observed.size < 8) observed.add(this);
  }

  flush() {
    return this.tail;
  }
}
