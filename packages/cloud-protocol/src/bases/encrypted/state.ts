/**
 * [INPUT]: Opaque encrypted Base fields, independent row life/revision counters and closed targets.
 * [OUTPUT]: Pure indexed-state projection and field mutation helpers without semantic value access.
 * [POS]: Shared transaction representation; server adapters supply one consistent bounded snapshot.
 */
import type { BaseCipherTarget, EncryptedBaseField, EncryptedBaseHead, EncryptedBaseProjection, EncryptedBaseRow } from "./model";
import { baseTargetKey } from "./wire";
export type EncryptedBaseState = { head: EncryptedBaseHead; rows: EncryptedBaseRow[]; tombstones: string[] };
export function targetVersion(state: EncryptedBaseState, target: BaseCipherTarget): number {
  if (target.kind === "row") return state.rows.find(row => row.rowId === target.rowId)?.lifeVersion ?? 0;
  if (target.kind === "cell") return state.rows.find(row => row.rowId === target.rowId)?.fieldVersions[target.columnId] ?? 0;
  return state.head.fieldVersions[baseTargetKey(target)] ?? 0;
}
export function targetDeleted(state: EncryptedBaseState, target: BaseCipherTarget): boolean {
  const key = baseTargetKey(target);
  return state.tombstones.some(value => value === "base" || value === key || key.startsWith(`${value}:`)) || target.kind === "cell" &&
    (state.tombstones.includes(`row:${target.rowId}`) || state.tombstones.includes(`column:${target.columnId}`));
}
export function projectEncryptedTarget(state: EncryptedBaseState, target: BaseCipherTarget): EncryptedBaseProjection {
  const key = baseTargetKey(target), version = targetVersion(state, target);
  const source = target.kind === "cell" || target.kind === "row" ? state.rows.find(row => row.rowId === target.rowId)?.fields ?? [] : state.head.fields;
  const field = source.find(value => baseTargetKey(value.binding.target) === key) ?? null;
  if (target.kind === "row") return { target, version, field, related: source.filter(value => value.binding.target.kind === "cell") };
  if (target.kind === "column" || target.kind === "view") return { target, version, field,
    related: source.filter(value => baseTargetKey(value.binding.target).startsWith(`${key}:`)) };
  if (!field && (target.kind === "column-field" || target.kind === "view-field")) {
    const root = target.kind === "column-field" ? `column:${target.columnId}` : `view:${target.viewId}`;
    const parent = source.find(value => baseTargetKey(value.binding.target) === root);
    return { target, version, field, related: parent ? [parent, ...source.filter(value => baseTargetKey(value.binding.target).startsWith(`${root}:`))] : [] };
  }
  return { target, version, field, related: [] };
}
export function replaceEncryptedField(fields: EncryptedBaseField[], field: EncryptedBaseField) {
  const key = baseTargetKey(field.binding.target), index = fields.findIndex(value => baseTargetKey(value.binding.target) === key);
  if (index < 0) fields.push(field); else fields[index] = field;
  return fields.filter(value => !baseTargetKey(value.binding.target).startsWith(`${key}:`));
}
export function removeEncryptedTarget(state: EncryptedBaseState, target: BaseCipherTarget) {
  const key = baseTargetKey(target);
  if (target.kind === "row") state.rows = state.rows.filter(row => row.rowId !== target.rowId);
  else if (target.kind === "cell") {
    const row = state.rows.find(row => row.rowId === target.rowId);
    if (row) row.fields = row.fields.filter(value => baseTargetKey(value.binding.target) !== key);
  } else {
    state.head.fields = state.head.fields.filter(value => baseTargetKey(value.binding.target) !== key && !baseTargetKey(value.binding.target).startsWith(`${key}:`));
    if (target.kind === "column") {
      state.head.authority.columnIds = state.head.authority.columnIds.filter(id => id !== target.columnId);
      for (const row of state.rows) {
        if (row.fields.some(field => field.binding.target.kind === "cell" && field.binding.target.columnId === target.columnId)) {
          row.fields = row.fields.filter(field => field.binding.target.kind !== "cell" || field.binding.target.columnId !== target.columnId);
          row.fieldVersions[target.columnId] = (row.fieldVersions[target.columnId] ?? 0) + 1;
        }
      }
    }
    if (target.kind === "view") state.head.authority.viewIds = state.head.authority.viewIds.filter(id => id !== target.viewId);
  }
}
