/**
 * [INPUT]: Depends on ChatStore's sole sync facade, retained source hashes and strict local Chat codecs.
 * [OUTPUT]: Reconstructs bounded immutable source payloads, resolves an outbox item's validated Chat identity and validates frozen initialization snapshots.
 * [POS]: Main upload source reader; no mutable aggregate or SQLite locator crosses the network boundary.
 */
import { z } from "zod";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { canonicalJson, hashBytes } from "@ai-chat/cloud-protocol";
import { cloudChatHeadSchema, portableChatSchema } from "@ai-chat/cloud-protocol/chats/model";
import { messageSchema, subagentsSchema, chatRecordSchema } from "../../../chats/chat-schema";
import type { ChatSyncApi } from "../../../chats/store/sync/api";
import type { CloudResult } from "../../../chats/sqlite/cloud/protocol";
import { retainedSourceRefSchema } from "../../../chats/sqlite/cloud/delivery/contracts";

export type ChatSyncStore = Pick<ChatSyncApi, "read" | "mutate">;
export type ChatOutboxItem = Extract<CloudResult, { type: "outbox" }>["value"][number];
export type SourceRef = z.infer<typeof retainedSourceRefSchema>;
const outboxManifest = z.object({ version: z.literal(1), chatId: z.string(), sources: z.tuple([retainedSourceRefSchema]) }).strict();
export const chatIdOf = (item: ChatOutboxItem) => outboxManifest.parse(JSON.parse(item.payload_json)).chatId;
const chunkManifest = z.object({ encoding: z.literal("canonical-json-chunks-v1"), contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  bytes: z.number().int().nonnegative(), sources: z.array(retainedSourceRefSchema) }).strict();
const chunkPayload = z.object({ ordinal: z.number().int().nonnegative(), text: z.string().max(256 * 1024) }).strict();
export async function readChatSource(store: ChatSyncStore, scope: SyncScope, reference: SourceRef): Promise<unknown> {
  const result = await store.read(scope, { type: "source", sourceId: reference.sourceId });
  if (result.type !== "source" || !result.value || result.value.digest !== reference.digest ||
    hashChatContent(result.value.payload) !== reference.digest) throw new Error("CHAT_SOURCE_UNAVAILABLE_OR_CHANGED");
  const manifest = chunkManifest.safeParse(result.value.payload);
  if (!manifest.success) return result.value.payload;
  const parts: string[] = []; let bytes = 0;
  for (const [ordinal, ref] of manifest.data.sources.entries()) {
    const part = await store.read(scope, { type: "source", sourceId: ref.sourceId });
    if (part.type !== "source" || !part.value || part.value.digest !== ref.digest || hashChatContent(part.value.payload) !== ref.digest) throw new Error("CHAT_SOURCE_CHUNK_CHANGED");
    const chunk = chunkPayload.parse(part.value.payload);
    if (chunk.ordinal !== ordinal) throw new Error("CHAT_SOURCE_CHUNK_ORDER");
    parts.push(chunk.text); bytes += Buffer.byteLength(chunk.text);
    // Adjacent chunks may split a surrogate pair; the final exact byte count is authoritative.
    if (bytes > manifest.data.bytes + manifest.data.sources.length * 6) throw new Error("CHAT_SOURCE_BUDGET");
  }
  const text = parts.join("");
  if (Buffer.byteLength(text) !== manifest.data.bytes || hashBytes(new TextEncoder().encode(text)) !== manifest.data.contentDigest) throw new Error("CHAT_SOURCE_CONTENT_CHANGED");
  const value: unknown = JSON.parse(text);
  if (canonicalJson(value) !== text) throw new Error("CHAT_SOURCE_NONCANONICAL");
  return value;
}
export const nativeSnapshotSchema = z.object({ chat: portableChatSchema, lifecycleKind: cloudChatHeadSchema.shape.kind,
  archivedAt: cloudChatHeadSchema.shape.archivedAt, nextSeq: z.number().int().positive(), lastCommittedUserSeq: z.number().int().positive().nullable(),
  messages: z.array(messageSchema), subagents: subagentsSchema,
  branches: chatRecordSchema.shape.supersededBranches, imported: z.json().nullable().optional(),
}).strict().superRefine((snapshot, ctx) => {
  let seq = 0; const ids = new Set<string>();
  for (const message of snapshot.messages) {
    if (message.segment || message.seq <= seq || message.seq >= snapshot.nextSeq || ids.has(message.id)) ctx.addIssue({ code: "custom", message: "Invalid frozen native sequence" });
    seq = message.seq; ids.add(message.id);
  }
  if (snapshot.lastCommittedUserSeq !== null && !snapshot.messages.some(message => message.role === "user" && message.seq === snapshot.lastCommittedUserSeq)) {
    ctx.addIssue({ code: "custom", message: "Invalid frozen local user baseline" });
  }
});
export type NativeSnapshot = z.infer<typeof nativeSnapshotSchema>;
export async function readOutboxSource(store: ChatSyncStore, scope: SyncScope, item: ChatOutboxItem) {
  if (item.environment !== scope.environment || item.user_id !== scope.userId) throw new Error("SYNC_SCOPE_UNAVAILABLE");
  if (hashBytes(new TextEncoder().encode(item.payload_json)) !== item.payload_digest) throw new Error("OUTBOX_CONTENT_CHANGED");
  const manifest = outboxManifest.parse(JSON.parse(item.payload_json));
  return { chatId: manifest.chatId, payload: await readChatSource(store, scope, manifest.sources[0]) };
}
export async function readNativeSnapshot(store: ChatSyncStore, scope: SyncScope, item: ChatOutboxItem) {
  const source = await readOutboxSource(store, scope, item), snapshot = nativeSnapshotSchema.parse(source.payload);
  if (snapshot.chat.id !== source.chatId || snapshot.chat.cloudRevision !== 0) throw new Error("INITIAL_SOURCE_IDENTITY_INVALID");
  return snapshot;
}
