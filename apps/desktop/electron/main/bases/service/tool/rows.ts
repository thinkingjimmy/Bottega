/**
 * [INPUT]: Depends on shared Base validation, atomic field patches and existing Store tool transactions.
 * [OUTPUT]: Provides independent row batches or explicitly indivisible cross-row Agent mutations.
 * [POS]: Tool-only row planning; existing renderer/App GUI kernels remain unchanged.
 */
import { baseOperationSchema, baseOperationFitsBudget, canonicalJson, type BasePatch } from "@ai-chat/cloud-protocol";
import { BASE_ROW_LIMIT, type BaseRow, type BaseRowPatch, type BaseSnapshot } from "../../../../../shared/bases-ipc";
import { statusError } from "../../../errors";
import { baseColumnIndex, baseRowIdSet, validateBaseRow, validateBaseCell } from "../../validation/base-mutation-validation";
import type { BaseStore } from "../../base-store";
import { baseToolItem } from "./identity";
import { projectToolItem, toolBatchResult } from "./result";
import { isBasePatchDeleted } from "../../store/sync/model";

export type ToolRowsRequest = { kind: "insert"; rows: BaseRow[] } |
  { kind: "patch"; rows: { rowId: string; patch: BaseRowPatch }[] } | { kind: "delete"; rowIds: string[] };
export type ToolRowsInput = { ownerKey: string; ownerInstanceId: string; batchId: string; atomic: boolean; request: ToolRowsRequest; signal?: AbortSignal; readOnly?: boolean };

export async function mutateToolRows(store: BaseStore, input: ToolRowsInput, ports: {
  assertAdmission(): void; changed(snapshot: BaseSnapshot): void;
}) {
  const ids = input.request.kind === "delete" ? input.request.rowIds : input.request.rows.map(row => "rowId" in row ? row.rowId : row.id);
  if (new Set(ids).size !== ids.length) throw statusError(400, "Duplicate row identity in Agent batch", { code: "duplicate_row_id" });
  const groups = input.atomic ? [input.request] : ids.map((_, index): ToolRowsRequest => input.request.kind === "delete" ?
    { kind: "delete", rowIds: [input.request.rowIds[index]!] } : input.request.kind === "insert" ?
      { kind: "insert", rows: [input.request.rows[index]!] } : { kind: "patch", rows: [input.request.rows[index]!] });
  const results: ReturnType<typeof projectToolItem>[] = [];
  const recorded = input.readOnly ? new Set(store.sync.read(input.ownerKey, input.ownerInstanceId).toolBatches.map(item => item.operationId)) : null;
  let snapshot = store.get(input.ownerKey, input.ownerInstanceId)!;
  for (const [index, request] of groups.entries()) {
    input.signal?.throwIfAborted();
    ports.assertAdmission();
    const targets = request.kind === "delete" ? request.rowIds.map(id => `row:${id}`) : request.kind === "insert" ?
      request.rows.map(row => `row:${row.id}`) : request.rows.flatMap(row => Object.keys(row.patch).map(id => `cell:${row.rowId}:${id}`));
    const identity = { ...baseToolItem(input.batchId, input.atomic ? "atomic" : ids[index]!, { atomic: input.atomic, request }),
      targets: targets.length > 512 ? [`batch:${input.batchId}`] : targets };
    if (recorded && !recorded.has(identity.operationId)) throw statusError(404, "Original Base batch result is unavailable", { code: "batch_result_unavailable" });
    const result = await store.transactTool(input.ownerKey, input.ownerInstanceId, identity, current => {
      input.signal?.throwIfAborted();
      ports.assertAdmission();
      const plan = prepareRows(current, request);
      if (plan.patches.some(patch => isBasePatchDeleted(store.sync.read(input.ownerKey, input.ownerInstanceId).tombstones, patch))) {
        throw statusError(404, "Base target was deleted", { code: "deleted" });
      }
      const syncIntent = { operationId: identity.operationId, batchId: input.batchId, atomicGroup: identity.operationId, patches: plan.patches };
      assertGroupBudget(plan.patches, input.ownerInstanceId, identity.operationId, input.batchId);
      return { meta: { ...current.meta, revision: current.meta.revision + 1 }, rows: plan.rows,
        changedRowIds: new Set(plan.changed), removedRowIds: new Set(plan.removed), actor: "agent", operation: `row-${request.kind}`, syncIntent };
    });
    input.signal?.throwIfAborted();
    snapshot = result.snapshot;
    results.push(projectToolItem(result.receipt, result.sync));
    if (!result.replayed && result.receipt.status === "saved") ports.changed(snapshot);
  }
  return toolBatchResult(input.batchId, results, snapshot.meta.revision, snapshot.rows.length);
}

function prepareRows(current: BaseSnapshot, request: ToolRowsRequest) {
  const columns = baseColumnIndex(current.meta.columns), byId = new Map(current.rows.map(row => [row.id, row]));
  const changed: string[] = [], removed: string[] = [], patches: BasePatch[] = [];
  if (request.kind === "insert") {
    const rowIds = baseRowIdSet([...current.rows, ...request.rows]);
    for (const row of request.rows) {
      validateBaseRow(row, columns, "external", rowIds);
      const existing = byId.get(row.id);
      if (existing && canonicalJson(existing) !== canonicalJson(row)) throw statusError(409, "Row already exists with different values", { code: "row_id_conflict" });
      if (!existing) { byId.set(row.id, structuredClone(row)); changed.push(row.id); }
      patches.push({ kind: "create-row", row });
    }
    if (byId.size > BASE_ROW_LIMIT) throw statusError(409, "Base row capacity exceeded", { code: "base_capacity" });
  } else if (request.kind === "patch") {
    const rowIds = baseRowIdSet(current.rows);
    for (const patch of request.rows) {
      const row = byId.get(patch.rowId);
      if (!row) throw statusError(404, "Row no longer exists", { code: "row_not_found" });
      const values = { ...row.values };
      for (const [columnId, value] of Object.entries(patch.patch)) {
        const column = columns.get(columnId);
        if (!column) throw statusError(400, "Unknown Base column", { code: "unknown_column" });
        if (value === null) { delete values[columnId]; patches.push({ kind: "unset", target: { rowId: row.id, columnId } }); }
        else { validateBaseCell(column, value, "external", rowIds); values[columnId] = structuredClone(value);
          patches.push({ kind: "set", target: { rowId: row.id, columnId }, value }); }
      }
      if (canonicalJson(values) !== canonicalJson(row.values)) { byId.set(row.id, { ...row, values }); changed.push(row.id); }
    }
  } else {
    for (const rowId of request.rowIds) { if (byId.delete(rowId)) removed.push(rowId); patches.push({ kind: "delete-row", rowId }); }
  }
  return { rows: changed.length || removed.length ? [...byId.values()] : current.rows, changed, removed, patches };
}

function assertGroupBudget(patches: BasePatch[], baseId: string, operationId: string, batchId: string) {
  if (!patches.length) return;
  const probe = baseOperationSchema.safeParse({ baseId, operationId, payloadHash: "0".repeat(64), patches, actor: "agent",
    schemaRevision: 0, baseFieldVersions: {}, baseColumnSchemaVersions: {}, baseValues: {}, dependsOnOperationIds: [], atomicGroup: operationId, batchId });
  if (!probe.success || !baseOperationFitsBudget(probe.data)) throw statusError(413, "Atomic Base change exceeds its field or byte budget", { code: "atomic_group_budget" });
}
