/**
 * [INPUT]: Depends on canonical Base validation, immutable operations and confirmed version maps.
 * [OUTPUT]: Provides field/atomic-group decisions, complete created-cell receipt baselines and durable candidate plans.
 * [POS]: Pure transaction kernel; adapters supply one consistent owner snapshot and persist its entire result atomically.
 */
import type { BaseCellValue, BaseColumn, BaseMeta, BaseRow } from "@ai-chat/base-ui/model/bases-ipc";
import { baseMetaSchema, baseRowSchema } from "@ai-chat/base-ui/model/bases-schema";
import { validateBaseCell, validateBaseModel } from "@ai-chat/base-ui/compute/base-mutation-validation";
import { scrubBaseFormulaColumns, scrubBaseRelationColumns, scrubBaseViews } from "@ai-chat/base-ui/compute/base-view-validation";
import { baseAttachmentValueSchema } from "@ai-chat/base-ui/attachments/gallery-attachments";
import { CLOUD_LIMITS } from "../config";
import { baseOperationFitsBudget, baseOperationSchema, canonicalJson, fieldKey, type BaseOperation, type BasePatch, type BaseReceipt } from "./operations";
import { changedMetadataKeys, deletesMetadataMember, isMetadataField, metadataTargets, readMetadataField, removedMetadataMembers, writeMetadataField } from "./metadata";
export type BaseMergeState = { meta: BaseMeta; rows: BaseRow[]; cloudRevision: number; schemaRevision: number;
  columnSchemaVersions: Record<string, number>; fieldVersions: Record<string, number>; rowVersions: Record<string, number>; tombstones: string[] };
type Outcome = BaseReceipt["results"][number];
type BaseMergeResult = { state: BaseMergeState; receipt: BaseReceipt;
  candidates: { indexes: number[]; reason: string }[]; changedRowIds: string[]; deletedRowIds: string[]; addedTombstones: string[] };
