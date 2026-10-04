/**
 * [INPUT]: Depends on AbortSignal, Node timers, crypto and the shared locale-independent canonical digest
 * [OUTPUT]: Provides rejection-safe deadline races, immediate propagation of cancelled/expired signals, canonical SHA-256 (stableMemoryDigest), the receipt digest-form marker and MemoryReceiptVoidError (older-build receipts are void, never recomputed)
 * [POS]: Stateless Memory deadline and digest primitives shared by recall, Policy, and Delivery; callers dispose their signal controllers
 */

import { canonicalSha256Hex } from "../persistence/canonical-digest";

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

export function stableMemoryDigest(value: unknown) {
  return canonicalSha256Hex(value);
}

/**
 * Receipts minted with the locale-independent digest carry this marker (inside the digested base). A receipt
 * without it was written by an older build: it is void — treated as absent, never recomputed the old way.
 */
export const MEMORY_DIGEST_FORM = 2 as const;
export const isVoidMemoryReceipt = (receipt: { digestForm?: number }) => receipt.digestForm !== MEMORY_DIGEST_FORM;

/** A saga referenced a receipt an older build wrote; the owner re-applies instead of failing. */
export class MemoryReceiptVoidError extends Error {
  readonly name = "MemoryReceiptVoidError";
}
