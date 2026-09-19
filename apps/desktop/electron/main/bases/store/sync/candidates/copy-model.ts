/**
 * [INPUT]: Depends on retained candidate context, original scope and canonical identity hashing.
 * [OUTPUT]: Allocates one independent Project/Base copy and remaps its member references without changing source identities.
 * [POS]: Pure copy planner shared by the Store and main review service; no renderer-selected target identity is accepted.
 */
import { createHash } from "node:crypto";
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { baseMetaSchema, baseRowSchema } from "../../../../../../shared/bases-schema";
import { baseFormulaDependencies, formulaExpressionForDisplay, type BaseSnapshot, type BaseViewConfig } from "../../../../../../shared/bases-ipc";
import { candidatePatchIndexes, isBasePatchDeleted, type BaseSyncEnvelope } from "../model";
export type BaseCandidateCopyInput = { ownerKey: string; baseId: string; operationId: string; payloadHash: string; name: string };
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function candidateCopyPlan(envelope: BaseSyncEnvelope, scope: SyncScope, input: BaseCandidateCopyInput) {
  const candidate = envelope.conflictCandidates.find(item => item.operation.operationId === input.operationId);
  if (!envelope.scope || canonicalJson(envelope.scope) !== canonicalJson(scope) || envelope.baseId !== input.baseId ||
    !candidate || candidate.operation.payloadHash !== input.payloadHash || candidate.state !== "unresolved" ||
    candidate.resolutionOperationId || envelope.promotionExport || !candidate.recoveryContext ||
    !candidatePatchIndexes(candidate).some(index => isBasePatchDeleted(envelope.tombstones, candidate.operation.patches[index]!))) throw new Error("BASE_CANDIDATE_COPY_UNAVAILABLE");
  const recoveryId = digest(["base-candidate-copy", scope, input.ownerKey, input.baseId, input.operationId, input.payloadHash]);
  return { recoveryId, projectId: `recovered_${recoveryId.slice(0, 40)}`, baseId: `base_${recoveryId.slice(0, 40)}`,
    provenance: { scope, ownerKey: input.ownerKey, baseId: input.baseId, operationId: input.operationId, payloadHash: input.payloadHash, recoveryId },
    candidate, name: candidate.copyRequest?.name ?? (input.name.trim().slice(0, 100) || candidate.recoveryContext.meta.name) };
}
export type BaseCandidateCopyPlan = ReturnType<typeof candidateCopyPlan>;
export function copyCandidateSnapshot(plan: BaseCandidateCopyPlan): BaseSnapshot {
  const source = plan.candidate.recoveryContext!, clone = structuredClone(source);
  const roots = new Set(candidatePatchIndexes(plan.candidate).flatMap(index => {
    const patch = plan.candidate.operation.patches[index]!;
    return "target" in patch ? [patch.target.rowId] : patch.kind === "create-row" ? [patch.row.id] : patch.kind === "delete-row" ? [patch.rowId] : [];
  }));
  const sourceRows = new Map(clone.rows.map(row => [row.id, row]));
  for (const rowId of roots) for (const column of clone.meta.columns) if (column.type === "relation") {
    const value = sourceRows.get(rowId)?.values[column.id];
    if (typeof value === "string" && sourceRows.has(value)) roots.add(value);
  }
  clone.rows = clone.rows.filter(row => roots.has(row.id));
  const id = (kind: string, old: string) => `${kind}_${digest([plan.recoveryId, kind, old]).slice(0, 32)}`;
  const columns = new Map(clone.meta.columns.map(column => [column.id, id("column", column.id)]));
  const rows = new Map(clone.rows.map(row => [row.id, id("row", row.id)]));
  const columnId = (old: string) => columns.get(old) ?? id("column", old);
  const remap = (value: unknown, key = ""): unknown => {
    if (Array.isArray(value)) return value.map(item => remap(item, key));
    if (typeof value === "string" && /(?:column|Column)Ids?$/.test(key)) return columnId(value);
    if (!value || typeof value !== "object") return value;
    const object = value as Record<string, unknown>;
    if (key === "columnWidths" || key === "columnAggregations") return Object.fromEntries(Object.entries(object).map(([old, entry]) => [columnId(old), entry]));
    return Object.fromEntries(Object.entries(object).map(([field, entry]) => [field,
      field === "id" ? id("chart", String(entry)) : field === "value" && typeof object.columnId === "string" &&
        source.meta.columns.some(column => column.id === object.columnId && column.type === "relation") && typeof entry === "string" ?
        rows.get(entry) ?? id("row", entry) : remap(entry, field)]));
  };
  clone.meta.columns = clone.meta.columns.map(column => ({ ...column, id: columnId(column.id),
    ...(column.formula ? { formula: { ...column.formula,
      expression: formulaExpressionForDisplay(column.formula.expression, baseFormulaDependencies(column.formula.expression).map(old => ({ id: old, name: columnId(old), type: "text" }))),
      ...(column.formula.invalidReferences ? { invalidReferences: column.formula.invalidReferences.map(columnId) } : {}) } } : {}),
    ...(column.relation ? { relation: { labelColumnId: column.relation.labelColumnId ? columnId(column.relation.labelColumnId) : null } } : {}) }));
  clone.rows = clone.rows.map(row => baseRowSchema.parse({ id: rows.get(row.id)!, values: Object.fromEntries(Object.entries(row.values).map(([old, value]) =>
    [columnId(old), source.meta.columns.some(column => column.id === old && column.type === "relation") && typeof value === "string" ? rows.get(value) ?? id("row", value) : value])) }));
  clone.meta.views = clone.meta.views.map(view => ({ ...view, id: id("view", view.id), config: remap(view.config) as BaseViewConfig }));
  clone.meta = baseMetaSchema.parse({ ...clone.meta, name: plan.name, owner: { kind: "project", projectId: plan.projectId }, ownerInstanceId: plan.baseId,
    navigation: { kind: "project-contained", projectId: plan.projectId }, activeViewId: id("view", clone.meta.activeViewId),
    revision: 0, rowsGeneration: 0, galleryGeneration: 0, historyGeneration: 0, syncGeneration: 0, syncHash: "0".repeat(64) });
  return clone;
}
