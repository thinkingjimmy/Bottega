/**
 * [INPUT]: Original native editor/Store state and the exact affected patch targets.
 * [OUTPUT]: Bounded semantic encryption captures without advancing any reviewed baseline.
 * [POS]: Original pending-operation custody; captured metadata survives remote reads before encryption.
 */
import { z } from "zod";
import { baseMetaSchema, baseRowSchema } from "@ai-chat/base-ui/model/bases-schema";
import { fieldVersionMapSchema, versionSchema, type BasePatch } from "../../operations";
import type { BaseMergeState } from "../../merge";
export const baseEncryptionCaptureSchema = z.object({ meta: baseMetaSchema, rows: z.array(baseRowSchema).max(128),
  cloudRevision: versionSchema, schemaRevision: versionSchema, fieldVersions: fieldVersionMapSchema,
  columnSchemaVersions: fieldVersionMapSchema, rowVersions: fieldVersionMapSchema, tombstones: z.array(z.string().max(384)).max(20000) }).strict();
export type BaseEncryptionCapture = z.infer<typeof baseEncryptionCaptureSchema>;
export function captureBaseEncryptionState(state: BaseMergeState, patches: BasePatch[]): BaseEncryptionCapture {
  const rowIds = new Set(patches.flatMap(patch => "target" in patch ? [patch.target.rowId] : patch.kind === "create-row" ? [patch.row.id] : patch.kind === "delete-row" ? [patch.rowId] : []));
  for (const patch of patches) for (const column of state.meta.columns.filter(column => column.type === "relation")) {
    const value = patch.kind === "set" && patch.target.columnId === column.id ? patch.value : patch.kind === "create-row" ? patch.row.values[column.id] : undefined;
    if (typeof value === "string") rowIds.add(value);
  }
  const fields = Object.fromEntries(Object.entries(state.fieldVersions).filter(([key]) => !key.startsWith("cell:") || rowIds.has(key.split(":")[1])));
  return baseEncryptionCaptureSchema.parse({ meta: state.meta, cloudRevision: state.cloudRevision, schemaRevision: state.schemaRevision,
    columnSchemaVersions: state.columnSchemaVersions, tombstones: state.tombstones, rows: state.rows.filter(row => rowIds.has(row.id)), fieldVersions: fields,
    rowVersions: Object.fromEntries(Object.entries(state.rowVersions).filter(([id]) => rowIds.has(id))) });
}
