/**
 * [INPUT]: Depends on frozen PreparedSkillSelectionReceipt and exact Extension generation-ref custody port
 * [OUTPUT]: Configures one prepared-turn custody authority and provides deduplicated acquire/release/readiness operations
 * [POS]: Prepared manual turn generation-reference adapter; Registry journaling remains in PreparedSkillReferenceLedger
 */

import type { PreparedSkillSelectionReceipt } from "../../../../../shared/agent-ipc";
import type { ExtensionPackageGenerationRef } from "../../../../../shared/extensions-ipc";

type PreparedSkillReferenceCustody = Readonly<{
  acquire(ownerId: string, refs: readonly ExtensionPackageGenerationRef[]): Promise<void>;
  release(ownerId: string, refs: readonly ExtensionPackageGenerationRef[]): Promise<void>;
  assertReady(
    ownerId: string,
    refs: readonly ExtensionPackageGenerationRef[]
  ): void | Promise<void>;
}>;

let authority: PreparedSkillReferenceCustody | null = null;

export function configurePreparedSkillReferenceCustody(
  custody: PreparedSkillReferenceCustody
) {
  if (authority) throw new Error("Prepared Skill reference custody 已配置");
  authority = custody;
}

export async function acquirePreparedSkillReferences(
  receipt: PreparedSkillSelectionReceipt
) {
  const refs = preparedExtensionRefs(receipt);
  if (!refs.length) return;
  await requiredAuthority().acquire(receipt.refOwnerId, refs);
}

export async function releasePreparedSkillReferences(
  receipt: PreparedSkillSelectionReceipt
) {
  const refs = preparedExtensionRefs(receipt);
  if (!refs.length) return;
  await requiredAuthority().release(receipt.refOwnerId, refs);
}

export async function assertPreparedSkillReferences(
  receipt: PreparedSkillSelectionReceipt
) {
  const refs = preparedExtensionRefs(receipt);
  if (!refs.length) return;
  await requiredAuthority().assertReady(receipt.refOwnerId, refs);
}

function preparedExtensionRefs(receipt: PreparedSkillSelectionReceipt) {
  const refs = receipt.candidates.flatMap((candidate) =>
    candidate.generationRef.kind === "extension"
      ? [candidate.generationRef.package]
      : []
  );
  return [...new Map(refs.map((ref) => [
    `${ref.packageGenerationId}\0${ref.recordDigest}`,
    ref,
  ])).values()];
}

function requiredAuthority() {
  if (!authority) throw new Error("Prepared Skill reference custody 未装配");
  return authority;
}
