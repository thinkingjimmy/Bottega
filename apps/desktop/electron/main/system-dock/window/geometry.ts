/**
 * [INPUT]: Depends on shared axis metrics and logical display facts in DIP, including negative coordinates.
 * [OUTPUT]: Provides deterministic target resolution, bounded safe fallback, three-edge bar/handle/gap placement, interval-based shared edges and inward panel bounds respecting the shared content minimum.
 * [POS]: system-dock/window geometry kernel; never measures DOM, multiplies display scale factors or mutates the requested preference.
 */

import { barExtent, DOCK_METRICS, fitItems, itemCenter, type MetricItem } from "../../../../shared/system-dock/metrics";
import type { DockDisplay, DockPlacementReason, DockRect } from "../../../../shared/system-dock/displays";
import type { DockDisplayPreference, DockEdge, DockLocalState, DockMode } from "../../../../shared/system-dock/local-state";

export type Rect = DockRect;
export type DisplayFact = DockDisplay;
export type BarPlacement = {
  display: DisplayFact; bounds: Rect; safeArea: Rect; edge: DockEdge; revealed: boolean;
  fit: { pinned: number; running: number }; hidden: boolean; fallback: boolean;
  reason: DockPlacementReason; sharedEdge: boolean;
};
export type BarPlacementInput = {
  displays: readonly DisplayFact[]; state: DockLocalState; mode: DockMode; revealed: boolean; handle: boolean;
  pinned: readonly MetricItem[]; running: readonly MetricItem[]; currentDisplayId?: number | null;
};
type SelectedDisplay = { display: DisplayFact; fallback: boolean; reason: DockPlacementReason };
type DisplayGeometry = Pick<DisplayFact, "bounds" | "workArea">;

