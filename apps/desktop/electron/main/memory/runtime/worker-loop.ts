/**
 * [INPUT]: Depends on fixed alarm clock, memory service tick, playback and memory network runtime task recording
 * [OUTPUT]: Provides single-flight cycle worker with stop awakening
 * [POS]: The local scheduler for main/memory/runtime; Just decide when to move forward, not read outbox or touch provider
 */

const WORKER_INTERVAL_MS = 500;

export class MemoryWorkerLoop {
  private timer: NodeJS.Timeout | null = null;
  private flight: Promise<void> | null = null;

  constructor(
    private readonly automatic: boolean,
    private readonly run: () => Promise<void>,
    private readonly track: (task: Promise<void>) => void
  ) {}

  start() {
    if (!this.automatic || this.timer) return;
    this.timer = setInterval(() => this.kick(), WORKER_INTERVAL_MS);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  kick() {
    if (!this.automatic || this.flight) return;
    const task = this.run().finally(() => {
      if (this.flight === task) this.flight = null;
    });
    this.flight = task;
    this.track(task);
  }
}
