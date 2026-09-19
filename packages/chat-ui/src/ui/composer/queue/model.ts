/**
 * [INPUT]: Platform queue projections with independent native or remote custody.
 * [OUTPUT]: Minimal queue view item and its editability policy.
 * [POS]: The composer queue's presentation-only boundary; payloads remain in the owner port.
 */
export type QueueItem = { id: string; prompt: { displayText: string }; state: "queued" | "submitting" | "steering" | "ambiguous"; workspaceInvalidated?: true; readOnlyEdit?: boolean };
export const editableItem = (item: QueueItem) => item.state === "queued" && !item.workspaceInvalidated;

/** Mixed moves require the admission barrier before one coordinator transaction. */
export function queueMove<Row extends { intentId: string; kind: string }>(rows: readonly Row[], from: number, to: number) {
  const item = rows[from], target = rows[to];
  if (!item || !target) throw new Error("queue-authority-changed");
  const ordered = [...rows]; ordered.splice(to, 0, ordered.splice(from, 1)[0]!);
  const kind = item.kind === target.kind ? item.kind : "combined";
  return { kind, intentIds: ordered.filter(row => kind === "combined" || row.kind === kind).map(row => row.intentId) };
}
