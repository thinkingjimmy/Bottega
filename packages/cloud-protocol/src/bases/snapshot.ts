/**
 * [INPUT]: Depends on canonical Base schemas and immutable field operation/receipt contracts.
 * [OUTPUT]: Provides closed snapshots, source-aware candidate/receipt-only proofs and captured operations, including absent-column baselines.
 * [POS]: Shared client boundary; generating an operation never substitutes a later remote field baseline.
 */
import { z } from "zod";
import { baseMetaSchema, baseRowSchema } from "@ai-chat/base-ui/model/bases-schema";
import { cloudIdSchema } from "../auth";
import { CLOUD_LIMITS } from "../config";
import { baseOperationSchema, baseReceiptSchema, fieldVersionMapSchema, fieldKey, hashBaseOperation,
  versionSchema, type BasePatch } from "./operations";
import { readBasePatch } from "./merge";
export const baseSnapshotSchema = z.object({ baseId: cloudIdSchema, meta: baseMetaSchema,
  rows: z.array(baseRowSchema).max(10_000), cloudRevision: versionSchema, schemaRevision: versionSchema,
  columnSchemaVersions: fieldVersionMapSchema, fieldVersions: fieldVersionMapSchema, rowVersions: fieldVersionMapSchema,
  tombstones: z.array(z.string().min(1).max(384)).max(20_000), receipts: z.array(baseReceiptSchema).max(64),
}).strict();
export type CloudBaseSnapshot = z.infer<typeof baseSnapshotSchema>;
export const baseConflictSchema = z.object({ conflictId: cloudIdSchema, operation: baseOperationSchema,
  indexes: z.array(versionSchema).min(1).max(512), sourceDeviceId: cloudIdSchema, sourceDeviceName: z.string().min(1).max(40).nullable().optional(), currentValues: z.record(z.string(), z.json()),
  currentFieldVersions: fieldVersionMapSchema, reason: z.string().max(256), state: z.literal("unresolved"), createdAt: versionSchema,
}).strict();
export type CloudBaseConflict = z.infer<typeof baseConflictSchema>;
const baseConflictOperationSchema = z.object({ operation: baseOperationSchema, receipt: baseReceiptSchema,
  sourceDeviceId: cloudIdSchema, sourceDeviceName: z.string().min(1).max(40).nullable(), createdAt: versionSchema,
  candidates: z.array(z.object({ conflictId: cloudIdSchema, indexes: z.array(versionSchema).min(1).max(512),
    state: z.enum(["unresolved", "applied", "discarded", "superseded"]), resolutionOperationId: cloudIdSchema.nullable() }).strict()).min(1).max(512),
  resolutionReceipt: baseReceiptSchema.nullable(),
}).strict();
export const baseConflictLookupSchema = z.union([baseConflictOperationSchema,
  baseConflictOperationSchema.extend({ operation: z.null(), candidates: z.tuple([]) })]);
export type CloudBaseConflictLookup = z.infer<typeof baseConflictLookupSchema>;
/** Every Base page answer crosses the wire as one bounded JSON string; the cap is checked before parsing. */
export function decodeBasePage<T>(input: string, schema: z.ZodType<T>): T {
  if (new TextEncoder().encode(input).byteLength > CLOUD_LIMITS.maxPageBytes) throw new Error("query-too-large");
  return schema.parse(JSON.parse(input));
}
export const decodeBaseSnapshot = (input: string) => decodeBasePage(input, baseSnapshotSchema);
export const decodeBaseConflict = (input: string) => decodeBasePage(input, baseConflictSchema);
export const decodeBaseConflictOperation = (input: string) => decodeBasePage(input, baseConflictOperationSchema);
export async function captureBaseOperation(snapshot: CloudBaseSnapshot, patches: BasePatch[], input: {
  operationId: string; atomicGroup?: string; batchId?: string; actor?: "user" | "agent" | "system";
}) {
  const columnVersions = { ...snapshot.columnSchemaVersions };
  for (const patch of patches) if (patch.kind === "put-column" && !snapshot.meta.columns.some(column => column.id === patch.column.id)) {
    columnVersions[patch.column.id] ??= 0;
  }
  const operation = baseOperationSchema.parse({ baseId: snapshot.baseId, operationId: input.operationId, payloadHash: "0".repeat(64),
    schemaRevision: snapshot.schemaRevision, patches, baseFieldVersions: Object.fromEntries(patches.map(patch => [fieldKey(patch), snapshot.fieldVersions[fieldKey(patch)] ?? 0])),
    baseColumnSchemaVersions: columnVersions, baseValues: Object.fromEntries(patches.map(patch => [fieldKey(patch), readBasePatch(snapshot, patch)])),
    dependsOnOperationIds: [], atomicGroup: input.atomicGroup ?? null, batchId: input.batchId ?? null, actor: input.actor ?? "user" });
  operation.payloadHash = await hashBaseOperation(operation); return operation;
}
