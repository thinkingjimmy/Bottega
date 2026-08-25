/**
 * [INPUT]: Depends on FrozenTurnMemoryContext as a seven-field authorized
 * [OUTPUT]: Provides MemoryCapabilityFenceSnapshot with the only phase-by-phase matching function; The rebuild of the unherited runtime generation is obviously ignored
 * [POS]: The capability fence of memory/core is the single source of truthprompt, capture, authority No longer maintaining a field set
 */

import type { FrozenTurnMemoryContext } from "./domain";

export type MemoryCapabilityFenceSnapshot = Readonly<{
  policyRevision: number;
  revocationRevision: number;
  consentEpochId: string | null;
  providerDataInstanceId: string | null;
  memorySpaceId: string | null;
  expectedPeerId: string | null;
  runtimeGeneration: number;
}>;

export function memoryCapabilityFenceMatches(
  frozen: FrozenTurnMemoryContext,
  current: MemoryCapabilityFenceSnapshot,
  options: Readonly<{ requireRuntimeGeneration?: boolean }> = {}
) {
  return Boolean(
    frozen.policyRevision === current.policyRevision &&
      frozen.revocationRevision === current.revocationRevision &&
      frozen.consentEpochId === current.consentEpochId &&
      frozen.providerDataInstanceId === current.providerDataInstanceId &&
      frozen.memorySpaceId === current.memorySpaceId &&
      frozen.expectedPeerId === current.expectedPeerId &&
      (options.requireRuntimeGeneration === false ||
        frozen.runtimeGeneration === current.runtimeGeneration)
  );
}
