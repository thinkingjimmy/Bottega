/**
 * [INPUT]: Depends on frozen Chat snapshots, logical file transfer and existing attachment/media byte authorities.
 * [OUTPUT]: Projects portable message bodies, reports each attachment transfer's bytes through its own sink, and retains original remote attachment blobs, with fresh encryption only after confirmed reclamation.
 * [POS]: Main content adapter; local provenance is removed only after its bytes have been resolved.
 */
import { ConvexError } from "convex/values";
import { randomUUID } from "node:crypto";
import { canonicalJson, hashBlobSource, type BlobDescriptor, type BlobSource, type BeginBlobUpload, type FileProgress } from "@ai-chat/cloud-protocol";
import { frozenFileIntentSchema, type FrozenFileJournal } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { prepareEncryptedFile } from "@ai-chat/cloud-protocol/blobs/encrypted/client";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import { chatBodySchema, hashChatContent, type ChatBody } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import { chatPartSchema as portablePartSchema } from "@ai-chat/cloud-protocol/chats/content/parts";
import type { AttachmentStore } from "../../../chats/attachment-store";
import type { NativeSnapshot } from "./sources";
type LocalMessage = NativeSnapshot["messages"][number];
type LocalPart = NonNullable<Extract<LocalMessage, { role: "assistant" }>["parts"]>[number];
export type ChatBodyBytePorts = {
  files: Pick<EncryptedBlobTransfer, "uploadFile" | "crypto"> & Partial<Pick<EncryptedBlobTransfer, "reuseFile">>;
  attachments: Pick<AttachmentStore, "read" | "logical"> & Partial<Pick<AttachmentStore, "remoteDescriptor">>;
  media(input: { chatId: string; incarnationId: string; message: LocalMessage; subagentId: string | null;
    part: Extract<LocalPart, { type: "tool" }> }): Promise<{ source: BlobSource; close(): Promise<void> }>;
  /** One sink per transfer, because file progress is cumulative and names no transfer. */
  progress?(): (value: FileProgress) => void;
};
export const memoryBlobSource = (bytes: Uint8Array<ArrayBuffer>, mime: string): BlobSource => ({ bytes: bytes.length, mime,
  read: async (offset, length) => {
    if (offset < 0 || length < 0 || offset + length > bytes.length) throw new Error("CHAT_SOURCE_RANGE_INVALID");
    return bytes.slice(offset, offset + length);
  } });
