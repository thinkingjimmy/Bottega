/**
 * [INPUT]: Original imported entry checkpoints, admitted crypto, immutable files and message blocks.
 * [OUTPUT]: Prepares and stages exact encrypted import messages in one round trip each, without changing original entry hashes.
 * [POS]: Import publication leaf; the existing outbox retains all identity and byte custody.
 */
import { canonicalJson, type FileProgress } from "@ai-chat/cloud-protocol";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { ciphertextFileDescriptor, type EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { frozenMessageBlockSchema, encryptedMessageSummary, type EncryptedMessage } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import { prepareEncryptedMessage } from "@ai-chat/cloud-protocol/chats/encrypted/messages/client";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { AccountTransport } from "../../../runtime/transport";
import type { ChatDeliveryCheckpoints } from "../checkpoints";
import { stageMessageBlocks } from "../body-publisher";
type Files = Pick<EncryptedBlobTransfer, "crypto" | "uploadFile">;
export async function prepareImportedMessage(entry: ImportedEntry, identity: { chatId: string; incarnationId: string; generationId: string; outboxId: string },
  files: Files, checkpoints: ChatDeliveryCheckpoints, signal: AbortSignal) {
  const references = new Map(entry.fields.flatMap(field => field.chunks).map(raw => {
    const file = encryptedFileDescriptorSchema.parse(raw);
    if (file.encryption.owner.kind !== "chat" || file.encryption.owner.id !== identity.chatId || file.encryption.ownerGeneration !== identity.generationId) throw new Error("IMPORT_FILE_OWNER_CHANGED");
    return [file.blobId, ciphertextFileDescriptor(file)] as const;
  }));
  const plaintext = new TextEncoder().encode(canonicalJson(entry));
  try {
    return await prepareEncryptedMessage({ key: `import-message:${entry.deliverySeq}`, operationId: hashChatContent(["import-message", identity.outboxId, entry.deliverySeq]),
      membership: { chatId: identity.chatId, incarnationId: identity.incarnationId, messageId: hashChatContent(["import-message-id", identity.generationId, entry.deliverySeq]),
        source: "imported", generationId: identity.generationId, seq: entry.deliverySeq, messageRole: entry.role,
        originalCreatedAt: entry.createdAt, timeState: entry.createdAt === null ? "missing" : "valid" },
      publication: { backend: null, turnId: null, completion: entry.completion ?? null, references: [...references.values()] }, plaintext }, files.crypto, checkpoints.messageJournal(), signal);
  } finally { plaintext.fill(0); }
}
export async function stageImportedMessage(input: { entry: ImportedEntry; message: EncryptedMessage; files: Files;
  checkpoints: ChatDeliveryCheckpoints; header: Parameters<EncryptedBlobTransfer["uploadFile"]>[0]; signal: AbortSignal;
  transport: Pick<AccountTransport, "query" | "mutate">; progress?: () => (value: FileProgress) => void }) {
  const { entry, message, files, checkpoints, header, signal, transport } = input;
  const identity = { chatId: message.membership.chatId, incarnationId: message.membership.incarnationId };
  const candidate = { ...identity, bodyHash: message.bodyHash, storage: { kind: "encrypted" as const, message } };
  const parts = message.pages[0]!.metadata.blocks;
  let status = await transport.query("chats/body/api:status", { ...header, chatId: identity.chatId, bodyHash: message.bodyHash }); signal.throwIfAborted();
  if (!status) {
    for (const field of entry.fields) for (const raw of field.chunks) {
      const file = encryptedFileDescriptorSchema.parse(raw);
      await files.uploadFile(header, globalThis.crypto.randomUUID(), "history-generation", file, checkpoints.fileJournal(), file.encryption.operationId, input.progress?.(), signal);
    }
    const journal = checkpoints.messageJournal(), blocks = [];
    for (const part of parts) blocks.push(frozenMessageBlockSchema.parse(await journal.read(`import-message:${entry.deliverySeq}:block:${part.index}`)).block);
    signal.throwIfAborted();
    status = await stageMessageBlocks({ transport, header, blocks, parts, candidate, signal, mismatch: "IMPORT_BLOCK_RECEIPT_CHANGED" });
  } else if (!status.published) status = await stageMessageBlocks({ transport, header, blocks: [], parts: [], candidate, signal, mismatch: "IMPORT_BLOCK_RECEIPT_CHANGED" });
  signal.throwIfAborted();
  if (status.bodyHash !== message.bodyHash || status.state !== "ready" || canonicalJson(status.summary) !== canonicalJson(encryptedMessageSummary(message))) throw new Error("IMPORT_BODY_NOT_READY");
}
