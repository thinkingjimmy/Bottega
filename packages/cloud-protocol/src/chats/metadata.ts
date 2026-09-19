/**
 * [INPUT]: Depends on portable Chat facts and deterministic JSON/hash primitives.
 * [OUTPUT]: Provides closed initial/metadata commands, immutable receipts and stable payload hashes.
 * [POS]: Ordinary metadata (title, archive, manual sortKey) cannot change classification, Agent options or execution ownership.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { canonicalJson } from "../encryption/encoding";
import { versionSchema as rev } from "../scalars";
import { hashBytes } from "../blobs/transfer";
import { chatSortKeySchema, cloudChatHeadSchema, portableChatSchema } from "./model";
export const chatMetadataPatchSchema = z.object({ title: portableChatSchema.shape.title.optional(), archivedAt: rev.nullable().optional(),
  sortKey: chatSortKeySchema.nullable().optional() }).strict().refine(value => Object.keys(value).length > 0, "Empty metadata patch");
export const chatMetadataOperationSchema = z.object({ operationId: id, chatId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  command: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("create"), chat: portableChatSchema, lifecycleKind: cloudChatHeadSchema.shape.kind, archivedAt: rev.nullable() }).strict(),
    z.object({ kind: z.literal("patch"), incarnationId: id, expectedRevision: rev, changes: chatMetadataPatchSchema }).strict(),
  ]),
}).strict().refine(value => value.command.kind !== "create" || value.chatId === value.command.chat.id && value.command.chat.cloudRevision === 0);
export type ChatMetadataOperation = z.infer<typeof chatMetadataOperationSchema>;
export const chatMetadataReceiptSchema = z.object({ operationId: id, chatId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["applied", "converged", "conflicted", "deleted"]), head: cloudChatHeadSchema.nullable(), sourceDeviceId: id, createdAt: rev,
}).strict().refine(value => (value.status === "deleted") === (value.head === null));
export type ChatMetadataReceipt = z.infer<typeof chatMetadataReceiptSchema>;
export function hashChatMetadataOperation(operation: ChatMetadataOperation) {
  const { payloadHash: _hash, ...content } = chatMetadataOperationSchema.parse(operation);
  return hashBytes(new TextEncoder().encode(canonicalJson(content)));
}
