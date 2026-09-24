/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides the single set of bar metrics (item/widget widths, gaps, separator, handle, panel size) and the pure width/anchor/overflow calculations shared by main (window bounds) and the bar renderer (layout).
 * [POS]: shared/system-dock geometry kernel; main never measures DOM, the renderer never guesses window bounds, both read these numbers.
 */

export const DOCK_METRICS = {
  item: 48, gap: 6, padding: 10, separator: 13, overflowButton: 36, emptyCta: 208,
  widget: { "builtin.ai-limits": 136, "builtin.ai-activity": 116 } as Record<string, number>,
  barHeight: 68, handleWidth: 132, handleHeight: 10, bottomMargin: 6, sideMargin: 16,
  /* The corner macOS gives a frameless window's native material (measured at 17 pt on macOS 26); the strip's lit
     edge follows it at every scale. The bar window is exactly the strip, so the two must agree. */
  stripRadius: 17,
  panel: { width: 360, height: 440, gap: 8 },
} as const;

export type MetricItem = { kind: string; widgetType?: string };
export function itemWidth(item: MetricItem): number {
  return item.kind === "widget" && item.widgetType ? DOCK_METRICS.widget[item.widgetType] ?? DOCK_METRICS.item : DOCK_METRICS.item;
}
/** Content width in DIP before scale, including padding and the running-area separator. */
export function barWidth(pinned: readonly MetricItem[], running: readonly MetricItem[], overflow: boolean): number {
  const widths = [...pinned, ...running].map(itemWidth);
  const count = widths.length + (overflow ? 1 : 0);
  // An empty Dock still shows its "add" call to action instead of a zero-width strip (INV-07).
  if (!count) return DOCK_METRICS.emptyCta;
  return DOCK_METRICS.padding * 2 + widths.reduce((sum, value) => sum + value, 0) + Math.max(0, count - 1) * DOCK_METRICS.gap
    + (running.length && pinned.length ? DOCK_METRICS.separator : 0) + (overflow ? DOCK_METRICS.overflowButton : 0);
}
/**
 * How many pinned items fit (running items overflow first, then trailing pinned items).
 * Never shrinks items below their size and never clips a Widget value (3.2).
 */
export function fitItems(pinned: readonly MetricItem[], running: readonly MetricItem[], available: number): { pinned: number; running: number } {
  if (barWidth(pinned, running, false) <= available) return { pinned: pinned.length, running: running.length };
  for (let r = running.length; r >= 0; r -= 1) if (barWidth(pinned, running.slice(0, r), true) <= available) return { pinned: pinned.length, running: r };
  for (let p = pinned.length; p >= 0; p -= 1) if (barWidth(pinned.slice(0, p), [], true) <= available) return { pinned: p, running: 0 };
  return { pinned: 0, running: 0 };
}
/** Horizontal centre of the item at `index` in the visible sequence, relative to the bar's left edge (DIP, unscaled). */
export function itemCenter(visible: readonly MetricItem[], index: number, pinnedCount: number): number {
  let x = DOCK_METRICS.padding;
  for (let i = 0; i < index; i += 1) x += itemWidth(visible[i]!) + DOCK_METRICS.gap + (i === pinnedCount - 1 && pinnedCount < visible.length ? DOCK_METRICS.separator : 0);
  return x + itemWidth(visible[index]!) / 2;
}
