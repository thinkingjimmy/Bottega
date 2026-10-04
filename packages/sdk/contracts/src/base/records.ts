/**
 * [INPUT]: Depends on Zod and the BaseRef resource contract
 * [OUTPUT]: Provides the public Base records port (`bottega.base.records/v1`, `bottega.base.bound-record/v1`): operation names, input/output schemas for describe, query, read, insert/patch/delete, writeFields, attachment and run-result slots, the field-write outcomes and the 1 KiB summary truncation rule
 * [POS]: The only Base surface an independent package, the Workflow plugin or the SDK sees; the host keeps BaseStore, revisions, validation and sync, and never hands out a store handle
 */
import { z } from "zod";
import { baseRefSchema } from "../model/resources";

export const BASE_RECORDS_CONTRACT = "bottega.base.records/v1";
export const BOUND_RECORD_CONTRACT = "bottega.base.bound-record/v1";
export const BASE_OPERATIONS = Object.freeze({
  describe: "base.describe", query: "base.query", read: "base.read", insert: "base.insert", patch: "base.patch",
  delete: "base.delete", writeFields: "base.write-fields", attachment: "base.attachment",
  report: "base.results.report", results: "base.results.list", result: "base.results.read",
} as const);

export const BASE_PORT_LIMITS = Object.freeze({ pageRows: 200, readRows: 100, writeFields: 32, batchRows: 100,
  attachmentChunk: 256 * 1024, summaryBytes: 1024, reportBytes: 4 * 1024 * 1024, resultChunk: 256 * 1024 });

const id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_:.-]+$/);
/** Idempotency key chosen by the caller, scoped by the host to its principal: a retry with the same key replays. */
const requestId = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/);
const cell = z.unknown();

/** `create` defaults to false: describing a Base never creates one. */
export const describeInputSchema = z.object({ base: baseRefSchema, create: z.boolean().default(false) }).strict();

/** Every page is read from one revision; a different revision is a typed gap, never a silent mix. */
export const querySnapshotSchema = z.object({ revision: z.number().int().min(0) }).strict();
export const queryInputSchema = z.object({
  base: baseRefSchema,
  snapshot: querySnapshotSchema.optional(),
  cursor: z.string().max(512).optional(),
  limit: z.number().int().min(1).max(BASE_PORT_LIMITS.pageRows).default(50),
  columns: z.array(id).max(64).optional(),
  filter: z.unknown().optional(),
  sort: z.array(z.object({ column_id: id, direction: z.enum(["asc", "desc"]) }).strict()).max(8).optional(),
}).strict().refine(value => !value.cursor || value.snapshot, "cursor-needs-snapshot");
export const queryOutputSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("page"), snapshot: querySnapshotSchema, rows: z.array(z.unknown()), total: z.number().int().min(0),
    next: z.string().nullable() }).strict(),
  /* The host keeps no history of old revisions: the only honest answer is "re-read from the first page". */
  z.object({ status: z.literal("gap"), snapshot: querySnapshotSchema, reason: z.literal("revision-changed") }).strict(),
]);

export const readInputSchema = z.object({ base: baseRefSchema, rowIds: z.array(id).min(1).max(BASE_PORT_LIMITS.readRows),
  fields: z.array(id).min(1).max(64).optional() }).strict();

export const writeFieldsInputSchema = z.object({
  base: baseRefSchema, rowId: id, requestId,
  /** Host-signed; binds principal, Base instance, row, fields, their prior values and the field schema. */
  guard: z.string().min(1).max(8 * 1024),
  writes: z.array(z.object({ columnId: id, value: cell }).strict()).min(1).max(BASE_PORT_LIMITS.writeFields),
}).strict().refine(value => new Set(value.writes.map(item => item.columnId)).size === value.writes.length, "duplicate-column");

/**
 * `applied`: current = guarded prior value. `already-applied`: current = desired. `blocked`: a field changed since the
 * guard or vanished — the whole write fails and nothing in it is committed. People and workflows never share a column
 * so there is no "keep the person's value" outcome: a guarded write is a CAS for other port writers and for
 * one user's devices.
 */
export const FIELD_OUTCOMES = ["applied", "already-applied", "blocked"] as const;
export type FieldOutcome = (typeof FIELD_OUTCOMES)[number];

export const rowsInsertInputSchema = z.object({ base: baseRefSchema, requestId, atomic: z.boolean().default(false),
  rows: z.array(z.object({ id, values: z.record(id, cell) }).strict()).min(1).max(BASE_PORT_LIMITS.batchRows) }).strict();
export const rowsPatchInputSchema = z.object({ base: baseRefSchema, requestId, atomic: z.boolean().default(false),
  rows: z.array(z.object({ rowId: id, patch: z.record(id, cell) }).strict()).min(1).max(BASE_PORT_LIMITS.batchRows) }).strict();
export const rowsDeleteInputSchema = z.object({ base: baseRefSchema, requestId, atomic: z.boolean().default(false),
  rowIds: z.array(id).min(1).max(BASE_PORT_LIMITS.batchRows) }).strict();

export const attachmentInputSchema = z.object({ base: baseRefSchema, rowId: id, columnId: id, attachmentId: id,
  offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(BASE_PORT_LIMITS.attachmentChunk).default(BASE_PORT_LIMITS.attachmentChunk) }).strict();

/** A long report goes to a run result, the row only gets a bounded summary and a logical reference. */
export const reportInputSchema = z.object({ base: baseRefSchema, rowId: id, requestId, guard: z.string().min(1).max(8 * 1024),
  summaryColumnId: id.optional(), report: z.string().min(1).max(BASE_PORT_LIMITS.reportBytes), label: z.string().min(1).max(120) }).strict();
export const resultsInputSchema = z.object({ base: baseRefSchema, rowId: id }).strict();
export const resultReadInputSchema = z.object({ base: baseRefSchema, resultRef: z.string().regex(/^res_[a-f0-9]{64}$/),
  offset: z.number().int().min(0).default(0), length: z.number().int().min(1).max(BASE_PORT_LIMITS.resultChunk).default(BASE_PORT_LIMITS.resultChunk) }).strict();

/** Cut at a UTF-8 boundary under the byte limit; the marker is part of the result, not a guess from the length. */
export function truncateSummary(text: string, limit: number = BASE_PORT_LIMITS.summaryBytes) {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length <= limit) return { text, truncated: false as const, bytes: bytes.length };
  const ellipsis = "…", room = limit - new TextEncoder().encode(ellipsis).length;
  let end = room;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return { text: `${new TextDecoder().decode(bytes.subarray(0, end))}${ellipsis}`, truncated: true as const, bytes: bytes.length };
}
