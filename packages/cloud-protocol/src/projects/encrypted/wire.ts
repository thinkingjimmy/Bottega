/**
 * [INPUT]: Canonical AEAD envelopes, strict Project transport schemas and SHA-256.
 * [OUTPUT]: Named intent/aggregate commitments, bounded packet validation and immutable ciphertext hashes.
 * [POS]: Pure Project integrity boundary shared by server transactions and client adapters.
 */
import { z } from "zod";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assertCrypto, assertExpectedContext, assertExpectedScope, createProjectContext, decodeBase64url, hashEnvelope, parseEnvelope,
  type CryptoContext, type CryptoScope } from "../../encryption";
import { commitment, digest, version } from "../../encryption/domains/scalars";
import { PROJECT_CIPHER_LIMITS, encryptedProjectHeadSchema, encryptedProjectOperationSchema, projectIntentSchema,
  type ProjectIntent, type ProjectPacket, type EncryptedProjectOperation, type EncryptedProjectHead } from "./model";
export const canonicalRecordJson = (input: unknown): string => {
  if (input === null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(canonicalRecordJson).join(",")}]`;
  return `{${Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${JSON.stringify(key)}:${canonicalRecordJson(value)}`).join(",")}}`;
};
export const recordCipherHash = (input: unknown) => bytesToHex(sha256(new TextEncoder().encode(canonicalRecordJson(input))));
const factsCommitment = z.object({ ciphertextHash: digest, ciphertextBytes: version.positive().max(PROJECT_CIPHER_LIMITS.packetBytes) }).strict();
const aggregate = z.object({ intent: projectIntentSchema, facts: factsCommitment.nullable() }).strict();
const hashProjectIntentMetadata = (intent: ProjectIntent) => commitment("project-intent", projectIntentSchema, intent);
export const hashProjectCommitMetadata = (intent: ProjectIntent, facts: ProjectPacket | null) => commitment("project-commit", aggregate,
  { intent, facts: facts && { ciphertextHash: facts.ciphertextHash, ciphertextBytes: facts.ciphertextBytes } });
export function verifyRecordPacket(packet: ProjectPacket, context: CryptoContext, maximumBytes = PROJECT_CIPHER_LIMITS.packetBytes): Uint8Array {
  const bytes = decodeBase64url(packet.envelope, 1, maximumBytes);
  assertCrypto(bytes.byteLength === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, context); return bytes;
}
export const projectFactsContext = (scope: CryptoScope, projectId: string, operationId: string, intent: ProjectIntent) =>
  createProjectContext(scope, projectId, operationId, { role: "facts", expectedRevision: intent.expectedRevision,
    metadataCommitment: hashProjectIntentMetadata(intent) });
export function verifyProjectOperation(input: EncryptedProjectOperation, scope: CryptoScope) {
  const value = encryptedProjectOperationSchema.parse(input), { ciphertextHash, ...payload } = value;
  assertCrypto(recordCipherHash(payload) === ciphertextHash && new TextEncoder().encode(canonicalRecordJson(value)).byteLength <= PROJECT_CIPHER_LIMITS.operationBytes);
  if (value.facts) verifyRecordPacket(value.facts, projectFactsContext(scope, value.projectId, value.operationId, value.intent));
  verifyRecordPacket(value.operation, createProjectContext(scope, value.projectId, value.operationId, { role: "operation",
    expectedRevision: value.intent.expectedRevision, metadataCommitment: hashProjectCommitMetadata(value.intent, value.facts) }));
  return value;
}
export function verifyProjectHead(input: EncryptedProjectHead, scope: CryptoScope, fingerprint: string) {
  const value = encryptedProjectHeadSchema.parse(input);
  assertExpectedScope(value.encryptedSpace.scope, scope);
  assertCrypto(value.encryptedSpace.keyPackageFingerprint === fingerprint, "sync-space-changed");
  verifyRecordPacket(value.facts, projectFactsContext(scope, value.projectId, value.operationId, value.intent)); return value;
}
