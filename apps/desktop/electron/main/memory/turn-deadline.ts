/**
 * [INPUT]: Depends on AbortSignal, Node timers, and crypto
 * [OUTPUT]: Provides rejection-safe deadline races, immediate propagation of cancelled/expired signals, and canonical SHA-256
 * [POS]: Stateless Memory deadline and digest primitives shared by recall, Policy, and Delivery; callers dispose their signal controllers
 */

import { createHash } from "node:crypto";

export class MemoryDeadlineError extends Error {}
/** 用户取消不是 deadline：receipt 语义完全不同（cancel 无 assistant 则无 receipt）。 */
export class MemoryAbortError extends Error {}

export async function raceMemoryDeadline<T>(
  task: Promise<T>,
  signal: AbortSignal,
  deadlineAt: number
) {
  /* race 输掉后 task 的迟到 rejection 不得变成 unhandledRejection——
     迟到值（含错误）不进入任何 turn 或日志。 */
  task.catch(() => undefined);
  if (signal.aborted) throw new MemoryAbortError();
  if (deadlineAt <= Date.now()) throw new MemoryDeadlineError();
  const remaining = deadlineAt - Date.now();
  let timer: NodeJS.Timeout | null = null;
  let abort: (() => void) | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new MemoryDeadlineError()), remaining);
        abort = () => reject(new MemoryAbortError());
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    if (abort) signal.removeEventListener("abort", abort);
  }
}

export function combineMemorySignals(
  turn: AbortSignal,
  subsystem: AbortSignal,
  deadlineAt: number
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  turn.addEventListener("abort", abort, { once: true });
  subsystem.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, Math.max(0, deadlineAt - Date.now()));
  timer.unref?.();
  if (turn.aborted || subsystem.aborted || deadlineAt <= Date.now()) abort();
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      turn.removeEventListener("abort", abort);
      subsystem.removeEventListener("abort", abort);
    },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)])
  );
}

export function stableMemoryDigest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonical(value)))
    .digest("hex");
}
