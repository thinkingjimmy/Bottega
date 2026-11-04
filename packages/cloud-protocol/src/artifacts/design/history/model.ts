/**
 * [INPUT]: Zod, strict document paths/digests and the existing UTF-8 command budget.
 * [OUTPUT]: Closed fixed History selectors, paged metadata/differences and bounded source text.
 * [POS]: Shared native History wire contract; imported display authors grant no execution authority.
 */
import { z } from "zod";
import { designId, digestSchema } from "../reference/identifiers";
import { sourcePath } from "../reference/path";
import { DESIGN_COMMAND_BYTES, utf8JsonBytes } from "../core/transport";
export const historySelectionSchema = z.object({ path: sourcePath, unit: z.string().min(1).max(240).optional() }).strict();
export const nativeHistoryRequestSchema = z.object({ revision: z.number().int().positive().optional(), compareRevision: z.number().int().positive().optional(),
  cursor: z.number().int().nonnegative().max(10_000_000).optional(), offset: z.number().int().nonnegative().max(32 * 1024 * 1024).optional(),
  selection: historySelectionSchema.optional(), items: z.array(historySelectionSchema).min(1).max(32).optional() }).strict();
export const historyVersionSchema = z.object({ revision: z.number().int().positive(), parentRevision: z.number().int().nonnegative(),
  artifactId: z.string().uuid(), snapshotRef: digestSchema, readSetDigest: digestSchema, createdAt: z.number().nonnegative(),
  author: z.object({ kind: z.enum(["user", "agent", "restore", "external"]), name: z.string().min(1).max(80) }).strict(),
  operation: z.string().min(1).max(80), title: z.string().max(80), documentId: designId }).strict();
export const historyChangeSchema = historySelectionSchema.extend({ kind: z.enum(["added", "changed", "removed"]),
  before: digestSchema.nullable(), after: digestSchema.nullable(), family: z.enum(["file", "element", "token", "page", "document", "dataset"]),
}).strict();
export const nativeHistoryResultSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("list"), entries: z.array(historyVersionSchema).max(8), nextCursor: z.number().int().positive().nullable() }).strict(),
  z.object({ kind: z.literal("detail"), version: historyVersionSchema }).strict(),
  z.object({ kind: z.literal("difference"), revision: z.number().int().positive(), compareRevision: z.number().int().positive(),
    changes: z.array(historyChangeSchema).max(8), total: z.number().int().nonnegative(), nextCursor: z.number().int().positive().nullable() }).strict(),
  z.object({ kind: z.literal("content"), path: sourcePath, unit: z.string().max(240).optional(), before: z.string().max(2048).nullable(), after: z.string().max(2048).nullable(),
    offset: z.number().int().nonnegative(), nextOffset: z.number().int().positive().nullable() }).strict(),
]).refine(value => utf8JsonBytes(value) <= DESIGN_COMMAND_BYTES - 128, "History response exceeds its metadata budget");
export type HistorySelection = z.infer<typeof historySelectionSchema>;
export type HistoryVersion = z.infer<typeof historyVersionSchema>;
export type HistoryChange = z.infer<typeof historyChangeSchema>;
export type NativeHistoryResult = z.infer<typeof nativeHistoryResultSchema>;
