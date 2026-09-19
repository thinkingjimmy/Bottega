/**
 * [INPUT]: Closed App owner/revision metadata, canonical child ciphertexts and exact AEAD contexts.
 * [OUTPUT]: Named App intent/aggregate commitments and bounded server-safe ciphertext verification.
 * [POS]: Integrity-only App boundary; it does not inspect authored files or decrypt package metadata.
 */
import { z } from "zod";
import { assertCrypto, assertExpectedScope, createAppContext, type CryptoScope } from "../../encryption";
import { commitment, digest, version } from "../../encryption/domains/scalars";
import { canonicalRecordJson, recordCipherHash, verifyRecordPacket, verifyProjectOperation, type ProjectPacket } from "../../projects/encrypted";
import { verifyBaseInitial } from "../../bases/encrypted";
import { ciphertextFileDescriptorSchema } from "../../blobs/encrypted/model";
import { APP_CIPHER_LIMITS, appCipherIntentSchema, encryptedAppHeadSchema, encryptedAppOperationSchema, encryptedAppPackageSchema,
  type AppCipherIntent, type EncryptedAppHead, type EncryptedAppOperation, type EncryptedAppPackage } from "./model";
const packet = z.object({ ciphertextHash: digest, ciphertextBytes: version.positive().max(16_384) }).strict();
const aggregateSchema = z.object({ intent: appCipherIntentSchema, facts: packet.nullable(), projectHash: digest.nullable(), initialHash: digest.nullable(),
  package: packet.nullable(), packageFile: ciphertextFileDescriptorSchema.nullable() }).strict();
const packetMetadata = (value: ProjectPacket | null) => value && { ciphertextHash: value.ciphertextHash, ciphertextBytes: value.ciphertextBytes };
const hashAppIntentMetadata = (intent: AppCipherIntent) => commitment("app-intent", appCipherIntentSchema, intent);
export const hashAppCommitMetadata = (value: Pick<EncryptedAppOperation, "intent" | "facts" | "project" | "initial" | "package" | "packageFile">) =>
  commitment("app-commit", aggregateSchema, { intent: value.intent, facts: packetMetadata(value.facts), projectHash: value.project?.ciphertextHash ?? null,
    initialHash: value.initial?.ciphertextHash ?? null, package: packetMetadata(value.package), packageFile: value.packageFile });
export const appRecordContext = (scope: CryptoScope, appId: string, operationId: string, intent: AppCipherIntent, role: "facts" | "package") =>
  createAppContext(scope, appId, operationId, { role, projectId: intent.projectId, baseId: intent.baseId,
    expectedRevision: intent.expectedRevision, packageRevision: intent.packageRevision ?? 0, metadataCommitment: hashAppIntentMetadata(intent) });
export function verifyAppOperation(input: EncryptedAppOperation, scope: CryptoScope) {
  const value = encryptedAppOperationSchema.parse(input), { ciphertextHash, ...payload } = value, { intent } = value;
  assertCrypto(recordCipherHash(payload) === ciphertextHash && new TextEncoder().encode(canonicalRecordJson(value)).byteLength <= APP_CIPHER_LIMITS.operationBytes);
  if (value.facts) verifyRecordPacket(value.facts, appRecordContext(scope, value.appId, value.operationId, intent, "facts"));
  if (value.package) verifyRecordPacket(value.package, appRecordContext(scope, value.appId, value.operationId, intent, "package"));
  if (value.packageFile) {
    assertExpectedScope(value.packageFile.encryption.encryptedSpace.scope, scope);
    assertCrypto(value.packageFile.encryption.owner.kind === "app" && value.packageFile.encryption.owner.id === value.appId);
  }
  if (value.project) {
    verifyProjectOperation(value.project, scope);
    assertCrypto(value.project.projectId === intent.projectId && value.project.operationId === value.operationId &&
      value.project.intent.actorDeviceId === intent.actorDeviceId && value.project.intent.expectedRevision === intent.expectedProjectRevision &&
      value.project.intent.kind === (intent.kind === "create" ? "create" : "patch") &&
      value.project.intent.role === (intent.kind === "delete" ? "base-custody" : "workspace") &&
      value.project.intent.appId === (intent.kind === "delete" ? null : value.appId));
  }
  if (value.initial) {
    verifyBaseInitial(value.initial, scope);
    assertCrypto(value.initial.baseId === intent.baseId && value.initial.operationId === value.operationId &&
      value.initial.intent.owner.kind === "project" && value.initial.intent.owner.projectId === intent.projectId &&
      value.initial.intent.navigation.kind === "internal-app" && value.initial.intent.navigation.appId === value.appId &&
      value.initial.intent.sourceDeviceId === intent.actorDeviceId);
  }
  verifyRecordPacket(value.operation, createAppContext(scope, value.appId, value.operationId, { role: "operation", projectId: intent.projectId,
    baseId: intent.baseId, expectedRevision: intent.expectedRevision, packageRevision: intent.packageRevision ?? 0, metadataCommitment: hashAppCommitMetadata(value) }));
  return value;
}
function scopeMatches(value: { encryptedSpace: { scope: CryptoScope; keyPackageFingerprint: string } }, scope: CryptoScope, fingerprint: string) {
  assertExpectedScope(value.encryptedSpace.scope, scope); assertCrypto(value.encryptedSpace.keyPackageFingerprint === fingerprint, "sync-space-changed");
}
export function verifyAppHead(input: EncryptedAppHead, scope: CryptoScope, fingerprint: string) {
  const head = encryptedAppHeadSchema.parse(input); scopeMatches(head, scope, fingerprint);
  verifyRecordPacket(head.facts, appRecordContext(scope, head.appId, head.operationId, head.intent, "facts")); return head;
}
export function verifyAppPackage(input: EncryptedAppPackage, scope: CryptoScope, fingerprint: string) {
  const value = encryptedAppPackageSchema.parse(input); scopeMatches(value, scope, fingerprint);
  verifyRecordPacket(value.packet, appRecordContext(scope, value.appId, value.operationId, value.intent, "package")); return value;
}
