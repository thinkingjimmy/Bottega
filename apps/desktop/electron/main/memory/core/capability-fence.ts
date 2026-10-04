/**
 * [INPUT]: Depends on FrozenTurnMemoryContext, a seven-field snapshot frozen at turn start
 * [OUTPUT]: Provides MemoryCapabilityFenceSnapshot and memoryCapabilityFenceMatches, comparing all seven fields with an option to skip runtimeGeneration for rebuild callers
 * [POS]: The capability fence of memory/core; prompt-lane and authority-controller compare frozen vs current state through it instead of each maintaining its own field set
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
