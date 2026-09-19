/**
 * [INPUT]: Depends on immutable Base snapshots and field operation contracts.
 * [OUTPUT]: Provides ordered structural/field diffs and confirmed-plus-causal-pending projection without a second Store.
 * [POS]: Pure Base synchronization kernel; row change declarations bound diff work.
 */
import type { BaseSnapshot, BaseCellValue, BaseRow } from "../../../../../shared/bases-ipc";
import type { BaseStoreMutation, StoredBase } from "../../base-store-model";
import { canonicalJson } from "../../../../../shared/local-storage/contracts";
import { fieldKey, type BasePatch, type BaseSyncEnvelope, type ConfirmedBase } from "./model";
import { diffBaseMetadata, isMetadataField, metadataTargets, readMetadataField, removeMetadataColumn, writeMetadataField } from "@ai-chat/cloud-protocol";
const equal = (a: unknown, b: unknown) => canonicalJson(a ?? null) === canonicalJson(b ?? null);

export function diffBase(before: Pick<StoredBase, "meta" | "rowsById">, after: BaseStoreMutation): BasePatch[] {
  const metadata = diffBaseMetadata(before.meta, after.meta);
  const patches: BasePatch[] = metadata.filter(patch => patch.kind === "put-column" || patch.kind === "set-column-field");
  const nextRows = new Map(after.rows.map(row => [row.id, row]));
  const ids = after.changedRowIds === "all" ? new Set([...before.rowsById.keys(), ...nextRows.keys()]) :
    new Set([...after.changedRowIds, ...(after.removedRowIds ?? [])]);
  for (const rowId of ids) {
    const old = before.rowsById.get(rowId), next = nextRows.get(rowId);
    if (!next && old) { patches.push({ kind: "delete-row", rowId }); continue; }
    if (next && !old) { patches.push({ kind: "create-row", row: next }); continue; }
    if (!old || !next) continue;
    for (const columnId of new Set([...Object.keys(old.values), ...Object.keys(next.values)])) {
      if (equal(old.values[columnId], next.values[columnId])) continue;
      const value = next.values[columnId];
      patches.push(value === undefined ? { kind: "unset", target: { rowId, columnId } } :
        { kind: "set", target: { rowId, columnId }, value });
    }
  }
  patches.push(...metadata.filter(patch => patch.kind !== "put-column" && patch.kind !== "set-column-field"));
  return patches;
}
export function readPatchValue(confirmed: ConfirmedBase, patch: BasePatch): unknown {
  if (isMetadataField(patch)) return readMetadataField(confirmed.meta, patch);
  if (patch.kind === "set-order") return confirmed.meta[patch.field].map(item => item.id);
  if ("target" in patch) return confirmed.rows.find(row => row.id === patch.target.rowId)?.values[patch.target.columnId] ?? null;
  if (patch.kind === "create-row" || patch.kind === "delete-row") return confirmed.rows.find(row => row.id === (patch.kind === "create-row" ? patch.row.id : patch.rowId)) ?? null;
  if (patch.kind === "put-column" || patch.kind === "delete-column") return confirmed.meta.columns.find(column => column.id === (patch.kind === "put-column" ? patch.column.id : patch.columnId)) ?? null;
  if (patch.kind === "put-view" || patch.kind === "delete-view") return confirmed.meta.views.find(view => view.id === (patch.kind === "put-view" ? patch.view.id : patch.viewId)) ?? null;
  return confirmed.meta[patch.field];
}
export function applyPatches(snapshot: BaseSnapshot, patches: readonly BasePatch[], tombstones: readonly string[]): BaseSnapshot {
  const meta = structuredClone(snapshot.meta);
  const rows = new Map<string, BaseRow>(snapshot.rows.map(row => [row.id, structuredClone(row)]));
  for (const patch of patches) {
    if (tombstones.includes(fieldKey(patch))) continue;
    if (isMetadataField(patch) && metadataTargets(patch).some(key => tombstones.includes(key))) continue;
    if ("target" in patch) {
      const { rowId, columnId } = patch.target;
      if (tombstones.includes(`row:${rowId}`) || tombstones.includes(`column:${columnId}`)) continue;
      const row = rows.get(rowId);
      const column = meta.columns.find(item => item.id === columnId);
      if (!row || !column || column.type === "formula") continue;
      if (patch.kind === "unset") delete row.values[columnId];
      else if (patch.kind === "set") row.values[columnId] = structuredClone(patch.value);
      else {
        const previous = row.values[columnId];
        if (typeof previous !== "number") throw new Error("Increment requires a numeric field");
        const next = previous + patch.amount;
        if (!Number.isFinite(next)) throw new Error("Increment exceeds the numeric range");
        row.values[columnId] = next;
      }
    } else switch (patch.kind) {
      case "set-column-field": case "set-view-field": writeMetadataField(meta, patch); break;
      case "create-row": if (!rows.has(patch.row.id)) rows.set(patch.row.id, structuredClone(patch.row)); break;
      case "delete-row": rows.delete(patch.rowId); break;
      case "put-column": {
        const index = meta.columns.findIndex(column => column.id === patch.column.id);
        if (index < 0) meta.columns.push(structuredClone(patch.column)); else meta.columns[index] = structuredClone(patch.column);
        break;
      }
      case "delete-column": removeMetadataColumn(meta, patch.columnId); for (const row of rows.values()) delete row.values[patch.columnId]; break;
      case "put-view": {
        const index = meta.views.findIndex(view => view.id === patch.view.id);
        if (index < 0) meta.views.push(structuredClone(patch.view)); else meta.views[index] = structuredClone(patch.view);
        break;
      }
      case "delete-view": meta.views = meta.views.filter(view => view.id !== patch.viewId); break;
      case "set-order": {
        const order = new Map(patch.ids.map((id, index) => [id, index]));
        // Keep remotely added identities that were absent from this local ordering intent.
        meta[patch.field].sort((a, b) => (order.get(a.id) ?? order.size) - (order.get(b.id) ?? order.size));
        break;
      }
      case "set-meta": meta[patch.field] = patch.value; break;
    }
  }
  return { meta, rows: [...rows.values()] };
}
export function projectBase(envelope: BaseSyncEnvelope): BaseSnapshot {
  if (!envelope.confirmed) throw new Error("Base has no confirmed snapshot");
  let projected: BaseSnapshot = { meta: envelope.confirmed.meta, rows: envelope.confirmed.rows };
  for (const operation of envelope.pendingOperations) {
    if (operation.state !== "blocked") projected = applyPatches(projected, operation.patches, envelope.tombstones);
  }
  return projected;
}
export function syncAttachmentRoots(envelope: BaseSyncEnvelope) {
  const roots = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const item = value as Record<string, unknown>;
    if (item.kind === "attachment" && typeof item.blobId === "string") roots.add(item.blobId);
    Object.values(item).forEach(visit);
  };
  visit(envelope.detachedCustody);
  visit(envelope.confirmed?.rows);
  visit(envelope.pendingOperations);
  visit(envelope.conflictCandidates.filter(candidate => candidate.state === "unresolved"));
  return roots;
}
export type { BaseCellValue };
