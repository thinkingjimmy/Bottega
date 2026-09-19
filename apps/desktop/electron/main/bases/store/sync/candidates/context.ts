/**
 * [INPUT]: Depends on the original confirmed snapshot, causal operations and Base field identities.
 * [OUTPUT]: Retains the original schema and affected records needed for an explicit independent candidate copy.
 * [POS]: Pure candidate custody leaf; it never changes an operation payload or revives a deleted identity.
 */
import type { BaseSnapshot } from "../../../../../../shared/bases-ipc";
import { baseCellValueSchema, baseRowSchema } from "../../../../../../shared/bases-schema";
import { fieldKey, type BaseSyncEnvelope, type PendingBaseOperation } from "../model";
import { applyPatches } from "../projection";
export function captureCandidateContext(envelope: BaseSyncEnvelope, operation: PendingBaseOperation): BaseSnapshot {
  if (!envelope.confirmed) throw new Error("BASE_CANDIDATE_BASELINE_REQUIRED");
  let snapshot: BaseSnapshot = envelope.confirmed;
  for (const pending of envelope.pendingOperations) {
    if (pending.operationId === operation.operationId) break;
    snapshot = applyPatches(snapshot, pending.patches, []);
  }
  const ids = new Set(operation.patches.flatMap(patch => "target" in patch ? [patch.target.rowId] :
    patch.kind === "create-row" ? [patch.row.id] : patch.kind === "delete-row" ? [patch.rowId] : []));
  snapshot = structuredClone(snapshot);
  for (const patch of operation.patches) {
    if (patch.kind === "create-row") snapshot.rows = snapshot.rows.filter(row => row.id !== patch.row.id);
    if (patch.kind === "delete-row") {
      const original = baseRowSchema.safeParse(operation.baseValues[fieldKey(patch)]);
      if (original.success) snapshot.rows = [...snapshot.rows.filter(row => row.id !== patch.rowId), original.data];
    }
    if (!("target" in patch)) continue;
    let row = snapshot.rows.find(item => item.id === patch.target.rowId);
    if (!row) { row = { id: patch.target.rowId, values: {} }; snapshot.rows.push(row); }
    const original = baseCellValueSchema.safeParse(operation.baseValues[fieldKey(patch)]);
    if (original.success) row.values[patch.target.columnId] = original.data;
    else delete row.values[patch.target.columnId];
  }
  const projected = applyPatches(snapshot, operation.patches.filter(patch => !["delete-row", "delete-column", "delete-view"].includes(patch.kind)), []);
  const rows = new Map([...snapshot.rows, ...projected.rows].map(row => [row.id, row]));
  const relations = projected.meta.columns.filter(column => column.type === "relation");
  // A copied relation keeps the related record inside the new Base instead of referring back to its source.
  for (const id of ids) for (const column of relations) {
    const value = rows.get(id)?.values[column.id];
    if (typeof value === "string" && rows.has(value)) ids.add(value);
  }
  return structuredClone({ meta: projected.meta, rows: [...ids].flatMap(id => rows.get(id) ?? []) });
}
