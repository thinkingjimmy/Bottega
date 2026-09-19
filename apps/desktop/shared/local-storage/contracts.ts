/**
 * [INPUT]: Depends on Zod and canonical public Chat classification, portable facts, completion and settlement codecs.
 * [OUTPUT]: Provides strict runtime/fixture scope modes, portable classification, blob, mirror and turn receipt contracts.
 * [POS]: Shared storage boundary; none of these facts grants local execution authority.
 */
import { z } from "zod";
import { classificationSchema, type ChatClassification } from "@ai-chat/cloud-protocol/chats/model";
export { classificationSchema, portableChatSchema, type ChatClassification, type PortableChat } from "@ai-chat/cloud-protocol/chats/model";

export const storageIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const storageHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const storageRevisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const syncScopeSchema = z.object({
  environment: storageIdSchema,
  userId: storageIdSchema,
}).strict();
export type SyncScope = z.infer<typeof syncScopeSchema>;
const localStorageModeSchema = z.object({ kind: z.literal("local-only") }).strict();
const syncStorageModeSchema = z.object({
  kind: z.literal("sync"), scope: syncScopeSchema, enrollment: z.enum(["open", "closed"]),
}).strict();
export const runtimeStorageModeSchema = z.discriminatedUnion("kind", [localStorageModeSchema, syncStorageModeSchema]);
export type RuntimeStorageMode = z.infer<typeof runtimeStorageModeSchema>;
export const storageModeSchema = z.discriminatedUnion("kind", [
  localStorageModeSchema,
  syncStorageModeSchema,
  z.object({ kind: z.literal("fixture"), scope: syncScopeSchema }).strict(),
  z.object({ kind: z.literal("snapshot-initialization"), scope: syncScopeSchema }).strict(),
]);
export type StorageMode = z.infer<typeof storageModeSchema>;
export function projectChatClassification(record: {
  projectId: string | null;
  context: { kind: "ordinary" } | { kind: "app-use"; appId: string } |
    { kind: "app-edit"; appId: string; projectId: string };
}): ChatClassification {
  const context = record.context;
  if (context.kind === "app-edit" && context.projectId !== record.projectId) {
    throw new Error("Chat context and Project membership disagree");
  }
  return classificationSchema.parse({
    conversationKind: context.kind,
    appId: context.kind === "ordinary" ? null : context.appId,
    projectId: record.projectId,
  });
}
export const logicalBlobSchema = z.object({
  blobId: z.string().regex(/^[A-Za-z0-9_.-]{1,192}$/),
  sha256: storageHashSchema,
  bytes: storageRevisionSchema,
  mime: z.string().min(1).max(128),
}).strict();
export type LogicalBlob = z.infer<typeof logicalBlobSchema>;
export { completionFields, completionMetadataSchema, turnReceiptSchema, type CompletionMetadata, type CloudTurnReceipt }
  from "@ai-chat/cloud-protocol/chats/content/completion";
export function sameScope(left: SyncScope | null, right: SyncScope | null) {
  return Boolean(left && right && left.environment === right.environment && left.userId === right.userId);
}
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    const result = JSON.stringify(value);
    if (result === undefined) throw new Error("Storage values must be JSON");
    return result;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) =>
      `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
}
