/**
 * [INPUT]: React context and host-owned record contributions.
 * [OUTPUT]: Composable action, result and settings slots shared by every Base view and toolbar.
 * [POS]: Presentation-only injection boundary; contribution hosts retain all data and execution authority.
 */
import { createContext, useContext, useMemo, type ReactNode } from "react";

export type RecordContribution = Readonly<{
  id: string;
  label: string;
  summary?: boolean;
  actions?(rowId: string, title: string): ReactNode;
  results?(rowId: string, placement: "summary" | "record"): ReactNode;
  settings?: ReactNode;
  toolbar?: ReactNode;
}>;
const EMPTY: readonly RecordContribution[] = [];
const Slots = createContext<readonly RecordContribution[]>(EMPTY);
export const useRecordSlots = () => useContext(Slots);

export function RecordSlotsProvider({ contributions = EMPTY, children }: {
  contributions?: readonly RecordContribution[]; children: ReactNode;
}) {
  const inherited = useRecordSlots();
  const value = useMemo(() => {
    const slots = new Map(inherited.map(slot => [slot.id, slot]));
    for (const slot of contributions) slots.set(slot.id, slot);
    return [...slots.values()];
  }, [inherited, contributions]);
  return <Slots.Provider value={value}>{children}</Slots.Provider>;
}

export function RecordActions({ rowId, title = rowId }: { rowId: string; title?: string }) {
  return <span className="inline-flex items-center gap-1" data-record-actions={rowId}
    onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    {useRecordSlots().map(slot => <span className="contents" key={slot.id}>{slot.actions?.(rowId, title)}</span>)}
  </span>;
}

export function RecordResults({ rowId, placement = "summary", contributionId }: {
  rowId: string; placement?: "summary" | "record"; contributionId?: string;
}) {
  return <div className={placement === "summary" ? "flex min-w-0 flex-wrap items-center gap-1" : "space-y-3"}
    data-record-results={rowId} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => event.stopPropagation()}>
    {useRecordSlots().filter(slot => !contributionId || contributionId === slot.id).map(slot =>
      <div className="min-w-0 empty:hidden" key={slot.id}>{slot.results?.(rowId, placement)}</div>)}
  </div>;
}

export function RecordToolbar() {
  return <>{useRecordSlots().map(slot => <span className="contents" key={slot.id}>{slot.toolbar}{slot.settings}</span>)}</>;
}
