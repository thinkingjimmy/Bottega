/**
 * [INPUT]: Closed crypto, immutable-space, native persistence and authenticated account contracts.
 * [OUTPUT]: Main-only encryption owner ports and independently verified scope helpers; stopping content carries no pause authority.
 * [POS]: Separates account/consent ownership from worker and key-cache implementation.
 */
import type { CryptoWorkerOwner } from "@ai-chat/cloud-crypto";
import { fingerprintKeyPackage, parseKeyPackage, decodeBase64url, scopeTuple, MAX_KEY_PACKAGE_BYTES, CryptoError } from "@ai-chat/cloud-protocol/encryption";
import type { CryptoScope } from "@ai-chat/cloud-protocol/encryption";
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { SpaceCreateResult, SpaceDescriptor } from "@ai-chat/cloud-protocol/spaces";
import type { ContinuityIdentity, UnlockContinuity, TimeSample } from "@ai-chat/cloud-protocol/continuity/functions";
import type { SyncEncryptionState } from "../../../../shared/cloud/encryption";
import type { SyncKeyStore } from "./storage/store";
export type SyncIdentity = { userId: string; sessionId: string; deviceId: string };
export type EncryptedConsent = { scope: CryptoScope; keyPackageFingerprint: string };
export interface EncryptionPorts {
  config: CloudBuildConfig;
  installationId: string;
  store: Pick<SyncKeyStore, "read" | "saveVerified" | "clear" | "invalidate" | "drain" | "blocked">;
  identity(): SyncIdentity | null;
  connection(): string | null;
  sampleTime(identity: SyncIdentity, sampleId: string): Promise<TimeSample>;
  consent(): EncryptedConsent | null;
  hasBinding(): boolean;
  changed(value: SyncEncryptionState): void;
  stopContent(): Promise<void>;
  verifyIdentity(identity: SyncIdentity): Promise<ContinuityIdentity>;
  continuity(identity: SyncIdentity, previous: { sessionId: string; deviceId: string; restoreGeneration: string }): Promise<UnlockContinuity>;
  getSpace(identity: SyncIdentity): Promise<SpaceDescriptor | null>;
  createSpace(identity: SyncIdentity, input: { createOperationId: string; keyPackage: string }): Promise<SpaceCreateResult>;
  createWorker(source: Pick<CryptoScope, "sourceEnvironment" | "sourceAccountId">): CryptoWorkerOwner;
  validateReview(reviewId: string): void;
  /** `initial` marks the first setup of this space; a later re-approval must not repeat setup-only side effects. */
  approveReview(reviewId: string, consent: EncryptedConsent, current: () => boolean, initial: boolean): Promise<void>;
}
export const sameIdentity = (a: SyncIdentity | null, b: SyncIdentity | null) => Boolean(a && b && a.userId === b.userId && a.sessionId === b.sessionId && a.deviceId === b.deviceId);
export const sameSpace = (a: EncryptedConsent, b: EncryptedConsent) => a.keyPackageFingerprint === b.keyPackageFingerprint &&
  JSON.stringify(scopeTuple(a.scope)) === JSON.stringify(scopeTuple(b.scope));
export function verifySpace(space: SpaceDescriptor) {
  const bytes = decodeBase64url(space.keyPackage, 1, MAX_KEY_PACKAGE_BYTES), key = parseKeyPackage(bytes);
  if (key.createOperationId !== space.createOperationId || !sameSpace({ scope: key.scope, keyPackageFingerprint: fingerprintKeyPackage(bytes) }, space)) {
    throw new CryptoError("sync-space-changed");
  }
  return bytes;
}
