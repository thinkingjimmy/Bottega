/**
 * [INPUT]: Depends on Node SHA-256, shared generation identities, and Registry stored-package contracts
 * [OUTPUT]: Provides canonical JSON digests, exact generation keys, lifecycle conflicts, and legacy enable projection synchronization
 * [POS]: Pure identity kernel shared by Registry install, lifecycle, projection, and persistence authorities
 */

import { createHash } from "node:crypto";
import type {
  ExtensionPackageGenerationRef,
  PackageGenerationRecord,
  Sha256Digest,
} from "../../../shared/extensions-ipc";
import type { ExtensionRegistryStoredPackage } from "./registry-schema";

export function syncLegacyEnable(owner: ExtensionRegistryStoredPackage) {
  owner.enabled = owner.administrativeState === "disable-pending"
    ? "disable-pending"
    : owner.administrativeState === "denied"
      ? "disabled"
      : owner.enabledComponentInstanceIdentities.length > 0
        ? "enabled"
        : "disabled";
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

export function refKey(ref: ExtensionPackageGenerationRef | null | undefined) {
  return ref ? `${ref.packageGenerationId}:${ref.recordDigest}` : null;
}

export function registryConflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
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
