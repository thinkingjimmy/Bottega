/**
 * [INPUT]: Depends on logical blob descriptors, public identities and portable completion semantics.
 * [OUTPUT]: Defines immutable imported entries, their per-entry chunk budget with the folded-tool marker, individual/packed field content and ordered generation publication.
 * [POS]: Private client import contract; its content hashes and file manifests never enter clear cloud metadata.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../../auth";
import { blobDescriptorSchema, sha256Schema as hash } from "../../blobs";
import { encryptedFileDescriptorSchema } from "../../blobs/encrypted/model";
import { versionSchema as rev } from "../../scalars";
import { agentBackendIdSchema } from "../options";
import { completionFields } from "../content/completion";
import { hashChatContent } from "../transcript/body";
// One entry may span this many logical files across all of its fields; an importer that would exceed it folds its trailing tool outputs away.
export const IMPORT_ENTRY_CHUNK_BUDGET = 256;
export const importFieldSchema = z.object({ field: z.string().regex(/^(content|tools|process|(tool|process|part)-[0-9]{1,6})$/),
  encoding: z.enum(["text", "json"]), bytes: rev.max(512_000_000), sha256: hash, chunks: z.array(z.union([encryptedFileDescriptorSchema, blobDescriptorSchema])).min(1).max(64),
}).strict().refine(value => value.chunks.reduce((sum, blob) => sum + blob.bytes, 0) === value.bytes &&
  (value.field === "content" ? value.encoding === "text" : value.encoding === "json") && value.chunks.every(blob => blob.mime === "text/plain"));
export const importedEntrySchema = z.object({ entryVersionId: hash, deliverySeq: rev.positive(), role: z.enum(["user", "assistant"]), createdAt: rev.nullable(),
  completion: completionFields.completion, completionReason: completionFields.completionReason,
  preview: z.string().max(500), workedForMs: rev.nullable(), plan: z.boolean(), fields: z.array(importFieldSchema).min(1).max(256),
  omitted: z.object({ tools: rev.positive() }).strict().optional(),
}).strict().superRefine((value, ctx) => {
  const fields = new Set(value.fields.map(field => field.field));
  if (!fields.has("content") || fields.size !== value.fields.length || value.fields.reduce((sum, field) => sum + field.chunks.length, 0) > IMPORT_ENTRY_CHUNK_BUDGET) {
    ctx.addIssue({ code: "custom", message: "Invalid imported field membership" });
  }
});
export type ImportedEntry = z.infer<typeof importedEntrySchema>;
export function importedEntryHash(value: ImportedEntry) { const { entryVersionId: _id, deliverySeq: _seq, ...body } = value; return hashChatContent(body); }
export const importManifestSchema = z.object({ chatId: id, incarnationId: id, generationId: id,
  sourceKind: agentBackendIdSchema, expectedRevision: rev, entryCount: rev.max(100000), bytes: rev, digest: hash, incompleteTail: z.boolean(),
}).strict();
export const importStatusSchema = z.object({ manifest: importManifestSchema, state: z.enum(["receiving", "ready", "superseded"]),
  receivedCount: rev, receivedDigest: hash, receivedBytes: rev, revision: rev }).strict();
export const importPageSchema = z.object({ chatId: id, incarnationId: id, generationId: id,
  operationId: id, payloadHash: hash, offset: rev, entries: z.array(importedEntrySchema).min(1).max(32) }).strict();
export const importReceiptSchema = z.object({ chatId: id, generationId: id, operationId: id, payloadHash: hash, sourceDeviceId: id,
  receivedCount: rev, state: z.enum(["receiving", "ready"]), revision: rev, createdAt: rev }).strict();
export const EMPTY_IMPORT_DIGEST = hashChatContent(["import-generation-v1"]);
export const extendImportDigest = (previous: string, entry: Pick<ImportedEntry, "deliverySeq" | "entryVersionId">) => hashChatContent([previous, entry.deliverySeq, entry.entryVersionId]);
export const importEntryBytes = (entry: ImportedEntry) => entry.fields.reduce((sum, field) => sum + field.bytes, 0);
export function hashImportPage(value: z.infer<typeof importPageSchema>) { const { payloadHash: _hash, ...body } = value; return hashChatContent(body); }
