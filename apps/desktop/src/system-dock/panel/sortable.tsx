/**
 * [INPUT]: Depends on React, lucide move/grip glyphs, the panel context (translator, announcements) and row geometry.
 * [OUTPUT]: Provides `SortableList`: a vertical list whose rows reorder by pointer drag on a grip (live placeholder, one commit on drop, Escape/pointercancel cancel) or by keyboard Move up / Move down buttons, announcing each move.
 * [POS]: system-dock/panel reorder primitive shared by the Dock edit view and the AI limits Agent order; it reports a final index and never persists anything itself.
 */

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from "react";
import { ChevronDown, ChevronUp, GripVertical } from "lucide-react";
import { usePanel } from "./context";

type Drag = { id: string; pointerId: number; startY: number; origin: number; centers: number[]; height: number; element: HTMLElement; active: boolean };
export type SortableRow = Readonly<{ id: string; name: string }>;

export function SortableList<T extends SortableRow>({ rows, label, onMove, render }: {
  rows: readonly T[]; label: string; onMove(id: string, index: number): void;
  render(row: T, controls: ReactNode): ReactNode;
}) {
  const { t, announce } = usePanel();
  const drag = useRef<Drag | null>(null);
  const [view, setView] = useState<{ id: string; dy: number; target: number; origin: number; height: number } | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const cancel = () => {
    const current = drag.current;
    drag.current = null;
    if (current?.active) try { current.element.releasePointerCapture?.(current.pointerId); } catch { /* already released */ }
    setView(null);
  };
  useEffect(() => {
    // Capture phase: a cancelled drag must not also close the panel through the layered Escape.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !drag.current?.active) return;
      event.preventDefault(); event.stopPropagation(); cancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
  /* Moving a row to an edge disables the button that moved it; once the new order arrives,
     keyboard focus moves to its sibling instead of falling back to the document. */
  const lastMoved = useRef<{ id: string; direction: "up" | "down" } | null>(null);
  useEffect(() => {
    const moved = lastMoved.current;
    if (!moved) return;
    const row = listRef.current?.querySelector<HTMLElement>(`:scope > li[data-row="${moved.id}"]`);
    const button = row?.querySelector<HTMLButtonElement>(`[data-move="${moved.direction}"]`);
    if (!button || document.activeElement === button && !button.disabled) return;
    lastMoved.current = null;
    if (button.disabled) row?.querySelector<HTMLButtonElement>(`[data-move="${moved.direction === "up" ? "down" : "up"}"]`)?.focus();
  }, [rows]);
  const move = (row: T, index: number, direction?: "up" | "down") => {
    lastMoved.current = direction ? { id: row.id, direction } : null;
    onMove(row.id, index);
    announce(t("settings.providers.moved", { name: row.name, position: index + 1, total: rows.length }));
  };
  const targetFor = (current: Drag, y: number) => current.centers.filter((center, index) => index !== current.origin && center < y).length;
  const grip = (row: T, index: number) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (event.button !== 0) return;
      const elements = [...(listRef.current?.querySelectorAll<HTMLElement>(":scope > li") ?? [])];
      const centers = elements.map((element) => { const rect = element.getBoundingClientRect(); return rect.top + rect.height / 2; });
      const rowElement = elements[index]!;
      drag.current = { id: row.id, pointerId: event.pointerId, startY: event.clientY, origin: index, centers,
        height: rowElement.getBoundingClientRect().height, element: event.currentTarget, active: false };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      if (!current.active) {
        if (Math.abs(event.clientY - current.startY) < 4) return;
        current.active = true;
        try { current.element.setPointerCapture?.(current.pointerId); } catch { /* synthetic pointer */ }
      }
      setView({ id: current.id, dy: event.clientY - current.startY, target: targetFor(current, event.clientY), origin: current.origin, height: current.height });
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const target = current.active ? targetFor(current, event.clientY) : current.origin;
      cancel();
      if (target !== current.origin) move(row, target);
    },
    onPointerCancel: cancel,
    onLostPointerCapture: () => { if (drag.current?.active) cancel(); },
  });
  const offset = (index: number, id: string) => {
    if (!view) return 0;
    if (id === view.id) return view.dy;
    if (view.target > view.origin && index > view.origin && index <= view.target) return -view.height;
    if (view.target < view.origin && index >= view.target && index < view.origin) return view.height;
    return 0;
  };
  return <ul ref={listRef} className="sortable" aria-label={label} data-dragging={view ? "true" : undefined}>
    {rows.map((row, index) => <li key={row.id} data-row={row.id} className="sortable-row" data-dragging={view?.id === row.id || undefined}
      style={{ "--offset": `${offset(index, row.id)}px` } as CSSProperties}>
      {render(row, <>
        <span className="grip" role="presentation" title={t("settings.providers.reorder", { name: row.name })} {...grip(row, index)}>
          <GripVertical aria-hidden="true" /></span>
        <button type="button" className="icon-button small" data-move="up" disabled={index === 0} aria-label={t("systemDock.edit.moveUp", { name: row.name })}
          title={t("systemDock.edit.moveUp", { name: row.name })} onClick={() => move(row, index - 1, "up")}><ChevronUp aria-hidden="true" /></button>
        <button type="button" className="icon-button small" data-move="down" disabled={index === rows.length - 1} aria-label={t("systemDock.edit.moveDown", { name: row.name })}
          title={t("systemDock.edit.moveDown", { name: row.name })} onClick={() => move(row, index + 1, "down")}><ChevronDown aria-hidden="true" /></button>
      </>)}
    </li>)}
  </ul>;
}
