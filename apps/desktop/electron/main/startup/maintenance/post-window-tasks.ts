/**
 * [INPUT]: Depends on the startup trace recorder and caller-supplied cancellation.
 * [OUTPUT]: Provides PostWindowTask, runPostWindowTasks (the serial runner for maintenance the first frame does not need; a task refused because quit began is a traced quit-time no-op, not a failure) and PostWindowFlights (tracked runs quit drains before the owners close).
 * [POS]: The only place startup work runs after the main window is ready; deferred-maintenance.ts supplies the tasks, index.ts supplies the ports.
 */

import { asError } from "../../ipc/errors";
import { startupTrace } from "../boot/startup-trace";

export type PostWindowTask = Readonly<{ name: string; run(): Promise<void> }>;

export type PostWindowPorts = Readonly<{
  /* Owners start closing the moment a quit is requested; a task that keeps going
     would only rediscover half-closed stores. */
  cancelled(): boolean;
}>;

export async function runPostWindowTasks(
  tasks: readonly PostWindowTask[],
  { cancelled }: PostWindowPorts
) {
  startupTrace.mark("post-window:start");
  for (const task of tasks) {
    if (cancelled()) {
      startupTrace.mark("post-window:cancelled", task.name);
      return;
    }
    try {
      await task.run();
    } catch (cause) {
      /* Quit stops every writer's admission first, so a task caught mid-write is refused by design: that is the quit, and the next
         launch runs the task again. A failure while not quitting is a real one. */
      if (cancelled()) { startupTrace.mark("post-window:stopped-by-quit", task.name); return; }
      console.warn(`[startup] ${task.name} failed`, asError(cause));
    }
    startupTrace.mark(`post-window:${task.name}`);
  }
  startupTrace.mark("post-window:done");
}

/**
 * Every post-window run quit must wait for (TASK-11 follow-up): the runner stops between tasks once quit is requested, but a task already
 * running still writes into its store, so the owners close only after `drain()`. A run scheduled later (Design factory after a folder
 * mounts) is tracked the same way.
 */
export class PostWindowFlights {
  private readonly flights = new Set<Promise<void>>();

  run(tasks: readonly PostWindowTask[], ports: PostWindowPorts) {
    const flight = runPostWindowTasks(tasks, ports).finally(() => this.flights.delete(flight));
    this.flights.add(flight);
    return flight;
  }

  async drain() {
    while (this.flights.size) await Promise.allSettled([...this.flights]);
  }
}

