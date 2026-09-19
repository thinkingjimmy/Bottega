/**
 * [INPUT]: Depends on canonical native attachment metadata, scoped logical references and existing byte owners.
 * [OUTPUT]: Restores exact attachment identities without replacing divergent local bytes.
 * [POS]: Execution preparation file handoff; only the existing AttachmentStore publishes native files.
 */
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { hashBytes, MAX_PART_BYTES } from "@ai-chat/cloud-protocol";
import type { ChatStore } from "../../chats/chat-store";
import type { AttachmentStore } from "../../chats/attachment-store";
import { ATTACHMENT_BYTE_LIMIT } from "../../../../shared/agent-ipc";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
import { localBlobSource, type DesktopBlobStore } from "../files/store";
export async function restoreExecutionAttachments(input: { chats: ChatStore; attachments: AttachmentStore; files: DesktopBlobStore; scope: SyncScope;
  chatId: string; current(): Promise<void>; signal: AbortSignal }) {
  const record = await input.chats.get(input.chatId);
  if (!record) throw new Error("EXECUTION_CONTENT_UNAVAILABLE");
  const restored = new Map<string, string>();
  for (const message of record.messages) if (message.role === "user" && message.attachments?.length) {
    const result = await input.chats.sync.read(input.scope, { type: "mirror-files", chatId: record.id, messageId: message.id });
    if (result.type !== "mirror-files") throw new Error("CHAT_ATTACHMENT_UNAVAILABLE");
    for (const meta of message.attachments) {
      const raw = result.value.attachments.find(item => item.attachmentId === meta.id)?.blob;
      const descriptor = raw ? encryptedFileDescriptorSchema.parse(raw) : null;
      if (!descriptor || descriptor.bytes !== meta.byteSize || descriptor.mime !== meta.mediaType || descriptor.bytes > ATTACHMENT_BYTE_LIMIT) throw new Error("CHAT_ATTACHMENT_UNAVAILABLE");
      if (restored.has(meta.id)) {
        if (restored.get(meta.id) !== descriptor.sha256) throw new Error("CHAT_ATTACHMENT_IDENTITY_CHANGED");
        continue;
      }
      input.signal.throwIfAborted(); await input.current();
      const file = await input.files.read(descriptor, { kind: "chat", id: record.id }, input.signal);
      const local = await localBlobSource(file.path, descriptor.mime);
      try {
        const chunks: Uint8Array[] = [];
        for (let offset = 0; offset < descriptor.bytes; offset += MAX_PART_BYTES) {
          input.signal.throwIfAborted(); chunks.push(await local.source.read(offset, Math.min(MAX_PART_BYTES, descriptor.bytes - offset)));
        }
        const bytes = Buffer.concat(chunks);
        if (bytes.length !== descriptor.bytes || hashBytes(bytes) !== descriptor.sha256) throw new Error("CHAT_ATTACHMENT_IDENTITY_CHANGED");
        await input.current();
        const payload = { filename: meta.filename, mediaType: meta.mediaType,
          dataUrl: `data:${meta.mediaType};base64,${bytes.toString("base64")}`,
          remote: { attachmentId: meta.id, filename: meta.filename, kind: meta.mediaType.startsWith("image/") ? "image" as const : "file" as const, blob: descriptor } };
        const [actual] = await input.attachments.persist([payload], [meta.id], record.id);
        if (actual?.id !== meta.id || actual.byteSize !== meta.byteSize) throw new Error("CHAT_ATTACHMENT_IDENTITY_CHANGED");
        restored.set(meta.id, descriptor.sha256);
      } finally { await local.close(); }
    }
  }
  return restored.size;
}