function validRect(rect: Rect): boolean {
  return [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width > 0 && rect.height > 0;
}
/** Intersect observed bounds and work area; neither negative coordinates nor Retina scale need correction. */
export function displaySafeArea(display: DisplayGeometry): Rect | null {
  if (!validRect(display.bounds) || !validRect(display.workArea)) return null;
  const x = Math.max(display.bounds.x, display.workArea.x), y = Math.max(display.bounds.y, display.workArea.y);
  const width = Math.min(display.bounds.x + display.bounds.width, display.workArea.x + display.workArea.width) - x;
  const height = Math.min(display.bounds.y + display.bounds.height, display.workArea.y + display.workArea.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}
/** Physical selection eligibility is independent of whether the current edge has room for the bar. */
export function isSelectableDisplay(display: DisplayGeometry & { id: number }): boolean {
  return Number.isInteger(display.id) && display.id !== -1 && display.id !== -10 && displaySafeArea(display) !== null;
}
function ordered(displays: readonly DisplayFact[]): DisplayFact[] {
  return [...displays].sort((a, b) => Number(b.primary) - Number(a.primary) || a.id - b.id);
}

/** Resolve the requested rule only; safe-space fallback is handled by resolveBarPlacement. */
export function selectDisplay(displays: readonly DisplayFact[], preference: DockDisplayPreference, currentDisplayId?: number | null): SelectedDisplay | null {
  const valid = ordered(displays.filter((display) => validRect(display.bounds)));
  const primary = valid[0];
  if (!primary) return null;
  const selectable = valid.filter((display) => display.selectable && isSelectableDisplay(display));
  if (preference.displayId !== null) {
    const target = selectable.find((display) => display.id === preference.displayId);
    if (target && preference.label !== null && target.label === preference.label) return { display: target, fallback: false, reason: "selected" };
    return { display: primary, fallback: true, reason: target ? "target-changed" : "unavailable" };
  }
  if (preference.preferExternal) {
    const external = selectable.filter((display) => !display.internal);
    const target = external.find((display) => display.id === currentDisplayId) ?? external[0];
    return target ? { display: target, fallback: false, reason: "external" } : { display: primary, fallback: true, reason: "unavailable" };
  }
  return { display: primary, fallback: false, reason: "primary" };
}

/** Insets describe the work area, not the identity of the system surface reserving it. */
export function displayEdgeInset(display: DisplayGeometry, edge: DockEdge): number {
  const safe = displaySafeArea(display);
  if (!safe) return 0;
  const inset = edge === "left" ? safe.x - display.bounds.x
    : edge === "right" ? display.bounds.x + display.bounds.width - safe.x - safe.width
      : display.bounds.y + display.bounds.height - safe.y - safe.height;
  return inset > 1 ? inset : 0;
}

export function resolveBarPlacement(input: BarPlacementInput): { placement: BarPlacement | null; reason: DockPlacementReason } {
  const selected = selectDisplay(input.displays, input.state.displayPreference, input.currentDisplayId);
  if (!selected) return { placement: null, reason: "no-display" };
  const preferred = onDisplay(input, selected);
  if (preferred) return { placement: preferred, reason: preferred.reason };
  for (const display of ordered(input.displays)) {
    if (display.id === selected.display.id) continue;
    const placement = onDisplay(input, { display, fallback: true, reason: selected.fallback ? selected.reason : "no-space" });
    if (placement) return { placement, reason: placement.reason };
  }
  return { placement: null, reason: "no-space" };
}
export function placeBar(input: BarPlacementInput): BarPlacement | null { return resolveBarPlacement(input).placement; }

function onDisplay(input: BarPlacementInput, selected: SelectedDisplay): BarPlacement | null {
  const { display, fallback, reason } = selected;
  const safeArea = displaySafeArea(display);
  if (!safeArea) return null;
  const { edge, scale } = input.state;
  const vertical = edge !== "bottom";
  const mainSize = vertical ? safeArea.height : safeArea.width, crossSize = vertical ? safeArea.width : safeArea.height;
  const available = (mainSize - DOCK_METRICS.sideMargin * 2) / scale;
  const minimum = barExtent([], [], input.pinned.length + input.running.length > 0, edge);
  if (available < minimum || crossSize < (DOCK_METRICS.barHeight + DOCK_METRICS.bottomMargin) * scale) return null;
  const fit = fitItems(input.pinned, input.running, available, edge);
  const overflow = fit.pinned < input.pinned.length || fit.running < input.running.length;
  const extent = barExtent(input.pinned.slice(0, fit.pinned), input.running.slice(0, fit.running), overflow, edge) * scale;
  const handleExtent = Math.min(DOCK_METRICS.handleWidth, mainSize);
  const mainExtent = input.revealed ? extent : handleExtent;
  const crossExtent = input.revealed ? DOCK_METRICS.barHeight * scale : input.handle ? DOCK_METRICS.handleHeight + 6 : 2;
  const margin = input.revealed ? DOCK_METRICS.bottomMargin * scale : 0;
  const mainStart = (vertical ? safeArea.y : safeArea.x) + (mainSize - mainExtent) / 2;
  const rect = edge === "bottom" ? { x: mainStart, y: safeArea.y + safeArea.height - crossExtent - margin, width: mainExtent, height: crossExtent }
    : { x: edge === "left" ? safeArea.x + margin : safeArea.x + safeArea.width - crossExtent - margin,
      y: mainStart, width: crossExtent, height: mainExtent };
  const bounds = roundInside(rect, safeArea);
  if (!bounds) return null;
  return { display, fallback, reason, safeArea, edge, bounds, fit, revealed: input.revealed,
    hidden: input.mode === "coexist" && displayEdgeInset(display, edge) > 0 && input.state.coexistenceFallback === "hide",
    sharedEdge: sharesHandleEdge(display, safeArea, input.displays, edge, handleExtent) };
}

/** Only the centered trigger interval can conflict with a neighboring display. */
function sharesHandleEdge(display: DisplayFact, safe: Rect, displays: readonly DisplayFact[], edge: DockEdge, extent: number): boolean {
  const vertical = edge !== "bottom";
  const start = (vertical ? safe.y : safe.x) + ((vertical ? safe.height : safe.width) - extent) / 2;
  const boundary = edge === "left" ? safe.x : edge === "right" ? safe.x + safe.width : safe.y + safe.height;
  return displays.some((neighbor) => {
    if (neighbor.id === display.id || !validRect(neighbor.bounds)) return false;
    const b = neighbor.bounds;
    const adjoining = edge === "left" ? b.x + b.width : edge === "right" ? b.x : b.y;
    const neighborStart = vertical ? b.y : b.x, neighborEnd = neighborStart + (vertical ? b.height : b.width);
    return Math.abs(adjoining - boundary) <= 1 && Math.min(start + extent, neighborEnd) > Math.max(start, neighborStart);
  });
}

/** The uncovered strip between the revealed window and its safe-area edge still counts as hover. */
export function inBarGap(bar: BarPlacement, point: { x: number; y: number }, scale: number): boolean {
  if (!bar.revealed) return false;
  const { x, y, width, height } = bar.bounds;
  const gap = DOCK_METRICS.bottomMargin * scale + 1;
  if (bar.edge === "bottom") return point.x >= x && point.x < x + width && point.y >= y + height && point.y <= Math.min(y + height + gap, bar.safeArea.y + bar.safeArea.height);
  const along = point.y >= y && point.y < y + height;
  return along && (bar.edge === "left" ? point.x >= Math.max(x - gap, bar.safeArea.x) && point.x <= x
    : point.x >= x + width && point.x <= Math.min(x + width + gap, bar.safeArea.x + bar.safeArea.width));
}

/** Panels open inward, shift along the edge, then shrink; an unusable viewport is refused. */
export function placePanel(bar: BarPlacement, visible: readonly MetricItem[], pinnedCount: number, anchorIndex: number | null, scale: number): Rect | null {
  const { gap, minWidth, minHeight } = DOCK_METRICS.panel;
  const safe = bar.safeArea, vertical = bar.edge !== "bottom";
  const center = anchorIndex !== null && anchorIndex >= 0 && anchorIndex < visible.length
    ? (vertical ? bar.bounds.y : bar.bounds.x) + itemCenter(visible, anchorIndex, pinnedCount, bar.edge) * scale
    : (vertical ? bar.bounds.y + bar.bounds.height / 2 : bar.bounds.x + bar.bounds.width / 2);
  const area = { x: safe.x + 8, y: safe.y + 8, width: safe.width - 16, height: safe.height - 16 };
  const reserved = bar.revealed ? 0 : (DOCK_METRICS.barHeight + DOCK_METRICS.bottomMargin) * scale;
  if (bar.edge === "bottom") {
    const top = bar.revealed ? bar.bounds.y : safe.y + safe.height - reserved;
    area.height = top - gap - area.y;
  } else if (bar.edge === "left") {
    const start = (bar.revealed ? bar.bounds.x + bar.bounds.width : safe.x + reserved) + gap;
    area.width -= start - area.x;
    area.x = start;
  } else {
    const end = (bar.revealed ? bar.bounds.x : safe.x + safe.width - reserved) - gap;
    area.width = end - area.x;
  }
  if (area.width < minWidth || area.height < minHeight) return null;
  const width = Math.min(DOCK_METRICS.panel.width, area.width), height = Math.min(DOCK_METRICS.panel.height, area.height);
  const x = vertical ? bar.edge === "left" ? area.x : area.x + area.width - width : clamp(center - width / 2, area.x, area.x + area.width - width);
  const y = vertical ? clamp(center - height / 2, area.y, area.y + area.height - height) : area.y + area.height - height;
  const bounds = roundInside({ x, y, width, height }, area);
  return bounds && bounds.width >= minWidth && bounds.height >= minHeight ? bounds : null;
}

function clamp(value: number, minimum: number, maximum: number): number { return Math.min(Math.max(value, minimum), maximum); }
function roundInside(rect: Rect, safe: Rect): Rect | null {
  const left = Math.ceil(safe.x), top = Math.ceil(safe.y), right = Math.floor(safe.x + safe.width), bottom = Math.floor(safe.y + safe.height);
  const width = Math.min(Math.round(rect.width), right - left), height = Math.min(Math.round(rect.height), bottom - top);
  if (width <= 0 || height <= 0) return null;
  return { x: clamp(Math.round(rect.x), left, right - width), y: clamp(Math.round(rect.y), top, bottom - height), width, height };
}
