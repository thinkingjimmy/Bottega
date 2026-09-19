/**
 * [INPUT]: Depends on verified canonical body pages, authenticated file transfer and the selected folder's byte owners.
 * [OUTPUT]: Completes portable attachments and historical artifacts without retaining attachment originals in the private cache.
 * [POS]: Background mirror materialization; no local execution or workspace grant is created.
 */
import { encryptedFileDescriptorSchema, type EncryptedFileDescriptor, type FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import type { ChatSyncStore } from "../../cloud/sync/chats/sources";
import { LibraryAttachments } from "./attachments";
import { artifactRuntime } from "../../artifacts/runtime";
import { messageArtifactFences } from "../../artifacts/service";
import { ATTACHMENT_BYTE_LIMIT } from "../../../../shared/agent-ipc";
import type { ChatAttachmentMeta } from "../../../../shared/chats-ipc";
type Transfer = { root: () => string | null; files: Pick<EncryptedBlobTransfer, "readFile">; crypto(): FileCipherPort; current(): void; signal: AbortSignal };

export async function hydrateLibraryAttachment(input: Transfer, chatId: string, meta: ChatAttachmentMeta, descriptor: EncryptedFileDescriptor) {
  const attachments = new LibraryAttachments(input.root);
  if (descriptor.bytes > ATTACHMENT_BYTE_LIMIT || descriptor.bytes !== meta.byteSize || descriptor.mime !== meta.mediaType) throw new Error("LIBRARY_ATTACHMENT_IDENTITY_CHANGED");
  const existing = await attachments.read(meta.id, chatId).catch(error => {
    if (!(error instanceof Error) || error.message !== "ATTACHMENT_MISSING") throw error; return null;
  });
  if (existing) {
    if (existing.blob.sha256 !== descriptor.sha256) throw new Error("LIBRARY_ATTACHMENT_IDENTITY_CHANGED");
    return existing;
  }
  const chunks: Uint8Array[] = [];
  try {
    await input.files.readFile(descriptor, input.crypto(), {
      write: async bytes => { input.current(); chunks.push(Uint8Array.from(bytes)); },
      commit: async () => {
        input.current(); input.signal.throwIfAborted();
        await attachments.persist([{ filename: meta.filename, mediaType: meta.mediaType,
          dataUrl: `data:${meta.mediaType};base64,${Buffer.concat(chunks).toString("base64")}` }], [meta.id], chatId);
      }, abort: async () => {},
    }, undefined, input.signal);
  } finally { chunks.forEach(bytes => bytes.fill(0)); }
  return attachments.read(meta.id, chatId);
}

export async function readLibraryCloudAttachment(input: Transfer & { store: ChatSyncStore; scope: SyncScope; head: CloudChatHead }, descriptor: EncryptedFileDescriptor) {
  let beforeSeq: number | null = null;
  for (;;) {
    input.current(); input.signal.throwIfAborted();
    const page = await input.store.read(input.scope, { type: "confirmed-body-page", chatId: input.head.chat.id, revision: input.head.bodyRevision, beforeSeq, limit: 50 });
    if (page.type !== "confirmed-body-page" || !page.value.ready) throw new Error("LIBRARY_REMOTE_BODY_UNAVAILABLE");
    for (const body of page.value.messages) {
      const ref = body.attachments.find(item => item.blob.blobId === descriptor.blobId);
      const meta = body.message.role === "user" && body.message.attachments?.find(item => item.id === ref?.attachmentId);
      if (meta && ref) {
        const verified = encryptedFileDescriptorSchema.parse(ref.blob);
        if (verified.sha256 !== descriptor.sha256 || verified.bytes !== descriptor.bytes || verified.mime !== descriptor.mime) throw new Error("LIBRARY_ATTACHMENT_IDENTITY_CHANGED");
        const result = await hydrateLibraryAttachment(input, input.head.chat.id, meta, verified);
        const bytes = Buffer.from(result.dataUrl.slice(result.dataUrl.indexOf(",") + 1), "base64");
        return { bytes: bytes.length, mime: verified.mime, read: async (offset: number, length: number) => new Uint8Array(bytes.subarray(offset, offset + length)) };
      }
    }
    if (page.value.complete) throw new Error("ATTACHMENT_MISSING");
    if (!page.value.cursor || page.value.cursor === beforeSeq) throw new Error("LIBRARY_REMOTE_CURSOR_INVALID");
    beforeSeq = page.value.cursor;
  }
}

export async function hydrateLibraryFiles(input: { root: () => string | null; store: ChatSyncStore; scope: SyncScope; head: CloudChatHead;
  files: Pick<EncryptedBlobTransfer, "readFile">; crypto(): FileCipherPort; current(): void; signal: AbortSignal }) {
  if (!input.root()) return;
  const { head } = input;
  let beforeSeq: number | null = null;
  for (;;) {
    input.current(); input.signal.throwIfAborted();
    const page = await input.store.read(input.scope, { type: "confirmed-body-page", chatId: head.chat.id, revision: head.bodyRevision, beforeSeq, limit: 50 });
    if (page.type !== "confirmed-body-page" || !page.value.ready) throw new Error("LIBRARY_REMOTE_BODY_UNAVAILABLE");
    for (const body of page.value.messages) {
      if (body.message.role === "user") for (const meta of body.message.attachments ?? []) {
        const raw = body.attachments.find(item => item.attachmentId === meta.id)?.blob;
        const descriptor = encryptedFileDescriptorSchema.parse(raw);
        await hydrateLibraryAttachment(input, head.chat.id, meta, descriptor);
      }
      const artifacts = artifactRuntime();
      if (artifacts) for (const fence of messageArtifactFences(body.message, body.subagents)) {
        input.current(); input.signal.throwIfAborted();
        await artifacts.resolve({ chatId: head.chat.id, incarnationId: head.chat.incarnationId, artifactId: fence.id });
      }
    }
    if (page.value.complete) return;
    if (!page.value.cursor || page.value.cursor === beforeSeq) throw new Error("LIBRARY_REMOTE_CURSOR_INVALID");
    beforeSeq = page.value.cursor;
  }
}
