/**
 * [INPUT]: Depends on React and TanStack Virtual through compiler-signed product dependency edges
 * [OUTPUT]: Provides the @bottega/app-blocks audited runtime/type source snapshot
 * [POS]: Product-owned high-level App UI source; compiler embeds it as a virtual module while Apps compose it without gaining Host authority
 */

export const BLOCKS_RUNTIME_SOURCE = String.raw`
import React, { useEffect, useId, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
const button = "inline-flex min-h-11 items-center justify-center rounded-md border px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";
const focusable = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const modalStack = [];
function useModalFocus(open, onClose) {
  const dialog = useRef(null); const previous = useRef(null); const modalId = useRef(Symbol("modal")); const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const id = modalId.current; const root = dialog.current; const entry = { id, root };
    const nestedIndex = modalStack.findIndex((item) => root?.contains(item.root));
    if (nestedIndex >= 0) modalStack.splice(nestedIndex, 0, entry); else modalStack.push(entry);
    previous.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const items = () => [...(root?.querySelectorAll(focusable) ?? [])].filter((item) => !item.hidden);
    (items()[0] ?? root)?.focus();
    const key = (event) => {
      if (modalStack.at(-1)?.id !== id) return;
      if (event.key === "Escape") { event.preventDefault(); close.current(); return; }
      if (event.key !== "Tab" || !root) return;
      const targets = items(); if (!targets.length) { event.preventDefault(); root.focus(); return; }
      const first = targets[0]; const last = targets.at(-1); const active = document.activeElement;
      if (event.shiftKey && (active === first || !root.contains(active))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && active === last) { event.preventDefault(); first.focus(); }
    };
    addEventListener("keydown", key);
    return () => {
      removeEventListener("keydown", key);
      const wasTop = modalStack.at(-1)?.id === id; const index = modalStack.findIndex((item) => item.id === id); if (index >= 0) modalStack.splice(index, 1);
      const target = previous.current; if (wasTop) queueMicrotask(() => { if (target?.isConnected) target.focus(); });
    };
  }, [open]);
  return dialog;
}

export function DataPage({ title, description, actions, children }) {
  return <main className="mx-auto flex min-h-full w-full max-w-screen-2xl flex-col gap-4 p-4 sm:p-6"><header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><h1 className="text-balance text-2xl font-semibold">{title}</h1>{description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}</div>{actions && <div className="flex min-h-11 flex-wrap items-center gap-2">{actions}</div>}</header><div className="min-h-0 flex-1">{children}</div></main>;
}
export function FilterBar({ label = "Filter data", children, onReset }) {
  return <form aria-label={label} className="flex flex-col gap-2 rounded-lg border bg-card p-3 sm:flex-row sm:items-end" role="search" onReset={(event) => { event.preventDefault(); onReset?.(); }}><div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">{children}</div>{onReset && <button className={button} type="reset">Reset filters</button>}</form>;
}
export function DetailDrawer({ open, title, description, onClose, children }) {
  const titleId = useId(); const descriptionId = useId(); const dialog = useModalFocus(open, onClose);
  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/35" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}><section aria-describedby={description ? descriptionId : undefined} aria-labelledby={titleId} aria-modal="true" className="flex h-full w-full max-w-lg flex-col overflow-hidden bg-background shadow-xl" ref={dialog} role="dialog" tabIndex={-1}><header className="flex min-h-14 items-start justify-between gap-4 border-b p-4"><div><h2 className="font-semibold" id={titleId}>{title}</h2>{description && <p className="text-sm text-muted-foreground" id={descriptionId}>{description}</p>}</div><button aria-label="Close details" className={button} type="button" onClick={onClose}>Close</button></header><div className="min-h-0 flex-1 overflow-auto p-4">{children}</div></section></div>;
}
export function FormFooter({ dirty, submitting, unknownOutcome, onReset, submitLabel = "Save" }) {
  return <footer className="sticky bottom-0 flex flex-col gap-2 border-t bg-background/95 p-3 sm:flex-row sm:items-center sm:justify-between"><p aria-live="polite" className="text-sm text-muted-foreground">{unknownOutcome ? "The result is unknown. Reconcile before retrying." : dirty ? "Unsaved changes" : "All changes saved"}</p><div className="flex gap-2">{onReset && <button className={button} disabled={!dirty || submitting} type="button" onClick={onReset}>Discard</button>}<button className={button} disabled={!dirty || submitting || unknownOutcome} type="submit">{submitting ? "Saving…" : submitLabel}</button></div></footer>;
}
function StatePanel({ role = "status", title, description, action, busy = false }) { return <section aria-busy={busy || undefined} className="grid min-h-48 place-items-center rounded-lg border border-dashed p-6 text-center" role={role}><div className="max-w-md"><h2 className="font-medium">{title}</h2>{description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}{action && <div className="mt-4">{action}</div>}</div></section>; }
export function LoadingState({ label = "Loading data…" }) { return <StatePanel busy title={label} />; }
export function EmptyState({ title = "No results", description, action }) { return <StatePanel title={title} description={description} action={action} />; }
export function ErrorState({ title = "Data could not be loaded", description, action }) { return <StatePanel role="alert" title={title} description={description} action={action} />; }
export function PermissionState({ title = "Permission required", description, action }) { return <StatePanel role="alert" title={title} description={description} action={action} />; }
export function MutationBanner({ state, onReconcile }) { const unknown = state === "unknown-outcome"; return <div aria-live={unknown ? "assertive" : "polite"} className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 text-sm" role={unknown ? "alert" : "status"}><span>{state === "optimistic" ? "Saving changes…" : unknown ? "The save outcome is unknown." : "Changes saved."}</span>{unknown && onReconcile && <button className={button} type="button" onClick={onReconcile}>Check current data</button>}</div>; }

function ConfirmDialog({ open, title, description, confirmLabel, destructive, onConfirm, onCancel }) {
  const titleId = useId(); const descriptionId = useId(); const dialog = useModalFocus(open, onCancel); if (!open) return null;
  return <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4"><section aria-describedby={descriptionId} aria-labelledby={titleId} aria-modal="true" className="w-full max-w-md rounded-lg border bg-background p-5 shadow-xl" ref={dialog} role="alertdialog" tabIndex={-1}><h2 className="font-semibold" id={titleId}>{title}</h2><p className="mt-2 text-sm text-muted-foreground" id={descriptionId}>{description}</p><div className="mt-5 flex justify-end gap-2"><button className={button} type="button" onClick={onCancel}>Cancel</button><button className={button + (destructive ? " border-destructive bg-destructive text-destructive-foreground" : " bg-primary text-primary-foreground")} type="button" onClick={onConfirm}>{confirmLabel}</button></div></section></div>;
}
export function RevisionConflictDialog(props) { return <ConfirmDialog {...props} confirmLabel={props.confirmLabel ?? "Reload latest"} />; }
export function DestructiveConfirm(props) { return <ConfirmDialog {...props} destructive confirmLabel={props.confirmLabel ?? "Delete"} />; }
export function AttachmentViewer({ source, alt, mediaType }) { if (!mediaType?.startsWith("image/")) return <ErrorState title="Preview unavailable" description="This attachment type has no inline preview." />; return <figure className="overflow-hidden rounded-lg border bg-muted/20"><img alt={alt} className="max-h-[70vh] w-full object-contain" decoding="async" loading="lazy" src={source} /></figure>; }
export function ExportButton({ busy, disabled, onExport, children = "Export" }) { return <button className={button} disabled={busy || disabled} type="button" onClick={onExport}>{busy ? "Exporting…" : children}</button>; }

export function VirtualDataTable({ rows, columns, estimateSize = 44, getRowId, onActivateRow, empty }) {
  const parent = useRef(null); const virtualizer = useVirtualizer({ count: rows.length, getScrollElement: () => parent.current, estimateSize: () => Math.max(44, estimateSize), overscan: 8 }); if (!rows.length) return empty ?? <EmptyState />; const items = virtualizer.getVirtualItems();
  return <div aria-colcount={columns.length} aria-rowcount={rows.length} className="max-h-[70vh] overflow-auto rounded-lg border" ref={parent} role="table"><div className="sticky top-0 z-10 grid min-h-11 bg-muted px-3 text-sm font-medium" role="row" style={{ gridTemplateColumns: 'repeat(' + columns.length + ', minmax(8rem, 1fr))' }}>{columns.map((column) => <div key={column.id} className="flex items-center" role="columnheader">{column.header}</div>)}</div><div className="relative" style={{ height: virtualizer.getTotalSize() }}>{items.map((item) => { const row = rows[item.index]; const rowId = getRowId(row); return <div aria-rowindex={item.index + 2} className="absolute left-0 top-0 grid min-h-11 w-full border-t px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring" key={rowId} role="row" style={{ gridTemplateColumns: 'repeat(' + columns.length + ', minmax(8rem, 1fr))', transform: 'translateY(' + item.start + 'px)' }} tabIndex={0} onDoubleClick={() => onActivateRow?.(row)} onKeyDown={(event) => { if (event.key === "Enter") onActivateRow?.(row); }}>{columns.map((column) => <div key={column.id} className="flex min-w-0 items-center truncate" role="cell">{column.cell(row)}</div>)}</div>; })}</div></div>;
}
`;

