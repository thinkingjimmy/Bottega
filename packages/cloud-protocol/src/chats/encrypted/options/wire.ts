/**
 * [INPUT]: Named Chat AAD, strict option CAS metadata and canonical ciphertext packets.
 * [OUTPUT]: Server-safe binding validation and deterministic ciphertext operation hashes.
 * [POS]: Options integrity leaf; equality of private option values is resolved by authenticated clients.
 */
import { canonicalJson } from "../../../encryption/encoding";
import { assertCrypto, assertExpectedContext, createChatContext, decodeBase64url, hashEnvelope, parseEnvelope, type CryptoScope } from "../../../encryption";
import { hashChatContent } from "../../transcript/body";
import { validateChatPacket } from "../wire";
import { encryptedOptionsOperationSchema, type EncryptedOptionsOperation } from "./model";
function optionsBinding(raw: EncryptedOptionsOperation) {
  const { proof: _proof, ciphertextHash: _hash, ...binding } = encryptedOptionsOperationSchema.parse(raw); return binding;
}
export function optionsContext(scope: CryptoScope, operation: EncryptedOptionsOperation) {
  return createChatContext(scope, operation.chatId, operation.operationId, { role: "options", incarnationId: operation.incarnationId,
    expectedRevision: operation.agentRevision, metadataCommitment: hashChatContent(["chat-options-cas-v1", optionsBinding(operation)]) });
}
export function hashEncryptedOptions(raw: EncryptedOptionsOperation) {
  const { ciphertextHash: _hash, ...operation } = encryptedOptionsOperationSchema.parse(raw);
  assertCrypto(new TextEncoder().encode(canonicalJson(operation)).byteLength <= 131_072); return hashChatContent(operation);
}
export function validateEncryptedOptions(scope: CryptoScope, raw: EncryptedOptionsOperation) {
  const value = encryptedOptionsOperationSchema.parse(raw), packet = value.options;
  assertCrypto(hashEncryptedOptions(value) === value.ciphertextHash && packet.role === "options" && packet.operationId === value.operationId &&
    packet.metadata.incarnationId === value.incarnationId && packet.metadata.agent === value.backend && packet.metadata.agentRevision === value.agentRevision &&
    packet.metadata.sourceDeviceId === value.sourceDeviceId);
  validateChatPacket(scope, value.chatId, packet);
  const bytes = decodeBase64url(value.proof.envelope, 1, 98_304);
  assertCrypto(bytes.byteLength === value.proof.ciphertextBytes && hashEnvelope(bytes) === value.proof.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, optionsContext(scope, value)); return value;
}
