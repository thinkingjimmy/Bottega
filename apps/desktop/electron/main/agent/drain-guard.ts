/**
 * [INPUT]: Depends on turn persist/retry status with a forced persisting reset
 * [OUTPUT]: Provides ensure PersistedForDrain, eliminates the drain and verifies the drain termination
 * [POS]: The only thing that can be done is to remove the anti-aging material from the bodyShutdown, deletion and maintenance shared
 */

import type { TurnEntry } from "../turn-registry";

const DRAINABLE_PERSIST = new Set(["stored", "empty", "missing"]);

export async function ensurePersistedForDrain(
  entry: Pick<TurnEntry, "persist" | "retry">,
  forcePersist: () => Promise<void>
) {
  const cancelTimer = () => {
    if (entry.retry.timer) clearTimeout(entry.retry.timer);
    entry.retry.timer = undefined;
  };
  cancelTimer();
  if (entry.retry.inFlight) await entry.retry.inFlight;
  cancelTimer();
  if (entry.persist === "retryable") await forcePersist();
  if (!DRAINABLE_PERSIST.has(entry.persist)) {
    throw new Error(`turn 持久化未完成：${entry.persist}`);
  }
}
