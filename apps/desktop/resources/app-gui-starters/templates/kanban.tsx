/**
 * [INPUT]: Depends on dnd-kit keyboard context, typed Base query/mutation, and Bottega virtual/mutation Blocks
 * [OUTPUT]: Provides the Kanban/Planner official Starter entry
 * [POS]: Production authoring template for virtualized optimistic planning
 */

import { useState } from "react";
import { DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useBaseMutation, useBaseRows } from "@bottega/app-react";
import { DataPage, ErrorState, LoadingState, MutationBanner, VirtualDataTable } from "@bottega/app-blocks";
type Card = { rowId: string; values: Record<string, unknown> };
type CardQuery = { rows: Card[]; baseInstanceId: string; revision: number };

export default function KanbanStarter() {
  const rows = useBaseRows<CardQuery>({ shape: { version: 1, mode: "rows", projection: ["title", "status"], sort: [{ columnId: "status", direction: "asc" }] }, page: { limit: 200 } });
  const mutate = useBaseMutation();
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));
  const [mutation, setMutation] = useState<"saved" | "optimistic" | "unknown-outcome">("saved");
  if (rows.status === "loading") return <DataPage title="Planner"><LoadingState /></DataPage>;
  if (rows.status === "error") return <DataPage title="Planner"><ErrorState action={<button className="min-h-11 rounded-md border px-4" onClick={rows.retry}>Retry</button>} /></DataPage>;
  return <DataPage title="Planner"><MutationBanner state={mutation} onReconcile={rows.retry} /><DndContext sensors={sensors} onDragEnd={async (event) => {
    if (!event.over || event.active.id === event.over.id) return;
    setMutation("optimistic");
    try { await mutate({ kind: "patch", expectedBaseInstanceId: rows.data.baseInstanceId, expectedRevision: rows.data.revision, patches: [{ rowId: String(event.active.id), patch: { status: String(event.over.id) } }] }); setMutation("saved"); }
    catch { setMutation("unknown-outcome"); }
  }}><VirtualDataTable rows={rows.data.rows} getRowId={(row) => row.rowId} columns={[{ id: "title", header: "Card", cell: (row) => String(row.values.title ?? row.rowId) }, { id: "status", header: "Status", cell: (row) => String(row.values.status ?? "Unsorted") }]} /></DndContext></DataPage>;
}
