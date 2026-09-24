/**
 * [INPUT]: Depends on React state/refs and DOM geometry of `[data-item-id]` bar slots.
 * [OUTPUT]: Provides `useBarReorder`: pointer-driven drag of pinned items (and running items into the pinned area) with a live placeholder, per-slot shift offsets, click suppression, cancel on Escape/pointercancel, and exactly one commit per drop.
 * [POS]: system-dock/bar interaction kernel; it never writes the layout — the drop hands one final pinned index to the caller, which turns it into move / pin-running intents (3.2 "commit once on drop").
 */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

const DRAG_THRESHOLD = 4;
export type ReorderDrop = Readonly<{ itemId: string; source: "pinned" | "running"; index: number }>;
type Slot = { id: string; left: number; width: number };
type Session = {
  id: string; source: "pinned" | "running"; pointerId: number; startX: number; startY: number;
  element: HTMLElement; slots: Slot[]; origin: number; boundary: number; zoom: number; active: boolean;
};
export type ReorderView = Readonly<{ id: string; dx: number; target: number | null; shift: number; source: "pinned" | "running"; origin: number }>;

/** Final index in the pinned order for a pointer at `x`, ignoring the dragged item itself. */
export function dropIndex(slots: readonly Slot[], draggedId: string, x: number) {
  return slots.filter((slot) => slot.id !== draggedId && slot.left + slot.width / 2 < x).length;
}

export function useBarReorder({ gap, onDrop }: { gap: number; onDrop(drop: ReorderDrop): void }) {
  const session = useRef<Session | null>(null);
  const suppressClick = useRef(false);
  const [view, setView] = useState<ReorderView | null>(null);
  const onDropRef = useRef(onDrop);
  useEffect(() => { onDropRef.current = onDrop; });
  // Stable identity: the hover reporter subscribes once and asks this on every leave.
  const dragging = useCallback(() => Boolean(session.current?.active), []);

  const reset = () => {
    const current = session.current;
    session.current = null;
    if (current?.active) {
      try { current.element.releasePointerCapture?.(current.pointerId); } catch { /* capture already gone */ }
    }
    setView(null);
  };
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape" && session.current?.active) { event.preventDefault(); suppressClick.current = true; reset(); } };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, []);

  const target = (current: Session, x: number) => current.source === "pinned" || x < current.boundary ? dropIndex(current.slots, current.id, x) : null;
  const project = (current: Session, x: number): ReorderView => {
    const dragged = current.element.getBoundingClientRect();
    return { id: current.id, source: current.source, origin: current.origin, dx: (x - current.startX) / current.zoom,
      target: target(current, x), shift: dragged.width / current.zoom + gap };
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
      const pinned = [...strip.querySelectorAll<HTMLElement>('[data-item-id][data-area="pinned"]')];
      const slots = pinned.map((element) => {
        const rect = element.getBoundingClientRect();
        return { id: element.dataset.itemId!, left: rect.left, width: rect.width };
      });
      const last = slots.at(-1);
      const zoom = Number(getComputedStyle(strip).zoom) || 1;
      session.current = { id, source, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, element: event.currentTarget,
        slots, origin: source === "pinned" ? slots.findIndex((slot) => slot.id === id) : -1,
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
      setView(project(current, event.clientX));
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      const current = session.current;
      if (!current || event.pointerId !== current.pointerId) return;
      if (!current.active) { session.current = null; return; }
      suppressClick.current = true;
      const index = target(current, event.clientX);
      reset();
      if (index === null || (current.source === "pinned" && index === current.origin)) return;
      onDropRef.current({ itemId: current.id, source: current.source, index });
    },
    onPointerCancel() { if (session.current?.active) suppressClick.current = true; reset(); },
  };
}

/** Horizontal offset (unzoomed CSS px) a slot should take so the placeholder opens at the drop target. */
export function slotOffset(view: ReorderView | null, id: string, index: number, area: "pinned" | "running") {
  if (!view) return 0;
  if (id === view.id) return view.dx;
  if (area !== "pinned" || view.target === null) return 0;
  if (view.source === "running") return index >= view.target ? view.shift : 0;
  if (view.target > view.origin && index > view.origin && index <= view.target) return -view.shift;
  if (view.target < view.origin && index >= view.target && index < view.origin) return view.shift;
  return 0;
}
