/**
 * [INPUT]: Depends on the public canonical JSON and its digest (@bottega/contracts), errors.ts statusError, shared generation identities, and Registry stored-package contracts
 * [OUTPUT]: Provides canonical JSON digests (the contract's implementation), sameCanonical for frozen-value agreement, exact generation keys, lifecycle conflicts, and the derived package enable state
 * [POS]: apps/desktop/electron/main/extensions/registry; Pure identity kernel shared by Registry install, lifecycle, projection, and persistence authorities
 */

import { canonicalJson, hashCanonical } from "@bottega/contracts/core/canonical-json";
import type {
  ExtensionEnableState,
  ExtensionPackageGenerationRef,
  PackageGenerationRecord,
  Sha256Digest,
} from "../../../../shared/ipc/settings/extensions-ipc";
import { statusError } from "../../ipc/errors";
import type { ExtensionRegistryStoredPackage } from "./registry-schema";

/** Derived, never persisted: administrative state outranks component enablement. */
export function packageEnableState(
  owner: Pick<ExtensionRegistryStoredPackage, "administrativeState" | "enabledComponentInstanceIdentities">
): ExtensionEnableState {
  if (owner.administrativeState === "disable-pending") return "disable-pending";
  if (owner.administrativeState === "denied") return "disabled";
  return owner.enabledComponentInstanceIdentities.length > 0 ? "enabled" : "disabled";
}

export function generationRef(record: PackageGenerationRecord) {
  return {
    packageGenerationId: record.packageGenerationId,
    recordDigest: record.recordDigest,
  } satisfies ExtensionPackageGenerationRef;
}

export function exactGenerationRef(ref: ExtensionPackageGenerationRef) {
  return {
    packageGenerationId: ref.packageGenerationId,
    recordDigest: ref.recordDigest,
  } satisfies ExtensionPackageGenerationRef;
}

/** The one generation-ref key; it is also the persisted `refs` key in registry.json. */
export function refKey(ref: ExtensionPackageGenerationRef): string;
export function refKey(ref: ExtensionPackageGenerationRef | null | undefined): string | null;
export function refKey(ref: ExtensionPackageGenerationRef | null | undefined) {
  return ref ? `${ref.packageGenerationId}:${ref.recordDigest}` : null;
}

export function registryConflict(message: string) {
  return statusError(409, message);
}

/* One canonical JSON for the product (@bottega/contracts): a value JSON cannot express is refused, never digested as a hole. */
export { canonicalJson };
export function digestCanonical(value: unknown): Sha256Digest {
  return `sha256:${hashCanonical(value)}`;
}

/** Two frozen values agree only when both exist and serialize the same: an absent one never matches. */
export function sameCanonical(left: unknown, right: unknown) {
  return left !== undefined && right !== undefined && canonicalJson(left) === canonicalJson(right);
}
