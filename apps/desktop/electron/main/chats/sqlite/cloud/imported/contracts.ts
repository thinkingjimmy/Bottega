/**
 * [INPUT]: Depends on immutable public import descriptors and bounded local storage identities.
 * [OUTPUT]: Defines generation checkpoints, field delivery commands and confirmed imported pages.
 * [POS]: Main-to-worker import delivery contract; source paths and local execution authority have no representation.
 */
import { z } from "zod";
import { importedEntrySchema, importStatusSchema } from "@ai-chat/cloud-protocol/chats/imported/model";
import { storageIdSchema as id, storageRevisionSchema as rev } from "../../../../../../shared/local-storage/contracts";
export const importDownloadSchema = z.object({ status: importStatusSchema, localGenerationId: id, bodyRevision: rev,
  beforeSeq: rev.positive().nullable(), receivedCount: rev, complete: z.boolean() }).strict();
export type ImportDownload = z.infer<typeof importDownloadSchema>;
const entryScope = { chatId: id, generationId: id, entry: importedEntrySchema };
export const importDeliveryActions = [
  z.object({ type: z.literal("begin-import-download"), chatId: id, bodyRevision: rev, status: importStatusSchema }).strict(),
  z.object({ type: z.literal("begin-import-entry"), ...entryScope }).strict(),
  z.object({ type: z.literal("write-import-field"), ...entryScope, field: z.string().max(32), ordinal: rev,
    content: z.string().max(128 * 1024).refine(value => new TextEncoder().encode(value).byteLength <= 128 * 1024) }).strict(),
  z.object({ type: z.literal("commit-import-entry"), ...entryScope, beforeSeq: rev.positive().nullable() }).strict(),
  z.object({ type: z.literal("complete-import-download"), chatId: id, generationId: id }).strict(),
] as const;
export const importPageSchema = z.object({ state: importDownloadSchema.nullable(), entries: z.array(importedEntrySchema).max(50),
  cursor: rev.positive().nullable(), complete: z.boolean() }).strict();
