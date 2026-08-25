/**
 * [INPUT]: Depends on shared MemoryStatusSnapshot health, delivery/recall of police, apply and attention Facts
 * [OUTPUT]: Provides Sidebar should light the minimum pure projection of the Memory alert
 * [POS]: The eager Memory of the renderer is navigation projection; Separate from the Settings exclusive memory-view to avoid the entire set of settings being presented in the first package
 */

import type { MemoryStatusSnapshot } from "../../shared/memory-ipc";

export function memoryNeedsAttention(
  status: MemoryStatusSnapshot | null
): boolean {
  if (!status) return false;
  if (status.applyStatus?.state === "failed") return true;
  if (!status.enabled) return status.attention.length > 0;
  return (
    status.health === "unavailable" ||
    status.warning !== null ||
    status.recallWarning != null ||
    status.attention.length > 0
  );
}
