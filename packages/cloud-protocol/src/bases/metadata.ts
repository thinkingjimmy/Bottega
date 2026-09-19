/**
 * [INPUT]: Depends on canonical Base metadata and the server-safe shared encrypted field-path schemas.
 * [OUTPUT]: Provides stable metadata paths, field reads/writes and structural diffs shared by both clients.
 * [POS]: Metadata intent kernel; collection members use IDs and arrays with coupled semantics remain atomic fields.
 */
import { z } from "zod";
import type { BaseMeta } from "@ai-chat/base-ui/model/bases-ipc";
import { scrubBaseFormulaColumns, scrubBaseRelationColumns, scrubBaseViews } from "@ai-chat/base-ui/compute/base-view-validation";
import type { BasePatch } from "./operations";
import { columnFieldPathSchema, viewFieldPathSchema } from "../encryption/domains/bases";
export { columnFieldPathSchema, viewFieldPathSchema } from "../encryption/domains/bases";
type MetadataFieldPatch = Extract<BasePatch, { kind: "set-column-field" | "set-view-field" }>;
type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === "object" && !Array.isArray(value) ? value as ObjectValue : {};
const same = (a: unknown, b: unknown) => JSON.stringify(stable(a ?? null)) === JSON.stringify(stable(b ?? null));
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort().map(([k, v]) => [k, stable(v)]));
  return value;
}
export function metadataRoot(patch: MetadataFieldPatch): string {
  return patch.kind === "set-column-field" ? `column:${patch.columnId}` : `view:${patch.viewId}`;
}
export function metadataTargets(patch: MetadataFieldPatch): string[] {
  const root = metadataRoot(patch), targets = [root];
  if (patch.path[0] === "options") targets.push(`${root}:options:${patch.path[1]}`);
  if (patch.path[1] === "charts") targets.push(`${root}:config:charts:${patch.path[2]}`);
  return targets;
}
function metadataObject(meta: BaseMeta, patch: MetadataFieldPatch) {
  return patch.kind === "set-column-field" ? meta.columns.find(c => c.id === patch.columnId) : meta.views.find(v => v.id === patch.viewId);
}
export function readMetadataPath(value: unknown, path: readonly string[]): unknown {
  if (!path.length) return value ?? null;
  const [key, ...tail] = path;
  if (key === "optionsOrder" || key === "chartsOrder") {
    const items = object(value)[key === "optionsOrder" ? "options" : "charts"];
    return Array.isArray(items) ? items.map(item => object(item).id) : [];
  }
  const next = Array.isArray(value) ? value.find(item => object(item).id === key) : object(value)[key!];
  return readMetadataPath(next, tail);
}
export function readMetadataField(meta: BaseMeta, patch: MetadataFieldPatch): unknown {
  return readMetadataPath(metadataObject(meta, patch), patch.path);
}
function assignPath(target: ObjectValue | unknown[], path: readonly string[], value: unknown, keepNull: boolean) {
  const [key, ...tail] = path;
  if (!key) throw new Error("invalid-metadata-path");
  if (Array.isArray(target)) {
    const index = target.findIndex(item => object(item).id === key);
    if (!tail.length) {
      if (value === null) { if (index >= 0) target.splice(index, 1); return; }
      if (index >= 0) throw new Error("metadata-fields-required");
      if (object(value).id !== key) throw new Error("metadata-identity-mismatch");
      target.push(structuredClone(value)); return;
    }
    if (index < 0) throw new Error("target-missing");
    assignPath(object(target[index]), tail, value, keepNull); return;
  }
  if (key === "optionsOrder" || key === "chartsOrder") {
    const field = key === "optionsOrder" ? "options" : "charts", items = target[field];
    if (!Array.isArray(items) || !Array.isArray(value) || items.length !== value.length ||
      new Set(value).size !== value.length || !items.every(item => value.includes(object(item).id))) throw new Error("order-membership-changed");
    items.sort((a, b) => value.indexOf(object(a).id) - value.indexOf(object(b).id)); return;
  }
  if (!tail.length) {
    // Relation labels and disabled aggregations use an explicit null; other optional properties are omitted.
    if (value === null && !keepNull) delete target[key];
    else target[key] = structuredClone(value);
    return;
  }
  if (target[key] === undefined) target[key] = key === "options" || key === "charts" ? [] : {};
  const child = target[key];
  if (!child || typeof child !== "object") throw new Error("invalid-metadata-path");
  assignPath(child as ObjectValue | unknown[], tail, value, keepNull);
}
export function writeMetadataField(meta: BaseMeta, patch: MetadataFieldPatch) {
  const target = metadataObject(meta, patch);
  if (!target) throw new Error("target-missing");
  (patch.kind === "set-column-field" ? columnFieldPathSchema : viewFieldPathSchema).parse(patch.path);
  assignPath(target as unknown as ObjectValue, patch.path, patch.value,
    patch.path[0] === "relation" || patch.path[1] === "columnAggregations");
}
export const isMetadataField = (patch: BasePatch): patch is MetadataFieldPatch => patch.kind === "set-column-field" || patch.kind === "set-view-field";
export const deletesMetadataMember = (patch: MetadataFieldPatch) => patch.value === null &&
  (patch.path[0] === "options" && patch.path.length === 2 || patch.path[1] === "charts" && patch.path.length === 3);
