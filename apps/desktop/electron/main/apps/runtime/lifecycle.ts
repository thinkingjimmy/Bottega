/**
 * [INPUT]: Accepts runtime from startup/agent settled Promise and resets the known process to stop
 * [OUTPUT]: Provides asSettled with settleRuntimeStop to ensure that the stop crosses all delays
 * [POS]: The lifecycle of apps/runtime is pure core, the chip is marked stop→ wait to start→ stop delay until PID→ wait for Agent chip to be fixed
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
