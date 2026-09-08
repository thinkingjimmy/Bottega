/**
 * [INPUT]: Depends on the shared MemoryStatusSnapshot contract (health, warning/recallWarning, applyStatus, and attention facts)
 * [OUTPUT]: Provides memoryNeedsAttention, the minimal pure projection deciding whether the Sidebar should light its Memory alert
 * [POS]: Renderer's lightweight navigation-level Memory projection, kept separate from Settings' fuller lib/memory-view so the Sidebar doesn't pull in the whole Settings bundle
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
