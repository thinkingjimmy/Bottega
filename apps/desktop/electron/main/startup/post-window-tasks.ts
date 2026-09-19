/**
 * [INPUT]: Depends on the startup trace recorder and caller-supplied cancellation.
 * [OUTPUT]: Provides PostWindowTask and runPostWindowTasks, the serial runner for maintenance the first frame does not need.
 * [POS]: The only place startup work runs after the main window is ready; deferred-maintenance.ts supplies the tasks, index.ts supplies the ports.
 */

import { asError } from "../errors";
import { startupTrace } from "./startup-trace";

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
      console.warn(`[startup] ${task.name} failed`, asError(cause));
    }
    startupTrace.mark(`post-window:${task.name}`);
  }
  startupTrace.mark("post-window:done");
}
