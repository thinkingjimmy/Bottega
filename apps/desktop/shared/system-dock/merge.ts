/**
 * [INPUT]: Depends on the shared DockLayout model and semantic keys.
 * [OUTPUT]: Provides the single snapshot three-way merge (base/local/remote) with delete-wins for base IDs, field-level item merge, ordered-set merge for the outer order and each limits Widget's Agent order, singleton de-duplication, explicit conflicts, resolution, and the no-base union preview.
 * [POS]: shared/system-dock conflict algorithm (PRD 4.3); the only merge the sync coordinator may apply. No op-log, CRDT, or per-item tombstones.
 */

import { dockLayoutSchema, semanticKey, type DockItem, type DockLayout } from "./layout";

export type MergeConflict =
  | { kind: "item"; itemId: string; field: string; local: unknown; remote: unknown }
  | { kind: "order"; local: string[]; remote: string[] }
  | { kind: "agent-order"; itemId: string; local: string[]; remote: string[] };
export type MergeChoice = "local" | "remote";
export type MergeResult =
  | { status: "merged"; layout: DockLayout }
  | { status: "conflict"; layout: DockLayout; conflicts: MergeConflict[]; resolve(choices: readonly MergeChoice[]): DockLayout };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
type Picker = (conflict: MergeConflict) => MergeChoice;

/**
 * Ordered set merge: drop anything deleted on either side, reuse a one-sided reorder, and
 * report a two-sided different order. New members keep their neighbour on the side that
 * introduced them; ties settle by stable ID so both machines reach the same answer.
 */
