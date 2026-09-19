/**
 * [INPUT]: Depends on closed storage modes and environment/account scope equality.
 * [OUTPUT]: Provides cleanup-fenced runtime activation and enrollment guards.
 * [POS]: Pure Store admission policy; the main account binding owns deployment identity and durable consent.
 */
import { runtimeStorageModeSchema, sameScope, type RuntimeStorageMode, type StorageMode, type SyncScope } from "./contracts";

export function transitionStorageMode(current: StorageMode, input: RuntimeStorageMode, attached: Iterable<SyncScope | null>): RuntimeStorageMode {
  const next = runtimeStorageModeSchema.parse(input);
  if (next.kind !== "local-only" && current.kind !== "local-only" && !sameScope(next.scope, current.scope)) {
    throw new Error("PREVIOUS_SCOPE_CLEANUP_REQUIRED");
  }
  for (const scope of attached) {
    if (scope && (next.kind === "local-only" || !sameScope(next.scope, scope))) throw new Error("PREVIOUS_SCOPE_CLEANUP_REQUIRED");
  }
  return next;
}

export function enrollmentOpen(mode: StorageMode) {
  return mode.kind !== "local-only" && (mode.kind !== "sync" || mode.enrollment === "open");
}
