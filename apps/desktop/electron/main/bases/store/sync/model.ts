/**
 * [INPUT]: Depends on canonical Base schemas and explicit synchronization scopes.
 * [OUTPUT]: Provides the Base envelope, field/order operations, receipt-revision baselines and conflict candidates.
 * [POS]: BaseStore-owned durable synchronization state; local revision remains independent of cloud versions.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { baseCellValueSchema, baseColumnSchema, baseMetaSchema, baseRowSchema, baseViewSchema } from "../../../../../shared/bases-schema";
import { canonicalJson, storageIdSchema as id, storageHashSchema as hash, storageRevisionSchema as rev, syncScopeSchema } from "../../../../../shared/local-storage/contracts";

const field = z.object({ rowId: id, columnId: id }).strict();
export const basePatchSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("set"), target: field, value: baseCellValueSchema }).strict(),
  z.object({ kind: z.literal("unset"), target: field }).strict(),
  z.object({ kind: z.literal("increment"), target: field, amount: z.number().finite() }).strict(),
  z.object({ kind: z.literal("create-row"), row: baseRowSchema }).strict(),
  z.object({ kind: z.literal("delete-row"), rowId: id }).strict(),
  z.object({ kind: z.literal("put-column"), column: baseColumnSchema }).strict(),
  z.object({ kind: z.literal("delete-column"), columnId: id }).strict(),
  z.object({ kind: z.literal("put-view"), view: baseViewSchema }).strict(),
  z.object({ kind: z.literal("delete-view"), viewId: id }).strict(),
  z.object({ kind: z.literal("set-order"), field: z.enum(["columns", "views"]), ids: z.array(id).max(512)
    .refine(ids => new Set(ids).size === ids.length, { error: "Duplicate ordered identity" }) }).strict(),
  z.object({ kind: z.literal("set-meta"), field: z.enum(["name", "activeViewId"]), value: z.string().min(1).max(256) }).strict(),
]);
export type BasePatch = z.infer<typeof basePatchSchema>;
const versionMap = z.record(z.string().min(1).max(384), rev);
export const confirmedBaseSchema = z.object({
  meta: baseMetaSchema, rows: z.array(baseRowSchema).max(10000), cloudRevision: rev,
  schemaRevision: rev, columnSchemaVersions: versionMap, fieldVersions: versionMap, rowVersions: versionMap,
}).strict();
export type ConfirmedBase = z.infer<typeof confirmedBaseSchema>;
export const pendingOperationSchema = z.object({
  operationId: id, baseId: id, payloadHash: hash, schemaRevision: rev,
  patches: z.array(basePatchSchema).min(1).max(512),
  baseFieldVersions: versionMap, baseColumnSchemaVersions: versionMap,
  baseValues: z.record(z.string(), z.json()), dependsOnOperationIds: z.array(id).max(1024),
  atomicGroup: id.nullable(), batchId: id.nullable(), actor: z.enum(["user", "agent", "system"]),
  sealed: z.boolean(), attempts: rev, state: z.enum(["queued", "blocked"]),
}).strict();
export type PendingBaseOperation = z.infer<typeof pendingOperationSchema>;
export const baseReceiptSchema = z.object({
  operationId: id, payloadHash: hash, cloudRevision: rev,
  baseline: z.object({ schemaRevision: rev, fieldVersions: versionMap, columnSchemaVersions: versionMap,
    values: z.record(z.string(), z.json()) }).strict().optional(),
  results: z.array(z.object({ index: rev, status: z.enum(["applied", "converged", "conflicted", "rejected"]),
    reason: z.string().max(256).nullable() }).strict()).min(1).max(512),
}).strict();
export type BaseOperationReceipt = z.infer<typeof baseReceiptSchema>;
const candidateSchema = z.object({
  operation: pendingOperationSchema, receipt: baseReceiptSchema.nullable(), state: z.enum(["unresolved", "discarded", "applied"]),
  blockedReason: z.enum(["dependency", "tombstone"]).nullable().default(null),
  currentValues: z.record(z.string(), z.json()), resolutionOperationId: id.nullable(),
}).strict();
const detachedCustodySchema = z.object({ scope: syncScopeSchema, confirmed: confirmedBaseSchema,
  pendingOperations: z.array(pendingOperationSchema), conflictCandidates: z.array(candidateSchema), receipts: z.array(baseReceiptSchema),
  tombstones: z.array(z.string()), cursor: id.nullable() }).strict();
export const baseSyncEnvelopeSchema = z.object({
  detachedCustody: z.array(detachedCustodySchema).max(32).default([]),
  version: z.literal(1), baseId: id, cloudState: z.enum(["local-only", "synced", "mirror"]),
  scope: syncScopeSchema.nullable(), confirmed: confirmedBaseSchema.nullable(),
  pendingOperations: z.array(pendingOperationSchema).max(4096),
  conflictCandidates: z.array(candidateSchema).max(4096), receipts: z.array(baseReceiptSchema).max(100000),
  tombstones: z.array(z.string().min(1).max(384)).max(20000), cursor: id.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.cloudState === "local-only" && (value.scope || value.confirmed || value.pendingOperations.length || value.receipts.length || value.cursor) ||
      value.cloudState !== "local-only" && (!value.scope || !value.confirmed)) ctx.addIssue({ code: "custom", message: "Base synchronization mode is inconsistent" });
  const operationIds = value.pendingOperations.map(operation => operation.operationId);
  if (new Set(operationIds).size !== operationIds.length) ctx.addIssue({ code: "custom", message: "Duplicate pending operation identity" });
  for (const operation of value.pendingOperations) {
    if (operation.baseId !== value.baseId || operation.payloadHash !== operationHash(operation)) ctx.addIssue({ code: "custom", message: "Base operation digest mismatch" });
  }
  for (const candidate of value.conflictCandidates) {
    if (candidate.operation.baseId !== value.baseId || candidate.operation.payloadHash !== operationHash(candidate.operation) ||
      (candidate.receipt === null) !== Boolean(candidate.blockedReason) || (!candidate.receipt && candidate.operation.sealed)) ctx.addIssue({ code: "custom", message: "Base candidate evidence mismatch" });
  }
});
export type BaseSyncEnvelope = z.infer<typeof baseSyncEnvelopeSchema>;
export type BaseSyncIntent = { operationId?: string; patches?: BasePatch[]; atomicGroup?: string; batchId?: string };
export function operationHash(operation: Omit<PendingBaseOperation, "payloadHash"> | PendingBaseOperation) {
  const { sealed: _sealed, attempts: _attempts, state: _state, ...payload } = operation;
  delete (payload as Partial<PendingBaseOperation>).payloadHash;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
export function emptyBaseSync(baseId: string): BaseSyncEnvelope {
  return { detachedCustody: [], version: 1, baseId, cloudState: "local-only", scope: null, confirmed: null,
    pendingOperations: [], conflictCandidates: [], receipts: [], tombstones: [], cursor: null };
}
export function fieldKey(patch: BasePatch): string {
  if ("target" in patch) return `cell:${patch.target.rowId}:${patch.target.columnId}`;
  if (patch.kind === "create-row") return `row:${patch.row.id}`;
  if (patch.kind === "delete-row") return `row:${patch.rowId}`;
  if (patch.kind === "put-column") return `column:${patch.column.id}`;
  if (patch.kind === "delete-column") return `column:${patch.columnId}`;
  if (patch.kind === "put-view") return `view:${patch.view.id}`;
  if (patch.kind === "delete-view") return `view:${patch.viewId}`;
  return `meta:${patch.field}`;
}
