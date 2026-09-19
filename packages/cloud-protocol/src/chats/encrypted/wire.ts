/**
 * [INPUT]: Named Chat AAD constructors, canonical bytes and closed ciphertext transport schemas.
 * [OUTPUT]: Server-safe exact envelope/aggregate verification and allowed metadata construction.
 * [POS]: Chat wire integrity; semantic plaintext equality belongs to clients.
 */
import { canonicalJson } from "../../encryption/encoding";
import { hashBytes } from "../../blobs/transfer";
import { assertCrypto, assertExpectedContext, createChatContext, decodeBase64url, hashChatMetadata, hashEnvelope, parseEnvelope,
  type CryptoScope } from "../../encryption";
import { chatPacketSchema, encryptedChatMetadataOperationSchema, CHAT_CIPHER_LIMITS,
  type ChatPacket, type EncryptedChatMetadataOperation } from "./model";
export function chatOperationMetadata(operation: Omit<EncryptedChatMetadataOperation, "facts" | "options" | "operation" | "ciphertextHash">) {
  return { incarnationId: operation.chat.incarnationId, classification: { kind: operation.chat.classification.conversationKind,
    appId: operation.chat.classification.appId, projectId: operation.chat.classification.projectId }, sourceDeviceId: operation.sourceDeviceId,
    agent: operation.chat.agent, agentRevision: operation.chat.agentRevision, expectedRevision: operation.expectedRevision,
    executionEpoch: operation.executionEpoch, archivedAt: operation.archivedAt, references: [] };
}
export function chatPacketContext(scope: CryptoScope, chatId: string, packet: Pick<ChatPacket, "operationId" | "role" | "metadata">) {
  return createChatContext(scope, chatId, packet.operationId, { role: packet.role, incarnationId: packet.metadata.incarnationId,
    expectedRevision: packet.metadata.expectedRevision, metadataCommitment: hashChatMetadata(packet.metadata) });
}
export function validateChatPacket(scope: CryptoScope, chatId: string, raw: ChatPacket) {
  const packet = chatPacketSchema.parse(raw), bytes = decodeBase64url(packet.envelope, 1, CHAT_CIPHER_LIMITS.packetBytes);
  assertCrypto(bytes.byteLength === packet.ciphertextBytes && hashEnvelope(bytes) === packet.ciphertextHash);
  assertExpectedContext(parseEnvelope(bytes).context, chatPacketContext(scope, chatId, packet)); return bytes;
}
export function hashEncryptedChatOperation(raw: EncryptedChatMetadataOperation) {
  const { ciphertextHash: _hash, ...operation } = encryptedChatMetadataOperationSchema.parse(raw);
  const bytes = new TextEncoder().encode(canonicalJson(operation)); assertCrypto(bytes.byteLength <= CHAT_CIPHER_LIMITS.commitBytes);
  return hashBytes(bytes);
}
export function validateEncryptedChatOperation(scope: CryptoScope, raw: EncryptedChatMetadataOperation) {
  const value = encryptedChatMetadataOperationSchema.parse(raw), metadata = chatOperationMetadata(value);
  assertCrypto(hashEncryptedChatOperation(value) === value.ciphertextHash);
  for (const [role, packet] of [["facts", value.facts], ["metadata", value.operation], ["options", value.options]] as const) {
    if (!packet) continue;
    assertCrypto(packet.role === role && packet.operationId === value.operationId && canonicalJson(packet.metadata) === canonicalJson(metadata));
    validateChatPacket(scope, value.chatId, packet);
  }
  return value;
}
