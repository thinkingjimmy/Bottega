/**
 * [INPUT]: Original Chat body/hash checkpoints, admitted content crypto and bounded ciphertext staging calls.
 * [OUTPUT]: Freezes and stages exact message blocks, recovering a prepared body through its status first, and returns a ciphertext identity beside the original plaintext hash, its exact plaintext byte count and whether an earlier attempt had already delivered it. Its file re-claims move no bytes; the projection that first uploaded them reports those. Also provides the shared one-round-trip block/candidate batch its import sibling stages with.
 * [POS]: Shared native/live publication leaf; the existing Chat outbox owns all retries and retention.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { frozenMessageBlockSchema, encryptedMessageSummary, MESSAGE_CIPHER_LIMITS,
  type EncryptedMessage, type EncryptedMessageBlock } from "@ai-chat/cloud-protocol/chats/encrypted/messages";
import { ciphertextFileDescriptor } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { prepareEncryptedMessage } from "@ai-chat/cloud-protocol/chats/encrypted/messages/client";
import { hashChatContent, type ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { AccountTransport } from "../../runtime/transport";
import type { ChatDeliveryCheckpoints } from "./checkpoints";
import { bodyBytes, type uploadChatBytes, type ChatBodyBytePorts } from "./bodies";
type StageHeader = Parameters<typeof uploadChatBytes>[1];
type BodyCandidate = { chatId: string; incarnationId: string; bodyHash: string; storage: { kind: "encrypted"; message: EncryptedMessage } };
/* One message, one round trip: its blocks ride with the candidate that references them, and only a message larger than
   the batch bound costs a second call. Admission stays per block and per body, so a retried split re-admits what the
   server already holds instead of accepting it twice. */
export async function stageMessageBlocks(input: { transport: Pick<AccountTransport, "mutate">; header: StageHeader;
  blocks: readonly EncryptedMessageBlock[]; parts: readonly { blockId: string; ciphertextHash: string }[];
  candidate: BodyCandidate; signal: AbortSignal; mismatch: string }) {
  const { transport, header, blocks, parts, candidate, signal, mismatch } = input;
  const identity = { chatId: candidate.chatId, incarnationId: candidate.incarnationId };
  for (let offset = 0; ; ) {
    let count = 0, bytes = 0;
    while (offset + count < blocks.length) {
      const next = blocks[offset + count]!;
      if (count && bytes + next.ciphertextBytes > MESSAGE_CIPHER_LIMITS.stageBatchBytes) break;
      bytes += next.ciphertextBytes; count++;
    }
    const final = offset + count === blocks.length;
    const accepted = await transport.mutate("chats/body/api:stageBlocks", { ...header, ...identity,
      blocks: blocks.slice(offset, offset + count), candidate: final ? candidate : null });
    signal.throwIfAborted();
    if (accepted.blocks.length !== count) throw new Error(mismatch);
    for (const [index, receipt] of accepted.blocks.entries()) {
      const part = parts[offset + index]!;
      if (receipt.blockId !== part.blockId || receipt.ciphertextHash !== part.ciphertextHash) throw new Error(mismatch);
    }
    offset += count;
    if (final) { if (!accepted.status) throw new Error(mismatch); return accepted.status; }
  }
}
export async function stageChatBody(input: {
  checkpoints: ChatDeliveryCheckpoints; body: ChatBody; bodyHash: string;
  identity: { chatId: string; incarnationId: string; }; outboxId: string;
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
  const plaintext = bodyBytes(body), plaintextBytes = plaintext.byteLength;
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
  /* A body the backend already holds was delivered by an earlier attempt, so this one uploads nothing for it;
     counting those bytes again would push a retried pass past its own total. */
  const reused = Boolean(status);
  const parts = frozen.message.pages.flatMap(page => page.metadata.blocks);
  if (!status) {
    for (const item of [...body.attachments, ...body.media]) {
      const descriptor = encryptedFileDescriptorSchema.parse(item.blob);
      await bytes.files.uploadFile(header, globalThis.crypto.randomUUID(), "attachmentId" in item ? "chat-attachment" : "gallery",
        descriptor, checkpoints.fileJournal(), descriptor.encryption.operationId, undefined, signal);
    }
    const blocks = [];
    for (const part of parts) blocks.push(frozenMessageBlockSchema.parse(await journal.read(`${key}:block:${part.index}`)).block);
    signal.throwIfAborted();
    status = await stageMessageBlocks({ transport, header, blocks, parts, candidate, signal, mismatch: "CHAT_BODY_BLOCK_RECEIPT_CHANGED" });
  } else if (!status.published) status = await stageMessageBlocks({ transport, header, blocks: [], parts: [], candidate, signal, mismatch: "CHAT_BODY_BLOCK_RECEIPT_CHANGED" });
  signal.throwIfAborted();
  if (status.bodyHash !== candidate.bodyHash || status.state !== "ready" || canonicalJson(status.summary) !== canonicalJson(encryptedMessageSummary(frozen.message))) throw new Error("CHAT_BODY_NOT_READY");
  return { plaintextHash: bodyHash, ciphertextHash: candidate.bodyHash, storage: candidate.storage, plaintextBytes, reused };
}
