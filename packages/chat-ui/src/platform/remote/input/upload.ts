/**
 * [INPUT]: Scoped encrypted file transfer, bounded browser files and immutable in-memory journal records.
 * [OUTPUT]: RemoteAttachmentPort stages mixed files with exact retry identities and progress.
 * [POS]: Shared upload adapter for Web and main-owned desktop mirror transfers.
 */
import { hashBlobSource, type FileProgress } from "@ai-chat/cloud-protocol";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { EncryptedBusinessHeader } from "@ai-chat/cloud-protocol/spaces";
import type { FrozenFileRecord } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { REMOTE_ATTACHMENT_BYTES, REMOTE_IMAGE_TYPES, remoteAttachmentSchema, type RemoteAttachment } from "@ai-chat/cloud-protocol/remote/input/model";
export interface RemoteAttachmentPort {
  stage(input: { chatId: string; attachmentId: string; uploadId: string; file: File }, signal: AbortSignal, progress: (value: FileProgress) => void): Promise<RemoteAttachment>;
}
export function assertRemoteFile(file: Pick<File, "size" | "type" | "name">) {
  if (!file.size || file.size > REMOTE_ATTACHMENT_BYTES) throw new Error("attachment-size");
  if (!file.name || new TextEncoder().encode(file.name).length > 255 || /[\p{Cc}/\\]/u.test(file.name)) throw new Error("attachment-name");
  if (file.type.startsWith("image/") && !REMOTE_IMAGE_TYPES.includes(file.type as typeof REMOTE_IMAGE_TYPES[number])) throw new Error("attachment-type");
}
export function remoteAttachmentUploader(transfer: EncryptedBlobTransfer, header: () => EncryptedBusinessHeader, lifetime: AbortSignal): RemoteAttachmentPort {
  const records = new Map<string, FrozenFileRecord>(), ready = new Map<string, RemoteAttachment>();
  lifetime.addEventListener("abort", () => { records.clear(); ready.clear(); }, { once: true });
  const journal = {
    read: async (key: string) => records.get(key) ?? null,
    write: async (key: string, value: FrozenFileRecord) => { lifetime.throwIfAborted(); const prior = records.get(key); if (prior) return prior; records.set(key, value); return value; },
  };
  return { stage: async ({ chatId, file, attachmentId, uploadId }, external, progress) => {
    const signal = AbortSignal.any([lifetime, external]); signal.throwIfAborted(); assertRemoteFile(file);
    const mime = file.type || "application/octet-stream", source = { bytes: file.size, mime,
      read: async (offset: number, size: number) => new Uint8Array(await file.slice(offset, offset + size).arrayBuffer()) };
    const hashes = await hashBlobSource(source, signal, progress), key = hashChatContent([chatId, uploadId]);
    const completed = ready.get(key);
    if (completed) {
      if (completed.attachmentId !== attachmentId || completed.filename !== file.name || completed.blob.sha256 !== hashes.sha256 || completed.blob.bytes !== file.size || completed.blob.mime !== mime) throw new Error("attachment-changed");
      return completed;
    }
    const descriptor = await prepareEncryptedFile({ key, operationId: key, owner: { kind: "chat", id: chatId }, ownerGeneration: null,
      source: { bytes: file.size, mime, sha256: hashes.sha256 } }, source, transfer.crypto, journal, signal);
    const blob = await transfer.uploadFile(header(), uploadId, "chat-attachment", descriptor, journal, key, progress, signal);
    signal.throwIfAborted();
    const attachment = remoteAttachmentSchema.parse({ attachmentId, filename: file.name, kind: mime.startsWith("image/") ? "image" : "file", blob });
    ready.set(key, attachment);
    // A successful transfer needs only its original descriptor for a lost-response retry.
    for (const [recordKey, record] of records) if (record.key === key) records.delete(recordKey);
    return attachment;
  } };
}