function mergeOrder(base: readonly string[], local: readonly string[], remote: readonly string[], survivors: ReadonlySet<string>,
  conflict: (localOrder: string[], remoteOrder: string[]) => MergeChoice | null): string[] {
  const baseSet = new Set(base);
  const common = (list: readonly string[]) => list.filter((value) => baseSet.has(value) && survivors.has(value));
  const b = common(base), l = common(local), r = common(remote);
  let spine: string[];
  if (same(l, b)) spine = r; else if (same(r, b) || same(l, r)) spine = l;
  else spine = conflict(l, r) === "remote" ? r : l;
  const result = [...spine];
  const additions = [...new Set([...local, ...remote])].filter((value) => !baseSet.has(value) && survivors.has(value)).sort();
  for (const value of additions) {
    const source = local.includes(value) ? local : remote;
    let anchor = -1;
    for (let index = source.indexOf(value) - 1; index >= 0; index -= 1) {
      anchor = result.indexOf(source[index]!);
      if (anchor >= 0) break;
    }
    result.splice(anchor + 1, 0, value);
  }
  return result;
}
function mergeFields(itemId: string, base: DockItem, local: DockItem, remote: DockItem, pick: Picker): DockItem {
  if (same(local, remote)) return local;
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (local.kind !== remote.kind) return pick({ kind: "item", itemId, field: "kind", local, remote }) === "remote" ? remote : local;
  const merged: Record<string, unknown> = {};
  const record = (value: DockItem) => value as unknown as Record<string, unknown>;
  for (const field of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const b = record(base)[field], l = record(local)[field], r = record(remote)[field];
    if (field === "widget" && local.kind === "widget" && remote.kind === "widget" && base.kind === "widget") {
      merged[field] = mergeWidget(itemId, base.widget, local.widget, remote.widget, pick);
      continue;
    }
    merged[field] = same(l, r) || same(r, b) ? l : same(l, b) ? r : pick({ kind: "item", itemId, field, local: l, remote: r }) === "remote" ? r : l;
  }
  return merged as DockItem;
}
function mergeWidget(itemId: string, base: Extract<DockItem, { kind: "widget" }>["widget"], local: typeof base, remote: typeof base, pick: Picker): typeof base {
  if (local.type !== "builtin.ai-limits" || remote.type !== "builtin.ai-limits" || base.type !== "builtin.ai-limits") {
    return same(local, remote) || same(remote, base) ? local : same(local, base) ? remote : pick({ kind: "item", itemId, field: "widget", local, remote }) === "remote" ? remote : local;
  }
  const survivors = new Set([...local.selectedBackends, ...remote.selectedBackends].filter((backend) =>
    !(base.selectedBackends.includes(backend) && (!local.selectedBackends.includes(backend) || !remote.selectedBackends.includes(backend)))));
  const selectedBackends = mergeOrder(base.selectedBackends, local.selectedBackends, remote.selectedBackends, survivors,
    (l, r) => pick({ kind: "agent-order", itemId, local: l, remote: r })) as typeof base.selectedBackends;
  const selectionByBackend: typeof base.selectionByBackend = {};
  for (const backend of selectedBackends) {
    const b = base.selectionByBackend[backend], l = local.selectionByBackend[backend], r = remote.selectionByBackend[backend];
    const value = same(l, r) || same(r, b) ? l : same(l, b) ? r : pick({ kind: "item", itemId, field: `selectionByBackend.${backend}`, local: l, remote: r }) === "remote" ? r : l;
    if (value) selectionByBackend[backend] = value;
  }
  return { ...local, selectedBackends, selectionByBackend };
}
/** Two independently added pins of one semantic singleton collapse onto the lexically smaller ID. */
function dedupeSingletons(items: DockItem[], order: string[]): { items: DockItem[]; order: string[] } {
  const keep = new Map<string, string>();
  for (const item of [...items].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const key = semanticKey(item);
    if (key && !keep.has(key)) keep.set(key, item.id);
  }
  const dropped = new Set(items.filter((item) => { const key = semanticKey(item); return key !== null && keep.get(key) !== item.id; }).map((item) => item.id));
  return { items: items.filter((item) => !dropped.has(item.id)), order: order.filter((value) => !dropped.has(value)) };
}
function run(base: DockLayout, local: DockLayout, remote: DockLayout, pick: Picker): DockLayout {
  const b = new Map(base.items.map((item) => [item.id, item]));
  const l = new Map(local.items.map((item) => [item.id, item]));
  const r = new Map(remote.items.map((item) => [item.id, item]));
  const items: DockItem[] = [];
  for (const itemId of [...new Set([...l.keys(), ...r.keys()])].sort()) {
    const inBase = b.get(itemId), inLocal = l.get(itemId), inRemote = r.get(itemId);
    // Deletion of an ID that existed in the common base wins on either side.
    if (inBase && (!inLocal || !inRemote)) continue;
    if (inBase) { items.push(mergeFields(itemId, inBase, inLocal!, inRemote!, pick)); continue; }
    if (inLocal && inRemote) items.push(same(inLocal, inRemote) ? inLocal : pick({ kind: "item", itemId, field: "*", local: inLocal, remote: inRemote }) === "remote" ? inRemote : inLocal);
    else items.push((inLocal ?? inRemote)!);
  }
  const survivors = new Set(items.map((item) => item.id));
  const order = mergeOrder(base.order, local.order, remote.order, survivors, (lo, ro) => pick({ kind: "order", local: lo, remote: ro }));
  const deduped = dedupeSingletons(items, order);
  return dockLayoutSchema.parse({ schemaVersion: 1, initialized: base.initialized || local.initialized || remote.initialized || deduped.items.length > 0,
    items: deduped.items, order: deduped.order });
}
/** Three-way merge against a reliable common base; callers without one must use `unionPreview` and ask the user. */
export function mergeLayouts(base: DockLayout, local: DockLayout, remote: DockLayout): MergeResult {
  const conflicts: MergeConflict[] = [];
  const layout = run(base, local, remote, (conflict) => { conflicts.push(conflict); return "local"; });
  if (!conflicts.length) return { status: "merged", layout };
  return { status: "conflict", layout, conflicts, resolve(choices) {
    let index = 0;
    return run(base, local, remote, () => choices[index++] ?? "local");
  } };
}
/**
 * First-sync "merge" choice when no common base exists (4.3): keeps local order, then appends
 * remote-only items in remote order. It is a user-selected preview, never an automatic merge.
 */
export function unionPreview(local: DockLayout, remote: DockLayout): DockLayout {
  const localKeys = new Set(local.items.map((item) => semanticKey(item) ?? item.id));
  const extra = remote.order.map((itemId) => remote.items.find((item) => item.id === itemId)!)
    .filter((item) => !localKeys.has(semanticKey(item) ?? item.id) && !local.items.some((value) => value.id === item.id));
  const items = [...local.items, ...extra];
  const deduped = dedupeSingletons(items, [...local.order, ...extra.map((item) => item.id)]);
  return dockLayoutSchema.parse({ schemaVersion: 1, initialized: local.initialized || remote.initialized, items: deduped.items, order: deduped.order });
}
