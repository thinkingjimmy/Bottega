/**
 * [INPUT]: Depends on the shared bar metrics and plain display facts (DIP bounds/work area, possibly negative coordinates).
 * [OUTPUT]: Provides pure placement: display selection with bounded fallback, system-Dock-at-bottom detection from the work area, coexistence offset/hide policy, handle/bar bounds (the revealed bar window is exactly the strip, floating one margin up), the bar-gap hover test, item fitting, and panel bounds anchored to an item and clamped to the display.
 * [POS]: system-dock/window geometry kernel (INV-10); never covers more than the bar needs and never guesses a safe area it cannot see.
 */

import { barWidth, DOCK_METRICS, fitItems, itemCenter, type MetricItem } from "../../../../shared/system-dock/metrics";
import type { DockLocalState, DockMode } from "../../../../shared/system-dock/local-state";

export type Rect = { x: number; y: number; width: number; height: number };
export type DisplayFact = { id: number; bounds: Rect; workArea: Rect; primary: boolean };
export type BarPlacement = { display: DisplayFact; bounds: Rect; revealed: boolean; fit: { pinned: number; running: number }; hidden: boolean; fallback: boolean };

/** The preferred display if connected, otherwise the primary one; `fallback` marks the bounded retreat (D6). */
export function selectDisplay(displays: readonly DisplayFact[], preferred: number | null): { display: DisplayFact; fallback: boolean } | null {
  if (!displays.length) return null;
  const chosen = preferred === null ? undefined : displays.find((display) => display.id === preferred);
  if (chosen) return { display: chosen, fallback: false };
  return { display: displays.find((display) => display.primary) ?? displays[0]!, fallback: preferred !== null };
}
/** A visible bottom system Dock shrinks the work area from the bottom; auto-hidden or side Docks do not. */
export function systemDockBottomInset(display: DisplayFact): number {
  const bottom = display.bounds.y + display.bounds.height - (display.workArea.y + display.workArea.height);
  return bottom > 1 ? bottom : 0;
}
export function placeBar(input: { displays: readonly DisplayFact[]; state: DockLocalState; mode: DockMode; revealed: boolean; handle: boolean;
  pinned: readonly MetricItem[]; running: readonly MetricItem[] }): BarPlacement | null {
  const selected = selectDisplay(input.displays, input.state.displayPreference.displayId);
  if (!selected) return null;
  const { display, fallback } = selected;
  const scale = input.state.scale;
  const inset = input.mode === "coexist" ? systemDockBottomInset(display) : 0;
  // Coexistence yields to a pinned system Dock: sit above it, or stay out of the way entirely.
  const hidden = input.mode === "coexist" && inset > 0 && input.state.coexistenceFallback === "hide";
  const available = (display.bounds.width - DOCK_METRICS.sideMargin * 2) / scale;
  const fit = fitItems(input.pinned, input.running, available);
  const overflow = fit.pinned < input.pinned.length || fit.running < input.running.length;
  const bottom = display.bounds.y + display.bounds.height - inset;
  if (!input.revealed) {
    const width = DOCK_METRICS.handleWidth, height = input.handle ? DOCK_METRICS.handleHeight + 6 : 2;
    return { display, fallback, hidden, fit, revealed: false,
      bounds: round({ x: display.bounds.x + (display.bounds.width - width) / 2, y: bottom - height, width, height }) };
  }
  const width = Math.min(barWidth(input.pinned.slice(0, fit.pinned), input.running.slice(0, fit.running), overflow) * scale, display.bounds.width - DOCK_METRICS.sideMargin * 2);
  // The window is exactly the strip: its native material fills the whole window, so the margin is an offset, not window.
  const height = DOCK_METRICS.barHeight * scale;
  return { display, fallback, hidden, fit, revealed: true,
    bounds: round({ x: display.bounds.x + (display.bounds.width - width) / 2, y: bottom - height - DOCK_METRICS.bottomMargin * scale, width, height }) };
}
/** The strip of screen between a revealed bar and the edge below it still counts as "on the bar" (the window no longer covers it). */
export function inBarGap(bar: BarPlacement, point: { x: number; y: number }, scale: number): boolean {
  if (!bar.revealed) return false;
  const { x, y, width, height } = bar.bounds;
  return point.x >= x && point.x < x + width && point.y >= y + height && point.y <= y + height + DOCK_METRICS.bottomMargin * scale + 1;
}
/** Panel above the bar, horizontally centred on the anchor item when known, always inside the display. */
export function placePanel(bar: BarPlacement, visible: readonly MetricItem[], pinnedCount: number, anchorIndex: number | null, scale: number): Rect {
  const { width, height, gap } = DOCK_METRICS.panel;
  const display = bar.display.bounds;
  const center = anchorIndex !== null && anchorIndex >= 0 && anchorIndex < visible.length
    ? bar.bounds.x + itemCenter(visible, anchorIndex, pinnedCount) * scale : bar.bounds.x + bar.bounds.width / 2;
  const x = Math.min(Math.max(center - width / 2, display.x + DOCK_METRICS.sideMargin), display.x + display.width - DOCK_METRICS.sideMargin - width);
  const barTop = bar.revealed ? bar.bounds.y : bar.bounds.y - DOCK_METRICS.barHeight * scale;
  const y = Math.max(display.y + 8, barTop - gap - height);
  return round({ x, y, width, height: Math.min(height, barTop - gap - display.y - 8) });
}
function round(rect: Rect): Rect { return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }; }