export const BLOCKS_TYPES_SOURCE = String.raw`
declare module "@bottega/app-blocks" {
  import type { ReactElement, ReactNode } from "react"; type Action = ReactNode;
  export function DataPage(props: { title: string; description?: string; actions?: Action; children?: ReactNode }): ReactElement;
  export function FilterBar(props: { label?: string; children?: ReactNode; onReset?: () => void }): ReactElement;
  export function DetailDrawer(props: { open: boolean; title: string; description?: string; onClose(): void; children?: ReactNode }): ReactElement | null;
  export function FormFooter(props: { dirty: boolean; submitting?: boolean; unknownOutcome?: boolean; onReset?: () => void; submitLabel?: string }): ReactElement;
  export function LoadingState(props: { label?: string }): ReactElement; export function EmptyState(props: { title?: string; description?: string; action?: Action }): ReactElement; export function ErrorState(props: { title?: string; description?: string; action?: Action }): ReactElement; export function PermissionState(props: { title?: string; description?: string; action?: Action }): ReactElement;
  export function MutationBanner(props: { state: "optimistic" | "saved" | "unknown-outcome"; onReconcile?: () => void }): ReactElement;
  type Confirm = { open: boolean; title: string; description: string; confirmLabel?: string; onConfirm(): void; onCancel(): void };
  export function RevisionConflictDialog(props: Confirm): ReactElement | null; export function DestructiveConfirm(props: Confirm): ReactElement | null;
  export function AttachmentViewer(props: { source: string; alt: string; mediaType: string }): ReactElement; export function ExportButton(props: { busy?: boolean; disabled?: boolean; onExport(): void; children?: ReactNode }): ReactElement;
  export function VirtualDataTable<Row>(props: { rows: readonly Row[]; columns: readonly { id: string; header: ReactNode; cell(row: Row): ReactNode }[]; estimateSize?: number; getRowId(row: Row): string; onActivateRow?: (row: Row) => void; empty?: ReactNode }): ReactElement;
}
`;