function diffFields(before: unknown, after: unknown, prefix: string[], emit: (path: string[], value: unknown) => void) {
  for (const key of new Set([...Object.keys(object(before)), ...Object.keys(object(after))])) {
    if (key === "id") continue;
    const a = object(before)[key], b = object(after)[key], path = [...prefix, key];
    if (same(a, b)) continue;
    if (key === "options" || key === "charts") {
      const old = (a ?? []) as ObjectValue[], next = (b ?? []) as ObjectValue[];
      for (const item of old) if (!next.some(other => other.id === item.id)) emit([...path, String(item.id)], null);
      for (const item of next) {
        const existing = old.find(other => other.id === item.id);
        if (existing) diffFields(existing, item, [...path, String(item.id)], emit);
        else emit([...path, String(item.id)], item);
      }
      const ids = next.map(item => item.id), projected = [...old.map(item => item.id).filter(id => ids.includes(id)), ...ids.filter(id => !old.some(item => item.id === id))];
      if (!same(projected, ids)) emit([...prefix, key + "Order"], ids);
    } else if (["config", "relation", "columnWidths", "columnAggregations"].includes(key)) diffFields(a, b, path, emit);
    else emit(path, b ?? null);
  }
}
export function diffBaseMetadata(before: BaseMeta, after: BaseMeta): BasePatch[] {
  const patches: BasePatch[] = [];
  before = structuredClone(before);
  for (const column of [...before.columns]) if (!after.columns.some(item => item.id === column.id)) {
    patches.push({ kind: "delete-column", columnId: column.id }); removeMetadataColumn(before, column.id);
  }
  for (const column of after.columns) {
    const old = before.columns.find(item => item.id === column.id);
    if (!old) patches.push({ kind: "put-column", column });
    else diffFields(old, column, [], (path, value) => patches.push({ kind: "set-column-field", columnId: column.id,
      path: columnFieldPathSchema.parse(path), value: z.json().parse(value) }));
  }
  for (const view of after.views) {
    const old = before.views.find(item => item.id === view.id);
    if (!old) patches.push({ kind: "put-view", view });
    else diffFields(old, view, [], (path, value) => patches.push({ kind: "set-view-field", viewId: view.id,
      path: viewFieldPathSchema.parse(path), value: z.json().parse(value) }));
  }
  for (const view of before.views) if (!after.views.some(item => item.id === view.id)) patches.push({ kind: "delete-view", viewId: view.id });
  for (const field of ["columns", "views"] as const) {
    const oldIds = before[field].map(item => item.id), ids = after[field].map(item => item.id);
    const projected = [...oldIds.filter(id => ids.includes(id)), ...ids.filter(id => !oldIds.includes(id))];
    if (!same(projected, ids)) patches.push({ kind: "set-order", field, ids });
  }
  for (const field of ["name", "activeViewId"] as const) if (before[field] !== after[field]) patches.push({ kind: "set-meta", field, value: after[field] });
  return patches;
}
export function removeMetadataColumn(meta: BaseMeta, columnId: string) {
  const removed = new Set([columnId]);
  meta.columns = scrubBaseRelationColumns(scrubBaseFormulaColumns(meta.columns.filter(c => c.id !== columnId), removed), removed);
  meta.views = scrubBaseViews(meta.views, removed, meta.columns);
  if (!meta.views.some(view => view.id === meta.activeViewId)) meta.activeViewId = meta.views[0]!.id;
}
export function removedMetadataMembers(before: BaseMeta, after: BaseMeta): string[] {
  const keys: string[] = [];
  for (const column of before.columns) {
    const next = after.columns.find(item => item.id === column.id);
    for (const option of column.options ?? []) if (!next?.options?.some(item => item.id === option.id)) keys.push(`column:${column.id}:options:${option.id}`);
  }
  for (const view of before.views) if (view.config.type === "chart") {
    const next = after.views.find(item => item.id === view.id);
    for (const chart of view.config.charts) if (next?.config.type !== "chart" || !next.config.charts.some(item => item.id === chart.id)) keys.push(`view:${view.id}:config:charts:${chart.id}`);
  }
  return keys;
}
export function changedMetadataKeys(before: BaseMeta, after: BaseMeta): string[] {
  const keys = new Set<string>();
  for (const [collection, kind] of [["columns", "column"], ["views", "view"]] as const) {
    for (const id of new Set([...before[collection], ...after[collection]].map(item => item.id))) {
      const a = before[collection].find(item => item.id === id), b = after[collection].find(item => item.id === id);
      if (!same(a, b)) {
        keys.add(`${kind}:${id}`);
        diffFields(a, b, [], path => { keys.add(`${kind}:${id}:${path.join(":")}`); });
      }
    }
  }
  return [...keys];
}
