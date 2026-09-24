/**
 * [INPUT]: Depends on the shared DockLayout model and its category/semantic-key projections.
 * [OUTPUT]: Provides pure layout edits: default insertion points, singleton-aware add, drop-time move, remove with an undo token that re-adds under a fresh ID, clear, and bounded import append.
 * [POS]: shared/system-dock editing kernel used by main (the only Store writer) and by renderer previews; never performs I/O.
 */

import { dockLayoutSchema, DOCK_LAYOUT_BUDGET, itemCategory, newDockItemId, orderedItems, semanticKey,
  type DockItem, type DockItemDraft, type DockLayout } from "./layout";

export type AddResult = { layout: DockLayout; itemId: string; added: boolean };
export type UndoToken = { draft: DockItemDraft; index: number };
export type EditFailure = "budget" | "invalid" | "missing";

/**
 * Deterministic fallback after the default groups have been broken by free drags (3.3):
 * Apps follow the last App (else Finder, else the start); Widgets and non-Finder system
 * entries precede the first such entry (else the end); Finder always goes first.
 */
export function defaultInsertIndex(layout: DockLayout, draft: DockItemDraft): number {
  const items = orderedItems(layout);
  const category = itemCategory(draft);
  if (category === "finder") return 0;
  if (category === "app") {
    const lastApp = items.findLastIndex((item) => itemCategory(item) === "app");
    if (lastApp >= 0) return lastApp + 1;
    const finder = items.findIndex((item) => itemCategory(item) === "finder");
    return finder >= 0 ? finder + 1 : 0;
  }
  const firstTrailing = items.findIndex((item) => itemCategory(item) === "trailing");
  return firstTrailing >= 0 ? firstTrailing : items.length;
}
export function findSemantic(layout: DockLayout, draft: DockItemDraft): DockItem | undefined {
  const key = semanticKey(draft);
  return key ? layout.items.find((item) => semanticKey(item) === key) : undefined;
}
function commit(layout: DockLayout, items: DockItem[], order: string[]): DockLayout {
  return dockLayoutSchema.parse({ ...layout, initialized: true, items, order });
}
/** Singletons and duplicate pins keep their existing position (3.3); a Widget is never deduplicated. */
export function addItem(layout: DockLayout, draft: DockItemDraft, options: { index?: number; mint?: () => string } = {}): AddResult | { failure: EditFailure } {
  const existing = findSemantic(layout, draft);
  if (existing) return { layout, itemId: existing.id, added: false };
  if (layout.items.length >= DOCK_LAYOUT_BUDGET.items) return { failure: "budget" };
  const item = { ...draft, id: (options.mint ?? newDockItemId)() } as DockItem;
  const index = Math.max(0, Math.min(options.index ?? defaultInsertIndex(layout, draft), layout.order.length));
  const order = [...layout.order]; order.splice(index, 0, item.id);
  try { return { layout: commit(layout, [...layout.items, item], order), itemId: item.id, added: true }; }
  catch { return { failure: "invalid" }; }
}
/** One commit per drop; never called on pointer move. `index` is the final position in the resulting order. */
export function moveItem(layout: DockLayout, itemId: string, index: number): DockLayout | { failure: EditFailure } {
  const from = layout.order.indexOf(itemId);
  if (from < 0) return { failure: "missing" };
  const order = layout.order.filter((value) => value !== itemId);
  order.splice(Math.max(0, Math.min(index, order.length)), 0, itemId);
  return commit(layout, layout.items, order);
}
/** Unpinning is not uninstalling, quitting, or emptying anything (INV-07). */
export function removeItem(layout: DockLayout, itemId: string): { layout: DockLayout; undo: UndoToken } | { failure: EditFailure } {
  const index = layout.order.indexOf(itemId);
  const item = layout.items.find((value) => value.id === itemId);
  if (index < 0 || !item) return { failure: "missing" };
  const { id: _id, ...draft } = item;
  return { layout: commit(layout, layout.items.filter((value) => value.id !== itemId), layout.order.filter((value) => value !== itemId)),
    undo: { draft: draft as DockItemDraft, index } };
}
/** Undo mints a new valid ID so a synced deletion of the old ID still wins (4.3). */
export function undoRemove(layout: DockLayout, token: UndoToken, mint?: () => string): AddResult | { failure: EditFailure } {
  return addItem(layout, token.draft, { index: token.index, mint });
}
export function updateItem(layout: DockLayout, itemId: string, change: (item: DockItem) => DockItem): DockLayout | { failure: EditFailure } {
  const current = layout.items.find((item) => item.id === itemId);
  if (!current) return { failure: "missing" };
  const next = change(current);
  if (next.id !== itemId || next.kind !== current.kind) return { failure: "invalid" };
  try { return commit(layout, layout.items.map((item) => item.id === itemId ? next : item), layout.order); }
  catch { return { failure: "invalid" }; }
}
/** An initialized empty layout is a deliberate choice and is never refilled with defaults (INV-07). */
export function clearLayout(layout: DockLayout): DockLayout {
  return dockLayoutSchema.parse({ ...layout, initialized: true, items: [], order: [] });
}
/** Manual copy appends only confirmed candidates, keeping their relative system order (3.3). */
export function appendImported(layout: DockLayout, drafts: readonly DockItemDraft[], mint?: () => string): { layout: DockLayout; added: string[]; skipped: number } {
  let next = layout; const added: string[] = []; let skipped = 0;
  for (const draft of drafts) {
    const result = addItem(next, draft, { mint });
    if ("failure" in result || !result.added) { skipped += 1; continue; }
    next = result.layout; added.push(result.itemId);
  }
  return { layout: next, added, skipped };
}
export function isLayoutEmpty(layout: DockLayout): boolean {
  return layout.items.length === 0;
}
