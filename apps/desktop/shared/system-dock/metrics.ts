/**
 * [INPUT]: Depends on the machine-local Dock edge vocabulary.
 * [OUTPUT]: Provides axis-aware bar metrics, a shared face-to-metric projection, compact content-dependent sidebar extents, anchors, overflow calculations and usable panel dimensions.
 * [POS]: shared/system-dock geometry kernel; main never measures DOM, the renderer never guesses window bounds, both read these numbers.
 */

import type { DockEdge } from "./local-state";

export const DOCK_METRICS = {
  /* Glyphs fill the 48 DIP slot. gap 1 leaves the icon art's own margin as the visible gutter. */
  item: 48, gap: 1, padding: 10, separator: 13, overflowButton: 36, emptyCta: 208,
  widget: { "builtin.ai-limits": 136, "builtin.ai-activity": 116 } as Record<string, number>,
  sidebarWidget: { setup: 64, single: 68, activity: 60, ring: 36, gap: 6, padding: 8, more: 20, maximum: 148 },
  sidebarEmptyCta: 132,
  barHeight: 68, handleWidth: 132, handleHeight: 10, bottomMargin: 6, sideMargin: 16,
  /* The corner macOS gives a frameless window's native material (measured at 17 pt on macOS 26); the strip's lit
     edge follows it at every scale. The bar window is exactly the strip, so the two must agree. */
  stripRadius: 17,
  panel: { width: 360, height: 440, minWidth: 320, minHeight: 240, gap: 8 },
} as const;

export type MetricItem = { kind: string; widgetType?: string; limits?: { configured: boolean; sourceCount: number; more: number } };
/** Only projection facts affect geometry; the same adapter serves main and the item renderer. */
export function metricItem(item: { kind: string; widget?: { type: string; configured?: boolean; sources?: readonly unknown[]; more?: number } }): MetricItem {
  const widget = item.widget;
  return { kind: item.kind, widgetType: widget?.type,
    ...(widget?.type === "builtin.ai-limits" ? { limits: { configured: widget.configured === true, sourceCount: widget.sources?.length ?? 0, more: widget.more ?? 0 } } : {}) };
}
export function itemExtent(item: MetricItem, edge: DockEdge): number {
  if (item.kind !== "widget" || !item.widgetType) return DOCK_METRICS.item;
  if (edge === "bottom") return DOCK_METRICS.widget[item.widgetType] ?? DOCK_METRICS.item;
  const side = DOCK_METRICS.sidebarWidget;
  if (item.widgetType === "builtin.ai-activity") return side.activity;
  if (item.widgetType !== "builtin.ai-limits") return DOCK_METRICS.item;
  if (!item.limits) return side.maximum;
  const { configured, sourceCount, more } = item.limits;
  if (!configured || sourceCount === 0) return side.setup;
  if (sourceCount === 1 && more === 0) return side.single;
  const count = Math.min(sourceCount, 3);
  return count * side.ring + Math.max(0, count - 1) * side.gap + side.padding + (more > 0 ? side.more : 0);
}
/** Main-axis content extent in DIP before Dock scale, including padding and the running separator. */
export function barExtent(pinned: readonly MetricItem[], running: readonly MetricItem[], overflow: boolean, edge: DockEdge): number {
  const extents = [...pinned, ...running].map((item) => itemExtent(item, edge));
  const count = extents.length + (overflow ? 1 : 0);
  // An empty Dock still shows its "add" call to action instead of a zero-width strip (INV-07).
  if (!count) return edge === "bottom" ? DOCK_METRICS.emptyCta : DOCK_METRICS.sidebarEmptyCta;
  return DOCK_METRICS.padding * 2 + extents.reduce((sum, value) => sum + value, 0) + Math.max(0, count - 1) * DOCK_METRICS.gap
    + (running.length && pinned.length ? DOCK_METRICS.separator : 0) + (overflow ? DOCK_METRICS.overflowButton : 0);
}
/**
 * How many pinned items fit (running items overflow first, then trailing pinned items).
 * Never shrinks items below their size and never clips a Widget value (3.2).
 */
export function fitItems(pinned: readonly MetricItem[], running: readonly MetricItem[], available: number, edge: DockEdge): { pinned: number; running: number } {
  if (barExtent(pinned, running, false, edge) <= available) return { pinned: pinned.length, running: running.length };
  for (let r = running.length; r >= 0; r -= 1) if (barExtent(pinned, running.slice(0, r), true, edge) <= available) return { pinned: pinned.length, running: r };
  for (let p = pinned.length; p >= 0; p -= 1) if (barExtent(pinned.slice(0, p), [], true, edge) <= available) return { pinned: p, running: 0 };
  return { pinned: 0, running: 0 };
}
/** Main-axis centre of an item relative to the strip's leading edge (DIP, unscaled). */
export function itemCenter(visible: readonly MetricItem[], index: number, pinnedCount: number, edge: DockEdge): number {
  let position = DOCK_METRICS.padding;
  for (let i = 0; i < index; i += 1) position += itemExtent(visible[i]!, edge) + DOCK_METRICS.gap + (i === pinnedCount - 1 && pinnedCount < visible.length ? DOCK_METRICS.separator : 0);
  return position + itemExtent(visible[index]!, edge) / 2;
}
