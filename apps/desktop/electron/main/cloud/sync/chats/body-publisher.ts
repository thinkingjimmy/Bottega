/**
 * [INPUT]: Original Chat body/hash checkpoints, admitted content crypto and bounded ciphertext staging calls.
 * [OUTPUT]: Freezes and stages exact message blocks, recovering a prepared body through its status first, and returns a ciphertext identity beside the original plaintext hash.
 * [POS]: Shared native/live publication leaf; the existing Chat outbox owns all retries and retention.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { frozenMessageBlockSchema, encryptedMessageSummary } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import { ciphertextFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { prepareEncryptedMessage } from "@ai-chat/cloud-protocol/chats/encrypted/messages/client";
import { hashChatContent, type ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { AccountTransport } from "../../runtime/transport";
import type { ChatDeliveryCheckpoints } from "./checkpoints";
import { bodyBytes, type uploadChatBytes, type ChatBodyBytePorts } from "./bodies";
export async function stageChatBody(input: {
  checkpoints: ChatDeliveryCheckpoints; body: ChatBody; bodyHash: string;
  identity: { chatId: string; incarnationId: string; executionEpoch: number }; outboxId: string;
  bytes: ChatBodyBytePorts; header: Parameters<typeof uploadChatBytes>[1]; signal: AbortSignal;
  transport: Pick<AccountTransport, "query" | "mutate">;
}) {
  const { checkpoints, body, bodyHash, identity, outboxId, bytes, header, signal, transport } = input;
  if (hashChatContent(body) !== bodyHash || body.message.segment !== undefined) throw new Error("CHAT_BODY_SOURCE_CHANGED");
  const message = body.message, journal = checkpoints.messageJournal(), key = `message:${bodyHash}`;
  const references = new Map([...body.attachments, ...body.media].map(item => {
    const descriptor = encryptedFileDescriptorSchema.parse(item.blob);
    if (descriptor.encryption.owner.kind !== "chat" || descriptor.encryption.owner.id !== identity.chatId || descriptor.encryption.ownerGeneration !== null) throw new Error("CHAT_FILE_OWNER_CHANGED");
    return [descriptor.blobId, ciphertextFileDescriptor(descriptor)] as const;
  }));
  // A completed message record that predates this attempt is the only evidence that the stage may already have been received.
  const attempted = Boolean(await journal.read(`${key}:complete`));
  const plaintext = bodyBytes(body);
  let frozen: Awaited<ReturnType<typeof prepareEncryptedMessage>>;
  try {
    frozen = await prepareEncryptedMessage({ key, operationId: hashChatContent(["message", outboxId, message.id]),
      membership: { chatId: identity.chatId, incarnationId: identity.incarnationId, messageId: message.id, source: "native", generationId: null,
        seq: message.seq, messageRole: message.role === "notice" ? "system" : message.role, originalCreatedAt: message.createdAt, timeState: "valid" },
      publication: { backend: message.role === "assistant" ? message.backend : null, turnId: message.role === "assistant" ? message.turnId ?? null : null,
        completion: message.role === "assistant" ? message.completion ?? null : null, references: [...references.values()] },
      plaintext, priority: "background" }, bytes.files.crypto, journal, signal);
  } finally { plaintext.fill(0); }
  if (frozen.plaintextHash !== bodyHash) throw new Error("CHAT_BODY_HASH_PAIR_CHANGED");
  const candidate = { ...identity, bodyHash: frozen.message.bodyHash, storage: { kind: "encrypted" as const, message: frozen.message } };
  // `stage` is receipt-idempotent and refuses an incomplete body, so a first attempt can stage straight away.
  let status = attempted ? await transport.query("chats/body/api:status", { ...header, chatId: identity.chatId, bodyHash: candidate.bodyHash }) : null;
  signal.throwIfAborted();
  if (!status) {
    for (const item of [...body.attachments, ...body.media]) {
      const descriptor = encryptedFileDescriptorSchema.parse(item.blob);
      await bytes.files.uploadFile(header, globalThis.crypto.randomUUID(), "attachmentId" in item ? "chat-attachment" : "gallery",
        descriptor, checkpoints.fileJournal(), descriptor.encryption.operationId, undefined, signal);
    }
    for (const page of frozen.message.pages) for (const part of page.metadata.blocks) {
      const record = frozenMessageBlockSchema.parse(await journal.read(`${key}:block:${part.index}`));
      const accepted = await transport.mutate("chats/body/api:stageBlock", { ...header, ...identity, block: record.block });
      signal.throwIfAborted();
      if (accepted.blockId !== part.blockId || accepted.ciphertextHash !== part.ciphertextHash) throw new Error("CHAT_BODY_BLOCK_RECEIPT_CHANGED");
    }
  }
  if (!status?.published) status = await transport.mutate("chats/body/api:stage", { ...header, candidate });
  signal.throwIfAborted();
  if (status.bodyHash !== candidate.bodyHash || status.state !== "ready" || canonicalJson(status.summary) !== canonicalJson(encryptedMessageSummary(frozen.message))) throw new Error("CHAT_BODY_NOT_READY");
  return { plaintextHash: bodyHash, ciphertextHash: candidate.bodyHash, storage: candidate.storage };
}
