/**
 * [INPUT]: Depends on Node SHA-256, errors.ts statusError, shared generation identities, and Registry stored-package contracts
 * [OUTPUT]: Provides canonical JSON digests, exact generation keys, lifecycle conflicts, and the derived package enable state
 * [POS]: Pure identity kernel shared by Registry install, lifecycle, projection, and persistence authorities
 */

import { createHash } from "node:crypto";
import type {
  ExtensionEnableState,
  ExtensionPackageGenerationRef,
  PackageGenerationRecord,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import { statusError } from "../errors";
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

export function digestCanonical(value: unknown): Sha256Digest {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}
