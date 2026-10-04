/**
 * [INPUT]: Depends on the shared Chat order key and App-role banding from @ai-chat/cloud-protocol/chats/order.
 * [OUTPUT]: Provides resolveDropSlot (which gap a hover means, or null for a no-op), planDrop (the sortKey writes a drop needs) and finalOrder.
 * [POS]: Pure geometry-free policy of components/sidebar/reorder; the DndContext owner turns pointer events into these calls and never computes keys itself.
 */
import { chatOrderKey, chatRoleOrder, type ChatOrder } from "@ai-chat/cloud-protocol/chats/order";
import type { DropEdge } from "./row-props";

export type ReorderRow = {
  id: string;
  /** Native rows carry a local record and can be dragged; cloud mirrors only define slots. */
  draggable: boolean;
  order: ChatOrder;
};
/** The two rows around the insertion gap, already filtered to the active row's App-role band. */
export type DropSlot = { gap: number; above: ReorderRow | null; below: ReorderRow | null };
export type SortKeyWrite = { chatId: string; sortKey: number };
export type DropOptions = { appProject?: boolean };

/* Keys live in creation-millisecond space, so one millisecond is the natural unit for "just above the top"
   and "just below the bottom"; MIN_STEP is a few float64 ulps at ~1.7e12, the point where midpoints stop separating. */
const STEP = 1;
const MIN_STEP = 1e-3;

export const rowKey = (row: ReorderRow) => chatOrderKey(row.order);
const band = (row: ReorderRow, options: DropOptions) => options.appProject ? chatRoleOrder(row.order.kind) : 0;

/**
 * Rows are the container's full sorted list (visible page included), `edge` is the half of `overId` the overlay
 * centre is on. Returns null when the drop would leave the order unchanged or cross an App-role band.
 */
export function resolveDropSlot(rows: readonly ReorderRow[], activeId: string, overId: string, edge: DropEdge,
  options: DropOptions = {}): DropSlot | null {
  const activeIndex = rows.findIndex(row => row.id === activeId), overIndex = rows.findIndex(row => row.id === overId);
  if (activeIndex < 0 || overIndex < 0) return null;
  const active = rows[activeIndex]!, over = rows[overIndex]!;
  if (!active.draggable || band(active, options) !== band(over, options)) return null;
  const gap = edge === "before" ? overIndex : overIndex + 1;
  if (gap === activeIndex || gap === activeIndex + 1) return null;
  const neighbour = (row: ReorderRow | undefined) => row && band(row, options) === band(active, options) ? row : null;
  return { gap, above: neighbour(rows[gap - 1]), below: neighbour(rows[gap]) };
}

/** The container in the order a drop into `slot` produces. */
export function finalOrder(rows: readonly ReorderRow[], activeId: string, slot: Pick<DropSlot, "gap">) {
  const activeIndex = rows.findIndex(row => row.id === activeId);
  const active = rows[activeIndex]!, without = rows.filter(row => row.id !== activeId);
  without.splice(slot.gap - (activeIndex < slot.gap ? 1 : 0), 0, active);
  return without;
}

/**
 * Normally one write: the midpoint of the neighbours (or ±1ms past a list end). When that key does not fit — floats no
 * longer separate the neighbours (same-millisecond imports, or a gap split ~30 times), or it would go below zero — the
 * smallest run of draggable rows around the slot with room at its bounds is renumbered evenly instead. Bounds that are
 * themselves equal fall back to the id tiebreak.
 */
export function planDrop(rows: readonly ReorderRow[], activeId: string, slot: DropSlot, options: DropOptions = {}): SortKeyWrite[] {
  const above = slot.above ? rowKey(slot.above) : null, below = slot.below ? rowKey(slot.below) : null;
  const key = above !== null && below !== null ? (above + below) / 2 : above !== null ? above - STEP : below !== null ? below + STEP : null;
  if (key !== null && (above === null || key < above) && (below === null || key > below) && key >= 0) return [{ chatId: activeId, sortKey: key }];
  return renumber(rows, activeId, slot, options);
}

function renumber(rows: readonly ReorderRow[], activeId: string, slot: DropSlot, options: DropOptions): SortKeyWrite[] {
  const order = finalOrder(rows, activeId, slot), position = order.findIndex(row => row.id === activeId);
  const active = order[position]!, activeBand = band(active, options);
  const eligible = (row: ReorderRow | undefined) => Boolean(row?.draggable) && band(row!, options) === activeBand;
  const bound = (row: ReorderRow | undefined) => row && band(row, options) === activeBand ? rowKey(row) : null;
  let start = position, end = position;
  const room = () => {
    const run = order.slice(start, end + 1), keys = run.map(rowKey);
    const hi = bound(order[start - 1]) ?? Math.max(...keys) + STEP, lo = bound(order[end + 1]) ?? Math.max(0, Math.min(...keys) - STEP);
    return { hi, lo, run, ok: hi - lo >= (run.length + 1) * MIN_STEP };
  };
  let current = room();
  while (!current.ok) {
    const up = start > 0 && eligible(order[start - 1]), down = end < order.length - 1 && eligible(order[end + 1]);
    if (!up && !down) break;
    if (up && (!down || end - position >= position - start)) start--; else end++;
    current = room();
  }
  const { hi, lo, run } = current;
  if (!(hi > lo)) return [{ chatId: activeId, sortKey: hi }];
  return run.map((row, index) => ({ chatId: row.id, sortKey: hi - (hi - lo) * (index + 1) / (run.length + 1) }))
    .filter(write => write.sortKey !== order.find(row => row.id === write.chatId)!.order.sortKey);
}