export async function uploadChatBytes(ports: Pick<ChatBodyBytePorts, "files" | "progress">, header: Omit<BeginBlobUpload, "uploadId" | "owner" | "contentKind" | "descriptor" | "parts">,
  source: BlobSource, chatId: string, identity: unknown, contentKind: BeginBlobUpload["contentKind"], signal: AbortSignal,
  journal: FrozenFileJournal, ownerGeneration: string | null = null) {
  const key = hashChatContent(["chat-file", chatId, identity]);
  const prior = await journal.read(key + ":intent");
  const frozen = prior ? frozenFileIntentSchema.parse(prior) : null;
  const original = frozen?.source ?? { bytes: source.bytes, mime: source.mime, sha256: (await hashBlobSource(source, signal)).sha256 };
  const descriptor = await prepareEncryptedFile({ key, operationId: key,
    owner: { kind: "chat", id: chatId }, ownerGeneration, source: original }, source, ports.files.crypto, journal, signal);
  return ports.files.uploadFile(header, randomUUID(), contentKind, descriptor, journal, key, ports.progress?.(), signal);
}
const portablePart = (part: LocalPart) => {
  if (part.type !== "tool") return portablePartSchema.parse(part);
  const { mediaSource: _source, ...value } = part;
  return portablePartSchema.parse(value);
};
export async function projectNativeBody(snapshot: NativeSnapshot, message: LocalMessage, ports: ChatBodyBytePorts,
  header: Parameters<typeof uploadChatBytes>[1], outboxId: string, signal: AbortSignal, journal: FrozenFileJournal): Promise<ChatBody> {
  return projectChatBody(snapshot, message, ports, (source, identity, kind) => uploadChatBytes(ports, header, source, snapshot.chat.id,
    [outboxId, ...identity], kind, signal, journal), signal, async (id, local) => {
      const descriptor = await ports.attachments.remoteDescriptor?.(id, snapshot.chat.id);
      if (!descriptor || !ports.files.reuseFile || canonicalJson(descriptor.encryption.encryptedSpace) !== canonicalJson(header.encryptedSpace)) return undefined;
      if (descriptor.sha256 !== local.sha256 || descriptor.bytes !== local.bytes || descriptor.mime !== local.mime || descriptor.encryption.owner.kind !== "chat" || descriptor.encryption.owner.id !== snapshot.chat.id) throw new Error("CHAT_ATTACHMENT_CHANGED");
      try { return await ports.files.reuseFile(header, randomUUID(), "chat-attachment", descriptor, signal); }
      catch (error) { if (!(error instanceof ConvexError) || error.data !== "blob-not-ready") throw error; }
      return undefined;
    });
}
export async function projectChatBody(snapshot: NativeSnapshot, message: LocalMessage, ports: Omit<ChatBodyBytePorts, "files">,
  write: (source: BlobSource, identity: unknown[], kind: BeginBlobUpload["contentKind"]) => Promise<BlobDescriptor>, signal: AbortSignal, reuse?: (id: string, local: BlobDescriptor) => Promise<BlobDescriptor | undefined>): Promise<ChatBody> {
  signal.throwIfAborted();
  const attachments: ChatBody["attachments"] = [], media: ChatBody["media"] = [];
  if (message.role === "user") for (const meta of message.attachments ?? []) {
    const descriptor = await ports.attachments.logical(meta.id, snapshot.chat.id), data = await ports.attachments.read(meta.id, snapshot.chat.id);
    const bytes = new Uint8Array(Buffer.from(data.slice(data.indexOf(",") + 1), "base64"));
    if (descriptor.bytes !== meta.byteSize || descriptor.mime !== meta.mediaType || bytes.length !== descriptor.bytes) throw new Error("CHAT_ATTACHMENT_CHANGED");
    let blob: BlobDescriptor;
    try { blob = await reuse?.(meta.id, descriptor) ?? await write(memoryBlobSource(bytes, descriptor.mime), [meta.id, descriptor.sha256], "chat-attachment"); }
    finally { bytes.fill(0); }
    if (blob.sha256 !== descriptor.sha256) throw new Error("CHAT_ATTACHMENT_CHANGED");
    attachments.push({ attachmentId: meta.id, blob });
  }
  const agents: NonNullable<ChatBody["subagents"]> = {};
  const included = new Set<string>();
  const collect = (parts: LocalPart[]) => {
    for (const part of parts) if (part.type === "subagent" && !included.has(part.agentThreadId)) {
      const subagent = snapshot.subagents[part.agentThreadId];
      if (!subagent) throw new Error("CHAT_SUBAGENT_SOURCE_UNAVAILABLE");
      included.add(part.agentThreadId); collect(subagent.parts);
    }
  };
  if (message.role === "assistant") {
    collect(message.parts ?? []);
    // SQLite owns one Chat-wide Subagent lookup. Preserve unreferenced entries once in the final assistant bundle.
    if (snapshot.messages.filter(item => item.role === "assistant").at(-1)?.id === message.id) {
      Object.keys(snapshot.subagents).forEach(id => included.add(id));
    }
    const projectMedia = async (parts: LocalPart[], subagentId: string | null) => {
      for (const part of parts) if (part.type === "tool" && part.tool === "image" && part.status === "completed") {
        const file = await ports.media({ chatId: snapshot.chat.id, incarnationId: snapshot.chat.incarnationId, message, subagentId, part });
        try {
          const blob = await write(file.source, [message.id, subagentId, part.itemId], "gallery");
          media.push({ itemId: part.itemId, subagentId, blob });
        } finally { await file.close(); }
      }
    };
    await projectMedia(message.parts ?? [], null);
    for (const id of included) {
      const agent = snapshot.subagents[id]!;
      await projectMedia(agent.parts, id);
      agents[id] = { meta: agent.meta, parts: agent.parts.map(portablePart) };
    }
  }
  const portableMessage = projectPortableMessage(message.role === "assistant" ? {
    ...message, ...(message.parts ? { parts: message.parts.map(portablePart) } : {}),
  } : message);
  return chatBodySchema.parse({ version: 1, message: portableMessage, attachments, media,
    ...(included.size ? { subagents: agents } : {}) });
}
export const bodyBytes = (body: ChatBody) => new TextEncoder().encode(canonicalJson(chatBodySchema.parse(body)));
