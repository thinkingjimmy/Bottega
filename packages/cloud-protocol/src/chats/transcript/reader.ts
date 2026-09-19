/**
 * [INPUT]: Current Chat incarnation, bounded ciphertext block reads and an admitted content worker.
 * [OUTPUT]: Authenticates a complete native body and checks its original membership and private file references.
 * [POS]: Shared desktop/Web decoder; only verified plaintext can enter local Stores or rendered transcripts.
 */
import { canonicalJson } from "../../encryption/encoding";
import { encryptedFileDescriptorSchema, type FileCipherPort } from "../../blobs/encrypted";
import { encryptedMessageProjectionSchema, encryptedMessageSummary,
  type EncryptedMessageProjection, type EncryptedMessageBlock } from "../encrypted/messages";
import { ciphertextFileDescriptor } from "../../blobs/encrypted/transport";
import { openMessageBody } from "../encrypted/messages/client";
import { chatBodySchema } from "./body";
import { openTurnPrefix, type TurnPrefixReader } from "../../turns/encrypted/prefix";
import { turnPrefixSummary } from "../../turns/encrypted/wire";
type ChatBodyReadPort = {
  crypto(): FileCipherPort;
  readBlock(chatId: string, bodyHash: string, blockId: string, signal: AbortSignal): Promise<EncryptedMessageBlock>;
  readPrefixPage: TurnPrefixReader;
};
export async function readChatBody(projection: EncryptedMessageProjection, chat: { id: string; incarnationId: string },
  ports: ChatBodyReadPort, signal: AbortSignal) {
  const item = encryptedMessageProjectionSchema.parse(projection);
  if (item.storage.kind === "encrypted-turn-prefix") {
    const prefix = item.storage.prefix;
    if (prefix.start.chatId !== chat.id || prefix.start.incarnationId !== chat.incarnationId || prefix.bodyHash !== item.bodyHash ||
      canonicalJson(item.summary) !== canonicalJson(turnPrefixSummary(prefix))) throw new Error("CHAT_BODY_MEMBERSHIP_CHANGED");
    return openTurnPrefix(prefix, ports.crypto(), ports.readPrefixPage, signal);
  }
  const encrypted = item.storage.message, membership = encrypted.membership;
  signal.throwIfAborted();
  if (membership.chatId !== chat.id || membership.incarnationId !== chat.incarnationId || membership.source !== "native" ||
    membership.generationId !== null || item.bodyHash !== encrypted.bodyHash ||
    canonicalJson(item.summary) !== canonicalJson(encryptedMessageSummary(encrypted))) throw new Error("CHAT_BODY_MEMBERSHIP_CHANGED");
  const bytes = await openMessageBody(encrypted, ports.crypto(), (blockId, current) => ports.readBlock(chat.id, item.bodyHash, blockId, current), signal);
  try {
    signal.throwIfAborted(); const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), body = chatBodySchema.parse(JSON.parse(text));
    const message = body.message, publication = encrypted.pages[0]!.publication;
    if (canonicalJson(body) !== text || message.segment !== undefined || message.id !== membership.messageId || message.seq !== membership.seq ||
      (message.role === "notice" ? "system" : message.role) !== membership.messageRole || membership.timeState !== "valid" ||
      message.createdAt !== membership.originalCreatedAt || publication.backend !== (message.role === "assistant" ? message.backend : null) ||
      publication.turnId !== (message.role === "assistant" ? message.turnId ?? null : null) ||
      publication.completion !== (message.role === "assistant" ? message.completion ?? null : null)) throw new Error("CHAT_BODY_CONTENT_CHANGED");
    const references = new Map([...body.attachments, ...body.media].map(item => {
      const file = encryptedFileDescriptorSchema.parse(item.blob);
      if (file.encryption.owner.kind !== "chat" || file.encryption.owner.id !== chat.id || file.encryption.ownerGeneration !== null) throw new Error("CHAT_FILE_OWNER_CHANGED");
      return [file.blobId, ciphertextFileDescriptor(file)] as const;
    }));
    if (canonicalJson([...references.values()]) !== canonicalJson(publication.references)) throw new Error("CHAT_FILE_REFERENCES_CHANGED");
    signal.throwIfAborted(); return body;
  } finally { bytes.fill(0); }
}
