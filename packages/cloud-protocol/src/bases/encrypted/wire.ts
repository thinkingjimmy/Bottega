/**
 * [INPUT]: Canonical envelope parsing, exact domain metadata commitments and bounded ciphertext DTOs.
 * [OUTPUT]: Pure Base packet, full-transport hash and expected-context validation.
 * [POS]: Shared integrity boundary used before server writes and before client decryption.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { assertCrypto, assertExpectedContext, createBaseFieldContext, createBaseOperationContext, decodeBase64url, hashEnvelope,
  hashBaseOperationMetadata, hashBaseCommitMetadata, hashBaseInitialMetadata, hashBaseInitialCommitMetadata, parseEnvelope,
  type CryptoScope, type CryptoContext } from "../../encryption";
import { encryptedBaseCommitSchema, encryptedBaseInitialSchema, ENCRYPTED_BASE_LIMITS,
  type BaseCipherTarget, type CipherPacket, type EncryptedBaseCommit, type EncryptedBaseInitial, type EncryptedBaseField } from "./model";
export const canonicalCipherJson = (input: unknown): string => {
  if (input === null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(canonicalCipherJson).join(",")}]`;
  return `{${Object.entries(input).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => `${JSON.stringify(key)}:${canonicalCipherJson(value)}`).join(",")}}`;
};
export const encryptedBaseBytes = (input: unknown) => new TextEncoder().encode(canonicalCipherJson(input)).byteLength;
export function baseTargetKey(target: BaseCipherTarget): string {
  switch (target.kind) {
    case "cell": return `cell:${target.rowId}:${target.columnId}`;
    case "row": return `row:${target.rowId}`;
    case "column": return `column:${target.columnId}`;
    case "column-field": return `column:${target.columnId}:${target.path.join(":")}`;
    case "view": return `view:${target.viewId}`;
    case "view-field": return `view:${target.viewId}:${target.path.join(":")}`;
    case "meta": case "order": return `meta:${target.field}`;
  }
}
const sameBaseTarget = (a: BaseCipherTarget, b: BaseCipherTarget) => baseTargetKey(a) === baseTargetKey(b);
export function hashBaseCiphertext(input: Omit<EncryptedBaseCommit, "ciphertextHash"> | Omit<EncryptedBaseInitial, "ciphertextHash">): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalCipherJson(input))));
}
export function verifyBasePacket(packet: CipherPacket, context: CryptoContext): Uint8Array {
  const bytes = decodeBase64url(packet.envelope, 1, 98_304);
  assertCrypto(bytes.byteLength === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, context); return bytes;
}
export const baseFieldMetadata = (field: EncryptedBaseField) => ({ index: field.binding.patchIndex, role: field.binding.role, target: field.binding.target,
  references: field.references, ciphertextHash: field.packet.ciphertextHash, ciphertextBytes: field.packet.ciphertextBytes });
export function verifyBaseField(field: EncryptedBaseField, scope: CryptoScope, baseId: string): Uint8Array {
  return verifyBasePacket(field.packet, createBaseFieldContext(scope, baseId, field.operationId, field.binding));
}
export function verifyBaseInitial(input: EncryptedBaseInitial, scope: CryptoScope): EncryptedBaseInitial {
  const value = encryptedBaseInitialSchema.parse(input), { ciphertextHash, ...payload } = value;
  assertCrypto(hashBaseCiphertext(payload) === ciphertextHash && encryptedBaseBytes(value) <= ENCRYPTED_BASE_LIMITS.initialBytes);
  const commitment = hashBaseInitialMetadata(value.intent), fields = value.fields.map(baseFieldMetadata);
  const expected = new Set(["meta:name", "meta:activeViewId", "meta:columns", "meta:views",
    ...value.intent.columnIds.map(id => `column:${id}`), ...value.intent.viewIds.map(id => `view:${id}`)]);
  assertCrypto(fields.length === expected.size && new Set(fields.map(field => baseTargetKey(field.target))).size === expected.size);
  for (const field of value.fields) {
    assertCrypto(expected.has(baseTargetKey(field.binding.target)) && field.operationId === value.operationId && field.binding.patchIndex === 0 &&
      field.binding.role === "value" && field.binding.expectedFieldVersion === 0 && field.binding.expectedRowVersion === null &&
      field.binding.expectedColumnSchemaVersion === null && field.binding.structuralGeneration === 0 && field.binding.metadataCommitment === commitment && !field.references.length);
    verifyBaseField(field, scope, value.baseId);
  }
  verifyBasePacket(value.operation, createBaseOperationContext(scope, value.baseId, value.operationId, { role: "snapshot", schemaRevision: 1,
    structuralGeneration: 0, metadataCommitment: hashBaseInitialCommitMetadata({ intent: value.intent, fields }) }));
  return value;
}
export function verifyBaseCommit(input: EncryptedBaseCommit, scope: CryptoScope): EncryptedBaseCommit {
  const value = encryptedBaseCommitSchema.parse(input), { ciphertextHash, ...payload } = value;
  assertCrypto(hashBaseCiphertext(payload) === ciphertextHash && encryptedBaseBytes(value) <= ENCRYPTED_BASE_LIMITS.commitBytes);
  const commitment = hashBaseOperationMetadata(value.intent), metadata = value.fields.map(baseFieldMetadata);
  const totalValueFields = value.fields.filter(field => field.binding.role === "value").length;
  assertCrypto(totalValueFields <= 164 && (!value.intent.atomicGroup || totalValueFields <= 132));
  assertCrypto(new Set(value.fields.flatMap(field => field.references.map(reference => reference.blobId))).size <= 64);
  for (const field of value.fields) {
    const patch = value.intent.patches[field.binding.patchIndex], target = field.binding.target;
    assertCrypto(patch && field.operationId === value.operationId && field.binding.role === "value" &&
      field.binding.metadataCommitment === commitment && field.binding.structuralGeneration === value.intent.structuralGeneration);
    const expectedVersion = sameBaseTarget(patch.target, target) ? patch.expectedFieldVersion : patch.kind === "create-row" ? 0 :
      value.intent.preconditions.find(condition => sameBaseTarget(condition.target, target))?.version;
    assertCrypto(expectedVersion !== undefined && field.binding.expectedFieldVersion === expectedVersion);
    if (sameBaseTarget(patch.target, target)) assertCrypto(field.binding.expectedRowVersion === patch.expectedRowVersion &&
      field.binding.expectedColumnSchemaVersion === patch.expectedColumnSchemaVersion);
    verifyBaseField(field, scope, value.baseId);
  }
  for (const patch of value.intent.patches) {
    assertCrypto(value.fields.some(field => field.binding.patchIndex === patch.index && sameBaseTarget(field.binding.target, patch.target)));
    const declared = canonicalCipherJson([...patch.references].sort((a, b) => a.blobId.localeCompare(b.blobId)));
    const collected = value.fields.filter(field => field.binding.patchIndex === patch.index).flatMap(field => field.references), byId = new Map<string, typeof collected[number]>();
    for (const reference of collected) {
      const previous = byId.get(reference.blobId); assertCrypto(!previous || canonicalCipherJson(previous) === canonicalCipherJson(reference)); byId.set(reference.blobId, reference);
    }
    const references = [...byId.values()];
    assertCrypto(canonicalCipherJson([...references].sort((a, b) => a.blobId.localeCompare(b.blobId))) === declared);
    assertCrypto(patch.derivedTargets.every(target => value.fields.some(field => field.binding.patchIndex === patch.index && sameBaseTarget(field.binding.target, target))));
  }
  verifyBasePacket(value.operation, createBaseOperationContext(scope, value.baseId, value.operationId, { role: "operation", schemaRevision: value.intent.schemaRevision,
    structuralGeneration: value.intent.structuralGeneration, metadataCommitment: hashBaseCommitMetadata({ intent: value.intent, fields: metadata }) }));
  return value;
}
