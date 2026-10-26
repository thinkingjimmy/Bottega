/**
 * [INPUT]: Depends on React state/refs and DOM geometry of `[data-item-id]` bar slots, excluding anchored Downloads/Trash.
 * [OUTPUT]: Provides `useBarReorder`: edge-aware drag reorder, running-to-pinned drops and pinned-item drag-out removal, with a removal preview, click suppression, placement cancellation, Escape/pointercancel cancellation, and one commit on release.
 * [POS]: system-dock/bar interaction kernel; it never writes the layout — the caller turns each completed gesture into move, pin-running or remove intents.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import type { DockEdge } from "../../../shared/system-dock/local-state";

const DRAG_THRESHOLD = 4;
const REMOVE_DISTANCE = 32;
export type ReorderDrop = Readonly<{ itemId: string; source: "pinned" | "running" } & ({ kind: "move"; index: number } | { kind: "remove" })>;
type Slot = { id: string; left: number; width: number };
type Session = {
  id: string; source: "pinned" | "running"; pointerId: number; startX: number; startY: number;
  vertical: boolean; element: HTMLElement; slots: Slot[]; bounds: DOMRect; origin: number; boundary: number; zoom: number; active: boolean;
};
export type ReorderView = Readonly<{ id: string; dx: number; target: number | null; shift: number; source: "pinned" | "running"; origin: number; removing: boolean }>;

/** Final index in the pinned order for a pointer at `x`, ignoring the dragged item itself. */
export function dropIndex(slots: readonly Slot[], draggedId: string, x: number) {
  return slots.filter((slot) => slot.id !== draggedId && slot.left + slot.width / 2 < x).length;
}

export function useBarReorder({ gap, edge, resetKey, onDrop }: { gap: number; edge: DockEdge; resetKey: string; onDrop(drop: ReorderDrop): void }) {
  const session = useRef<Session | null>(null);
  const suppressClick = useRef(false);
  const key = `${edge}:${resetKey}`;
  const [rendered, setRendered] = useState<{ key: string; view: ReorderView | null }>(() => ({ key, view: null }));
  // Drop stale placeholders in this render, before the moved window can paint or accept another gesture.
  if (rendered.key !== key) setRendered({ key, view: null });
  const view = rendered.key === key ? rendered.view : null;
  const onDropRef = useRef(onDrop);
  useEffect(() => { onDropRef.current = onDrop; });
  // Stable identity: the hover reporter subscribes once and asks this on every leave.
  const dragging = useCallback(() => Boolean(session.current?.active), []);

  const clearSession = useCallback(() => {
    const current = session.current;
    session.current = null;
    if (current?.active) {
      try { current.element.releasePointerCapture?.(current.pointerId); } catch { /* capture already gone */ }
    }
  }, []);
  const reset = useCallback(() => {
    clearSession();
    setRendered({ key, view: null });
  }, [clearSession, key]);
  useLayoutEffect(() => {
    if (session.current?.active) suppressClick.current = true;
    clearSession();
  }, [clearSession, key]);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape" && session.current?.active) { event.preventDefault(); suppressClick.current = true; reset(); } };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [reset]);

  const target = (current: Session, x: number) => current.source === "pinned" || x < current.boundary ? dropIndex(current.slots, current.id, x) : null;
  const outside = (current: Session, x: number, y: number) => Math.max(current.bounds.left - x, x - current.bounds.right,
    current.bounds.top - y, y - current.bounds.bottom) > REMOVE_DISTANCE * current.zoom;
  const project = (current: Session, x: number, y: number): ReorderView => {
    const dragged = current.element.getBoundingClientRect();
    const axis = current.vertical ? y : x;
    const detached = outside(current, x, y);
    return { id: current.id, source: current.source, origin: current.origin, dx: (axis - (current.vertical ? current.startY : current.startX)) / current.zoom,
      removing: current.source === "pinned" && detached, target: detached ? null : target(current, axis),
      shift: (current.vertical ? dragged.height : dragged.width) / current.zoom + gap };
  };

  return {
    view,
    /** True while a pointer drag owns the gesture, so hover-leave and clicks can be held back. */
    dragging,
    consumeClick() { const value = suppressClick.current; suppressClick.current = false; return value; },
    onPointerDown(event: ReactPointerEvent<HTMLElement>, id: string, source: "pinned" | "running") {
      // Ctrl-click is the macOS secondary click; it belongs to the context menu, not a drag.
      if (event.button !== 0 || event.ctrlKey) return;
      const strip = event.currentTarget.closest<HTMLElement>("[data-strip]");
      if (!strip) return;
      const vertical = edge !== "bottom";
      const pinned = [...strip.querySelectorAll<HTMLElement>('[data-item-id][data-area="pinned"]:not([data-entry="system.downloads"]):not([data-entry="system.trash"])')];
      const slots = pinned.map((element) => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.itemId!, left: vertical ? rect.top : rect.left, width: vertical ? rect.height : rect.width };
      });
      const last = slots.at(-1);
      const zoom = Number(getComputedStyle(strip).zoom) || 1;
      session.current = { id, source, vertical, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, element: event.currentTarget,
        slots, bounds: strip.getBoundingClientRect(), origin: source === "pinned" ? slots.findIndex((slot) => slot.id === id) : -1,
        // A running item joins the pinned area only when dropped before the separator's midpoint.
        boundary: last ? last.left + last.width + gap * zoom : Number.POSITIVE_INFINITY, zoom, active: false };
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (!current.active) {
        if (Math.hypot(event.clientX - current.startX, event.clientY - current.startY) < DRAG_THRESHOLD) return;
        current.active = true;
        try { current.element.setPointerCapture?.(current.pointerId); } catch { /* synthetic pointer */ }
      }
      setRendered({ key, view: project(current, event.clientX, event.clientY) });
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (!current.active) { session.current = null; return; }
      suppressClick.current = true;
      const detached = outside(current, event.clientX, event.clientY);
      const index = target(current, current.vertical ? event.clientY : event.clientX);
      reset();
      if (detached) {
        if (current.source === "pinned") onDropRef.current({ kind: "remove", itemId: current.id, source: current.source });
        return;
      }
      if (index === null || (current.source === "pinned" && index === current.origin)) return;
      onDropRef.current({ kind: "move", itemId: current.id, source: current.source, index });
    },
    onPointerCancel() { if (session.current?.active) suppressClick.current = true; reset(); },
  };
}

/** Main-axis offset (unzoomed CSS px) a slot should take so the placeholder opens at the drop target. */
export function slotOffset(view: ReorderView | null, id: string, index: number, area: "pinned" | "running") {
  if (!view) return 0;
  if (id === view.id) return view.dx;
  if (area !== "pinned" || view.target === null) return 0;
  if (view.source === "running") return index >= view.target ? view.shift : 0;
  if (view.target > view.origin && index > view.origin && index <= view.target) return -view.shift;
  if (view.target < view.origin && index >= view.target && index < view.origin) return view.shift;
  return 0;
}
