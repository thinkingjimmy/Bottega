/**
 * [INPUT]: Accepts a RuntimeSettlement entry (startup/agent settled promises) and a stopKnownProcesses callback
 * [OUTPUT]: Provides asSettled and settleRuntimeStop, which marks the entry stopping and re-invokes stopKnownProcesses after each settlement point so no process started mid-startup or mid-agent-turn survives
 * [POS]: apps/runtime's pure stop-sequencing core; it holds no process state itself, only orders when stopKnownProcesses re-runs
 */

export type RuntimeSettlement = {
  stopping: boolean;
  startupSettled: Promise<void>;
  agentSettled?: Promise<void>;
};

export function asSettled(promise: Promise<unknown>) {
  return promise.then(
    () => undefined,
    () => undefined
  );
}

export async function settleRuntimeStop(
  entry: RuntimeSettlement,
  stopKnownProcesses: () => Promise<void>
) {
  entry.stopping = true;
  const failures: unknown[] = [];
  const stopKnown = async () => {
    try {
      await stopKnownProcesses();
    } catch (cause) {
      failures.push(cause);
    }
  };

  await stopKnown();
  await entry.startupSettled;
  await stopKnown();
  if (entry.agentSettled) {
    try {
      await entry.agentSettled;
    } catch (cause) {
      failures.push(cause);
    }
    await stopKnown();
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, "App 进程未能全部停止");
  }
}
