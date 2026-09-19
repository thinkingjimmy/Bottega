/**
 * [INPUT]: Depends on canonical Base schemas and public operation budgets.
 * [OUTPUT]: Provides immutable operations, shared byte/field budgets, receipt baselines and canonical payload hashing (canonicalJson is re-exported from encryption/encoding).
 * [POS]: Shared Base sync contract for the desktop queue, browser drafts and server merge transactions.
 */
import { z } from "zod";
import { baseCellValueSchema, baseColumnSchema, baseRowSchema, baseViewSchema } from "@ai-chat/base-ui/model/bases-schema";
import { cloudIdSchema as id } from "../auth";
import { columnFieldPathSchema, viewFieldPathSchema } from "./metadata";
import { CLOUD_LIMITS } from "../config";
/* Canonical JSON lives with the byte primitives so the crypto-facing subpath needs no Base schema. */
import { canonicalJson } from "../encryption/encoding";
export { canonicalJson };
import { versionSchema } from "../scalars";
export { versionSchema };
export const fieldVersionMapSchema = z.record(z.string().min(1).max(384), versionSchema);
const field = z.object({ rowId: id, columnId: id }).strict();
export const basePatchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set"), target: field, value: baseCellValueSchema }).strict(),
  z.object({ kind: z.literal("unset"), target: field }).strict(),
  z.object({ kind: z.literal("increment"), target: field, amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal("create-row"), row: baseRowSchema }).strict(),
  z.object({ kind: z.literal("delete-row"), rowId: id }).strict(),
  z.object({ kind: z.literal("put-column"), column: baseColumnSchema }).strict(),
  z.object({ kind: z.literal("set-column-field"), columnId: id, path: columnFieldPathSchema, value: z.json() }).strict(),
  z.object({ kind: z.literal("delete-column"), columnId: id }).strict(),
  z.object({ kind: z.literal("put-view"), view: baseViewSchema }).strict(),
  z.object({ kind: z.literal("set-view-field"), viewId: id, path: viewFieldPathSchema, value: z.json() }).strict(),
  z.object({ kind: z.literal("delete-view"), viewId: id }).strict(),
  z.object({ kind: z.literal("set-order"), field: z.enum(["columns", "views"]), ids: z.array(id).max(512)
    .refine(ids => new Set(ids).size === ids.length, "Duplicate ordered identity") }).strict(),
  z.object({ kind: z.literal("set-meta"), field: z.enum(["name", "activeViewId"]), value: z.string().min(1).max(256) }).strict(),
]);
export type BasePatch = z.infer<typeof basePatchSchema>;
export const baseOperationSchema = z.object({
  operationId: id, baseId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/), schemaRevision: versionSchema,
  patches: z.array(basePatchSchema).min(1).max(512), baseFieldVersions: fieldVersionMapSchema,
  baseColumnSchemaVersions: fieldVersionMapSchema, baseValues: z.record(z.string().min(1).max(384), z.json()),
  dependsOnOperationIds: z.array(id).max(1024), atomicGroup: id.nullable(), batchId: id.nullable(),
  actor: z.enum(["user", "agent", "system"]),
}).strict();
export type BaseOperation = z.infer<typeof baseOperationSchema>;
export function baseOperationFitsBudget(operation: BaseOperation) {
  const fields = operation.patches.reduce((sum, patch) => sum + (patch.kind === "create-row" ? Math.max(1, Object.keys(patch.row.values).length) : 1), 0);
  return new TextEncoder().encode(canonicalJson(operation)).byteLength <= CLOUD_LIMITS.maxOperationBytes &&
    fields <= CLOUD_LIMITS.maxOperationFields && (!operation.atomicGroup || fields <= CLOUD_LIMITS.maxAtomicGroupFields);
}
export const baseReceiptSchema = z.object({
  operationId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/), cloudRevision: versionSchema,
  baseline: z.object({ schemaRevision: versionSchema, fieldVersions: fieldVersionMapSchema,
    columnSchemaVersions: fieldVersionMapSchema, values: z.record(z.string(), z.json()) }).strict().optional(),
  results: z.array(z.object({ index: versionSchema, status: z.enum(["applied", "converged", "conflicted", "rejected"]),
    reason: z.string().max(256).nullable() }).strict()).min(1).max(512),
}).strict();
export type BaseReceipt = z.infer<typeof baseReceiptSchema>;
export function fieldKey(patch: BasePatch): string {
  if ("target" in patch) return `cell:${patch.target.rowId}:${patch.target.columnId}`;
  if (patch.kind === "create-row") return `row:${patch.row.id}`;
  if (patch.kind === "delete-row") return `row:${patch.rowId}`;
  if (patch.kind === "put-column") return `column:${patch.column.id}`;
  if (patch.kind === "delete-column") return `column:${patch.columnId}`;
  if (patch.kind === "set-column-field") return `column:${patch.columnId}:${patch.path.join(":")}`;
  if (patch.kind === "put-view") return `view:${patch.view.id}`;
  if (patch.kind === "delete-view") return `view:${patch.viewId}`;
  if (patch.kind === "set-view-field") return `view:${patch.viewId}:${patch.path.join(":")}`;
  return `meta:${patch.field}`;
}
function baseOperationPayload(value: BaseOperation) {
  const { payloadHash: _hash, ...payload } = baseOperationSchema.parse(value);
  return canonicalJson(payload);
}
export async function hashBaseOperation(value: BaseOperation): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(baseOperationPayload(value)));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
