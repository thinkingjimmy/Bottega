/**
 * [INPUT]: Complete original message membership, named AAD constructors and canonical packet bytes.
 * [OUTPUT]: Exact server-safe block/manifest verification and ciphertext publication summaries.
 * [POS]: Content-blind wire validation; plaintext body semantics and hashes remain client responsibilities.
 */
import { canonicalJson } from "../../../encryption/encoding";
import { hashBytes } from "../../../blobs/transfer";
import { assertCrypto, assertExpectedContext, createMessageContext, decodeBase64url, hashEnvelope, hashMessageManifestMetadata, parseEnvelope, type CryptoScope } from "../../../encryption";
import { encryptedMessageBlockSchema, encryptedMessagePageSchema, encryptedMessageSchema, encryptedBodySummarySchema, MESSAGE_CIPHER_LIMITS,
  type EncryptedMessageBlock, type EncryptedMessagePage, type EncryptedMessage } from "./model";
export const messageBlockContext = (scope: CryptoScope, value: Omit<EncryptedMessageBlock, "envelope" | "ciphertextHash" | "ciphertextBytes">) =>
  createMessageContext(scope, value.membership.messageId, value.operationId, { role: "block", membership: value.membership,
    blockId: value.blockId, blockIndex: value.blockIndex, blockCount: value.blockCount });
export const messagePageContext = (scope: CryptoScope, value: Omit<EncryptedMessagePage, "envelope" | "ciphertextHash" | "ciphertextBytes">) =>
  createMessageContext(scope, value.metadata.membership.messageId, value.operationId, { role: "manifest", membership: value.metadata.membership,
    blockCount: value.metadata.blockCount, pageIndex: value.pageIndex, pageCount: value.pageCount, metadataCommitment: hashMessageManifestMetadata(value.metadata) });
export function validateMessageBlock(scope: CryptoScope, raw: EncryptedMessageBlock) {
  const value = encryptedMessageBlockSchema.parse(raw), bytes = decodeBase64url(value.envelope, 1, MESSAGE_CIPHER_LIMITS.packetBytes);
  assertCrypto(bytes.byteLength === value.ciphertextBytes && hashEnvelope(bytes) === value.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, messageBlockContext(scope, value)); return bytes;
}
export function validateMessagePage(scope: CryptoScope, raw: EncryptedMessagePage) {
  const value = encryptedMessagePageSchema.parse(raw), bytes = decodeBase64url(value.envelope, 1, MESSAGE_CIPHER_LIMITS.packetBytes);
  assertCrypto(bytes.byteLength === value.ciphertextBytes && hashEnvelope(bytes) === value.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, messagePageContext(scope, value)); return bytes;
}
export function hashEncryptedMessage(raw: EncryptedMessage) {
  const { bodyHash: _hash, ...value } = encryptedMessageSchema.parse(raw); return hashBytes(new TextEncoder().encode(canonicalJson(value)));
}
export function validateEncryptedMessage(scope: CryptoScope, raw: EncryptedMessage) {
  const message = encryptedMessageSchema.parse(raw);
  assertCrypto(hashEncryptedMessage(message) === message.bodyHash);
  for (const [index, page] of message.pages.entries()) {
    assertCrypto(page.operationId === message.operationId && canonicalJson(page.metadata.membership) === canonicalJson(message.membership) && page.pageIndex === index && page.pageCount === message.pages.length);
    validateMessagePage(scope, page);
  }
  return message;
}
export function encryptedMessageSummary(value: EncryptedMessage) {
  const { membership } = value, publication = value.pages[0]!.publication;
  return encryptedBodySummarySchema.parse({ messageId: membership.messageId, seq: membership.seq,
    role: membership.messageRole === "system" ? "notice" : membership.messageRole, backend: publication.backend,
    createdAt: membership.originalCreatedAt, timeState: membership.timeState, source: membership.source, generationId: membership.generationId,
    blobs: publication.references, turnId: publication.turnId, completion: publication.completion,
    ciphertextBytes: value.pages.reduce((total, page) => total + page.ciphertextBytes + page.metadata.blocks.reduce((sum, block) => sum + block.ciphertextBytes, 0), 0) });
}