const equal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const byteLength = (value: unknown) => new TextEncoder().encode(canonicalJson(value)).byteLength;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function definition(column: BaseColumn | undefined) {
  return column ? { type: column.type, options: column.options?.map(option => option.id).sort(), formula: column.formula, relation: column.relation } : null;
}
export function readBasePatch(state: BaseMergeState, patch: BasePatch): unknown {
  if (isMetadataField(patch)) return readMetadataField(state.meta, patch);
  if ("target" in patch) return state.rows.find(row => row.id === patch.target.rowId)?.values[patch.target.columnId] ?? null;
  if (patch.kind === "create-row" || patch.kind === "delete-row") return state.rows.find(row => row.id === (patch.kind === "create-row" ? patch.row.id : patch.rowId)) ?? null;
  if (patch.kind === "put-column" || patch.kind === "delete-column") return state.meta.columns.find(column => column.id === (patch.kind === "put-column" ? patch.column.id : patch.columnId)) ?? null;
  if (patch.kind === "put-view" || patch.kind === "delete-view") return state.meta.views.find(view => view.id === (patch.kind === "put-view" ? patch.view.id : patch.viewId)) ?? null;
  if (patch.kind === "set-order") return state.meta[patch.field].map(item => item.id);
  return state.meta[patch.field];
}
function columnsOf(patch: BasePatch) {
  if ("target" in patch) return [patch.target.columnId];
  if (patch.kind === "create-row") return Object.keys(patch.row.values);
  if (patch.kind === "put-column") return [patch.column.id, ...(patch.column.relation?.labelColumnId ? [patch.column.relation.labelColumnId] : [])];
  return [];
}
function desired(state: BaseMergeState, patch: BasePatch): unknown {
  switch (patch.kind) {
    case "set": return patch.value;
    case "unset": case "delete-row": case "delete-column": case "delete-view": return null;
    case "create-row": return patch.row;
    case "put-column": return patch.column;
    case "put-view": return patch.view;
    case "set-order": return patch.ids;
    case "set-meta": return patch.value;
    case "set-column-field": case "set-view-field": return patch.value;
    case "increment": {
      const previous = readBasePatch(state, patch);
      if (typeof previous !== "number" || !Number.isFinite(previous + patch.amount)) throw new Error("invalid-increment");
      return previous + patch.amount;
    }
  }
}
function validateCell(state: BaseMergeState, row: BaseRow, columnId: string, value: BaseCellValue) {
  const column = state.meta.columns.find(item => item.id === columnId);
  if (!column) throw new Error("schema-changed");
  // The server admits file references separately; the shared external editor forbids attachment injection.
  if (column.type === "attachment") baseAttachmentValueSchema.parse(value);
  validateBaseCell(column, value, column.type === "attachment" ? "internal" : "external",
    new Set([...state.rows.map(row => row.id), row.id]));
}
function write(state: BaseMergeState, patch: BasePatch) {
  const key = fieldKey(patch);
  if ("target" in patch) {
    const row = state.rows.find(row => row.id === patch.target.rowId);
    const column = state.meta.columns.find(column => column.id === patch.target.columnId);
    if (!row || !column) throw new Error("target-missing");
    if (column.type === "formula") throw new Error("formula-readonly");
    if (patch.kind === "unset") delete row.values[patch.target.columnId];
    else {
      const value = desired(state, patch) as BaseCellValue;
      validateCell(state, row, patch.target.columnId, value); row.values[patch.target.columnId] = value;
    }
    if (byteLength(row) > CLOUD_LIMITS.maxRowBytes) throw new Error("row-too-large");
  } else switch (patch.kind) {
    case "set-column-field": case "set-view-field": {
      const column = patch.kind === "set-column-field" ? state.meta.columns.find(c => c.id === patch.columnId) : undefined;
      const before = clone(definition(column));
      writeMetadataField(state.meta, patch);
      if (column && !equal(before, definition(column))) {
        state.columnSchemaVersions[column.id] = (state.columnSchemaVersions[column.id] ?? 0) + 1; state.schemaRevision++;
      }
      if (deletesMetadataMember(patch)) state.tombstones.push(key);
      break;
    }
    case "create-row": {
      const row = baseRowSchema.parse(patch.row);
      if (byteLength(row) > CLOUD_LIMITS.maxRowBytes) throw new Error("row-too-large");
      for (const [id, value] of Object.entries(row.values)) if (value !== undefined) validateCell(state, row, id, value);
      if (state.rows.some(item => item.id === row.id)) throw new Error("identity-conflict");
      state.rows.push(row);
      for (const id of Object.keys(row.values)) state.fieldVersions[`cell:${row.id}:${id}`] = (state.fieldVersions[`cell:${row.id}:${id}`] ?? 0) + 1;
      break;
    }
    case "delete-row": state.rows = state.rows.filter(row => row.id !== patch.rowId); state.tombstones.push(key); break;
    case "put-column": {
      const index = state.meta.columns.findIndex(column => column.id === patch.column.id);
      const before = state.meta.columns[index];
      if (!equal(definition(before), definition(patch.column))) {
        state.columnSchemaVersions[patch.column.id] = (state.columnSchemaVersions[patch.column.id] ?? 0) + 1; state.schemaRevision++;
      }
      if (index < 0) state.meta.columns.push(clone(patch.column)); else state.meta.columns[index] = clone(patch.column);
      break;
    }
    case "delete-column": {
      const removed = new Set([patch.columnId]), beforeColumns = state.meta.columns, beforeViews = state.meta.views;
      state.meta.columns = scrubBaseRelationColumns(scrubBaseFormulaColumns(beforeColumns.filter(column => column.id !== patch.columnId), removed), removed);
      state.meta.views = scrubBaseViews(beforeViews, removed, state.meta.columns);
      if (state.meta.views.some(view => state.tombstones.includes(`view:${view.id}`))) throw Object.assign(new Error("deleted-view"), { code: "deleted-view" });
      for (const column of state.meta.columns) if (!equal(column, beforeColumns.find(before => before.id === column.id))) {
        state.columnSchemaVersions[column.id] = (state.columnSchemaVersions[column.id] ?? 0) + 1;
        state.fieldVersions[`column:${column.id}`] = (state.fieldVersions[`column:${column.id}`] ?? 0) + 1;
      }
      for (const view of beforeViews) {
        const next = state.meta.views.find(next => next.id === view.id);
        if (!equal(view, next)) state.fieldVersions[`view:${view.id}`] = (state.fieldVersions[`view:${view.id}`] ?? 0) + 1;
        if (!next) state.tombstones.push(`view:${view.id}`);
      }
      if (!state.meta.views.some(view => view.id === state.meta.activeViewId)) {
        state.meta.activeViewId = state.meta.views[0]!.id;
        state.fieldVersions["meta:activeViewId"] = (state.fieldVersions["meta:activeViewId"] ?? 0) + 1;
      }
      state.columnSchemaVersions[patch.columnId] = (state.columnSchemaVersions[patch.columnId] ?? 0) + 1; state.schemaRevision++;
      for (const row of state.rows) if (row.values[patch.columnId] !== undefined) {
        delete row.values[patch.columnId]; const cell = `cell:${row.id}:${patch.columnId}`; state.fieldVersions[cell] = (state.fieldVersions[cell] ?? 0) + 1;
      }
      state.tombstones.push(key); break;
    }
    case "put-view": {
      const index = state.meta.views.findIndex(view => view.id === patch.view.id);
      if (index < 0) state.meta.views.push(clone(patch.view)); else state.meta.views[index] = clone(patch.view);
      break;
    }
    case "delete-view": state.meta.views = state.meta.views.filter(view => view.id !== patch.viewId); state.tombstones.push(key); break;
    case "set-order": {
      const values = state.meta[patch.field];
      if (patch.ids.length !== values.length || !values.every(value => patch.ids.includes(value.id))) throw new Error("order-membership-changed");
      values.sort((a, b) => patch.ids.indexOf(a.id) - patch.ids.indexOf(b.id)); break;
    }
    case "set-meta": state.meta[patch.field] = patch.value; break;
  }
  state.fieldVersions[key] = (state.fieldVersions[key] ?? 0) + 1;
}
function validateState(state: BaseMergeState) {
  baseMetaSchema.parse(state.meta); validateBaseModel(state.meta, state.rows);
  if (byteLength(state.meta) > 131_072) throw new Error("metadata-too-large");
}
function decision(state: BaseMergeState, baseline: BaseMergeState, operation: BaseOperation, patch: BasePatch, index: number): Outcome {
  const result = (status: Outcome["status"], reason: string | null = null): Outcome => ({ index, status, reason });
  const key = fieldKey(patch), deletion = patch.kind.startsWith("delete-") || isMetadataField(patch) && deletesMetadataMember(patch);
  if (patch.kind === "put-column") {
    const existing = state.meta.columns.find(column => column.id === patch.column.id);
    if (existing && (existing.type !== patch.column.type || !equal(existing.formula, patch.column.formula))) return result("rejected", "column-definition-readonly");
    if (existing && !equal(existing, patch.column)) return result("rejected", "metadata-fields-required");
  }
  if (patch.kind === "put-view") {
    const existing = state.meta.views.find(view => view.id === patch.view.id);
    if (existing && !equal(existing, patch.view)) return result("rejected", "metadata-fields-required");
  }
  if (state.tombstones.includes("base") || state.tombstones.includes(key) || "target" in patch &&
    (state.tombstones.includes(`row:${patch.target.rowId}`) || state.tombstones.includes(`column:${patch.target.columnId}`)) ||
    isMetadataField(patch) && metadataTargets(patch).some(target => state.tombstones.includes(target))) {
    return result(deletion ? "converged" : "rejected", "deleted");
  }
  if (patch.kind === "create-row" && Object.keys(patch.row.values).some(id => state.tombstones.includes(`column:${id}`))) return result("rejected", "deleted");
  if (!deletion && columnsOf(patch).some(id => operation.baseColumnSchemaVersions[id] === undefined ||
      operation.baseColumnSchemaVersions[id] !== (baseline.columnSchemaVersions[id] ?? 0))) return result("rejected", "schema-changed");
  try {
    const value = desired(state, patch);
    if (isMetadataField(patch) && !(patch.kind === "set-column-field" ? state.meta.columns.some(c => c.id === patch.columnId) :
      state.meta.views.some(v => v.id === patch.viewId))) return result("rejected", "target-missing");
    if ("target" in patch) {
      const row = state.rows.find(row => row.id === patch.target.rowId), column = state.meta.columns.find(column => column.id === patch.target.columnId);
      if (!row || !column) return result("rejected", "target-missing");
      if (column.type === "formula") return result("rejected", "formula-readonly");
      if (value !== null) validateCell(state, row, column.id, value as BaseCellValue);
    }
    if (!deletion && operation.baseFieldVersions[key] === undefined) return result("rejected", "field-baseline-required");
    if (!deletion && patch.kind !== "increment" && equal(readBasePatch(state, patch), value)) return result("converged");
    if (!deletion && operation.baseFieldVersions[key] !== (baseline.fieldVersions[key] ?? 0)) return result("conflicted", "field-changed");
    return result("applied");
  } catch (error) {
    return result("rejected", error instanceof Error && "code" in error && typeof error.code === "string" ? error.code :
      error instanceof Error ? error.message.slice(0, 256) : "invalid-operation");
  }
}
export function mergeBaseOperations(input: BaseMergeState, raw: BaseOperation, predecessors: readonly BaseReceipt[] = [],
  rejectedPatches: Readonly<Record<number, string>> = {}): BaseMergeResult {
  const operation = baseOperationSchema.parse(raw);
  let state = clone(input);
  const results: Outcome[] = [];
  const dependencyFailed = operation.dependsOnOperationIds.some(id => {
    const receipt = predecessors.find(receipt => receipt.operationId === id);
    return !receipt || receipt.results.some(result => !["applied", "converged"].includes(result.status));
  });
  const reason = !baseOperationFitsBudget(operation) ? "operation-too-large" :
    new Set(operation.patches.map(fieldKey)).size !== operation.patches.length ? "duplicate-target" : dependencyFailed ? "dependency-unresolved" : null;
  for (const [index, patch] of operation.patches.entries()) {
    const rejection = reason ?? rejectedPatches[index];
    const result: Outcome = rejection ? { index, status: "rejected", reason: rejection } : decision(state, input, operation, patch, index);
    if (result.status === "applied") {
      const candidate = clone(state);
      try { write(candidate, patch); if (!operation.atomicGroup) validateState(candidate); state = candidate; }
      catch (error) { result.status = "rejected"; result.reason = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "invalid-operation"; }
    }
    results.push(result);
  }
  if (operation.atomicGroup) {
    if (results.every(result => ["applied", "converged"].includes(result.status))) {
      try { validateState(state); } catch { results.forEach(result => { result.status = "rejected"; result.reason = "invalid-atomic-group"; }); }
    }
    const failure = results.find(result => !["applied", "converged"].includes(result.status));
    if (failure) {
      state = clone(input);
      results.forEach(result => { result.status = failure.status; result.reason = failure.reason ?? "atomic-group-conflict"; });
    }
  }
  const changedRowIds = state.rows.filter(row => !equal(row, input.rows.find(before => before.id === row.id))).map(row => row.id);
  for (const key of changedMetadataKeys(input.meta, state.meta)) state.fieldVersions[key] = (input.fieldVersions[key] ?? 0) + 1;
  state.tombstones = [...new Set([...state.tombstones, ...removedMetadataMembers(input.meta, state.meta)])];
  const deletedRowIds = input.rows.filter(row => !state.rows.some(after => after.id === row.id)).map(row => row.id);
  for (const id of changedRowIds) state.rowVersions[id] = (input.rowVersions[id] ?? 0) + 1;
  for (const id of deletedRowIds) delete state.rowVersions[id];
  if (!equal(state.meta, input.meta)) state.meta.revision = input.meta.revision + 1;
  if (changedRowIds.length || deletedRowIds.length) state.meta.rowsGeneration = input.meta.rowsGeneration + 1;
  state.cloudRevision = input.cloudRevision + 1;
  const values = Object.fromEntries(operation.patches.map(patch => [fieldKey(patch), readBasePatch(state, patch)]));
  const versions = Object.fromEntries(operation.patches.map(patch => [fieldKey(patch), state.fieldVersions[fieldKey(patch)] ?? 0]));
  for (const key of changedMetadataKeys(input.meta, state.meta)) versions[key] = state.fieldVersions[key] ?? 0;
  // An omitted cell is also a confirmed creation baseline for a later local edit.
  for (const patch of operation.patches) if (patch.kind === "create-row") for (const { id } of state.meta.columns) {
    const key = `cell:${patch.row.id}:${id}`; values[key] = state.rows.find(row => row.id === patch.row.id)?.values[id] ?? null; versions[key] = state.fieldVersions[key] ?? 0;
  }
  const failed = results.filter(result => ["conflicted", "rejected"].includes(result.status) && result.reason !== "deleted");
  return { state, receipt: { operationId: operation.operationId, payloadHash: operation.payloadHash, cloudRevision: state.cloudRevision, results,
    baseline: { schemaRevision: state.schemaRevision, columnSchemaVersions: { ...state.columnSchemaVersions }, fieldVersions: versions,
      values: JSON.parse(canonicalJson(values)) } },
    candidates: operation.atomicGroup && failed.length ? [{ indexes: operation.patches.map((_, index) => index), reason: failed[0]!.reason! }] :
      failed.map(result => ({ indexes: [result.index], reason: result.reason! })),
    changedRowIds, deletedRowIds, addedTombstones: state.tombstones.filter(key => !input.tombstones.includes(key)) };
}
