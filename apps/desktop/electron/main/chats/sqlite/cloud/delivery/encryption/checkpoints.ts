/**
 * [INPUT]: Original scoped outbox records, committed checkpoint predecessors and closed crypto contracts.
 * [OUTPUT]: Validates metadata/file custody and original remote fact packets independently of the Chat's current execution custody.
 * [POS]: Delivery validation leaf; it owns no scheduler, queue, credentials or key material.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { assertExpectedContext, createFileContext, decodeBase64url, hashEnvelope, MAX_ENVELOPE_BYTES, parseEnvelope } from "@ai-chat/cloud-protocol/encryption";
import { validateChatPacket, validateEncryptedChatOperation } from "@ai-chat/cloud-protocol/chats/encrypted";
import { encryptedFileIdentitySchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { validateMessageBlock, validateEncryptedMessage } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import type { ChatDeliveryCheckpoint } from "../contracts";
export function validateEncryptionCheckpoint(checkpoint: ChatDeliveryCheckpoint, chatId: string, userId: string,
  prior: (key: string) => ChatDeliveryCheckpoint) {
  if (checkpoint.kind === "encrypted-remote-initial") {
    if (checkpoint.chatId !== chatId || checkpoint.facts.role !== "facts" || checkpoint.options.role !== "options" ||
      checkpoint.facts.operationId !== checkpoint.options.operationId || canonicalJson(checkpoint.facts.metadata) !== canonicalJson(checkpoint.options.metadata) ||
      checkpoint.facts.metadata.incarnationId !== checkpoint.incarnationId) throw new Error("REMOTE_INITIAL_CIPHER_MISMATCH");
    validateChatPacket(checkpoint.encryptedSpace.scope, chatId, checkpoint.facts);
    validateChatPacket(checkpoint.encryptedSpace.scope, chatId, checkpoint.options);
  }
  if (checkpoint.kind === "encrypted-chat-metadata") {
    const original = prior("metadata-operation");
    if (original.kind !== "metadata-operation" || original.operation.payloadHash !== checkpoint.plaintextHash ||
      original.operation.operationId !== checkpoint.transport.operationId || checkpoint.transport.chatId !== chatId) throw new Error("CHAT_CIPHER_IDENTITY_MISMATCH");
    validateEncryptedChatOperation(checkpoint.encryptedSpace.scope, checkpoint.transport);
  }
  if (checkpoint.kind === "encrypted-file-intent") {
    if (checkpoint.userId !== userId || checkpoint.identity.owner.kind !== "chat" || checkpoint.identity.owner.id !== chatId) throw new Error("FILE_CIPHER_OWNER_MISMATCH");
  }
  if (checkpoint.kind === "encrypted-message-intent") {
    if (checkpoint.membership.source === "native") {
      const body = prior(`body:${checkpoint.membership.seq}`);
      if (body.kind !== "native-body" || body.bodyHash !== checkpoint.plaintextHash || body.body.message.id !== checkpoint.membership.messageId) throw new Error("MESSAGE_CIPHER_SOURCE_MISMATCH");
    }
    if (checkpoint.membership.chatId !== chatId || checkpoint.userId !== userId ||
      checkpoint.blockIds.length !== Math.ceil(checkpoint.plaintextBytes / 65_536) || new Set(checkpoint.blockIds).size !== checkpoint.blockIds.length) throw new Error("MESSAGE_CIPHER_OWNER_MISMATCH");
  }
  if (checkpoint.kind === "encrypted-message-block" || checkpoint.kind === "encrypted-message-complete") {
    const intent = prior(checkpoint.key + ":intent");
    if (intent.kind !== "encrypted-message-intent" || intent.membership.chatId !== chatId || intent.userId !== userId) throw new Error("MESSAGE_CIPHER_INTENT_MISMATCH");
    if (checkpoint.kind === "encrypted-message-block") {
      const block = checkpoint.block;
      if (block.operationId !== intent.operationId || canonicalJson(block.membership) !== canonicalJson(intent.membership) ||
        block.blockCount !== intent.blockIds.length || block.blockId !== intent.blockIds[block.blockIndex]) throw new Error("MESSAGE_CIPHER_BLOCK_MISMATCH");
      validateMessageBlock(intent.encryptedSpace.scope, block);
    } else {
      const message = checkpoint.message;
      if (checkpoint.plaintextHash !== intent.plaintextHash || message.operationId !== intent.operationId ||
        canonicalJson(message.membership) !== canonicalJson(intent.membership) || canonicalJson(message.pages[0]!.publication) !== canonicalJson(intent.publication)) throw new Error("MESSAGE_CIPHER_COMPLETE_MISMATCH");
      validateEncryptedMessage(intent.encryptedSpace.scope, message);
      for (const part of message.pages[0]!.metadata.blocks) {
        const frozen = prior(`${checkpoint.key}:block:${part.index}`);
        if (frozen.kind !== "encrypted-message-block" || frozen.block.blockId !== part.blockId ||
          frozen.block.ciphertextHash !== part.ciphertextHash || frozen.block.ciphertextBytes !== part.ciphertextBytes) throw new Error("MESSAGE_CIPHER_MANIFEST_MISMATCH");
      }
    }
  }
  if (checkpoint.kind === "encrypted-file-part" || checkpoint.kind === "encrypted-file-complete") {
    const intent = prior(checkpoint.key + ":intent");
    if (intent.kind !== "encrypted-file-intent" || intent.identity.owner.id !== chatId || intent.userId !== userId) throw new Error("FILE_CIPHER_INTENT_MISMATCH");
    const identity = intent.identity;
    if (checkpoint.kind === "encrypted-file-part") {
      if (checkpoint.blobId !== identity.blobId || checkpoint.part.partIndex >= identity.chunkCount) throw new Error("FILE_CIPHER_PART_MISMATCH");
      const bytes = decodeBase64url(checkpoint.envelope, 1, MAX_ENVELOPE_BYTES);
      if (bytes.byteLength !== checkpoint.part.bytes || hashEnvelope(bytes) !== checkpoint.part.sha256) throw new Error("FILE_CIPHER_PART_MISMATCH");
      assertExpectedContext(parseEnvelope(bytes).context, createFileContext(identity.encryptedSpace.scope, identity.blobId, identity.operationId,
        { ownerKind: identity.owner.kind, ownerId: identity.owner.id, ownerGeneration: identity.ownerGeneration,
          manifestId: identity.manifestId, chunkIndex: checkpoint.part.partIndex, chunkCount: identity.chunkCount }));
    } else {
      const value = checkpoint.descriptor, { parts, bytes: _bytes, sha256: _hash, ...actualIdentity } = value.encryption;
      if (checkpoint.inputHash !== intent.inputHash || value.blobId !== identity.blobId || value.sha256 !== intent.source.sha256 ||
        value.bytes !== intent.source.bytes || value.mime !== intent.source.mime || canonicalJson(encryptedFileIdentitySchema.parse(actualIdentity)) !== canonicalJson(identity)) throw new Error("FILE_CIPHER_COMPLETE_MISMATCH");
      for (const part of parts) {
        const frozen = prior(`${checkpoint.key}:part:${part.partIndex}`);
        if (frozen.kind !== "encrypted-file-part" || frozen.blobId !== identity.blobId || canonicalJson(frozen.part) !== canonicalJson(part)) throw new Error("FILE_CIPHER_MANIFEST_MISMATCH");
      }
    }
  }
}
