/**
 * [INPUT]: Depends on React, typed Base hooks, and Bottega UI Blocks
 * [OUTPUT]: Provides the CRUD/list-detail official Starter entry
 * [POS]: Production authoring template combined with the shared compiled App scaffold
 */

import { useState } from "react";
import { useBaseRows } from "@bottega/app-react";
import {
  DataPage, DestructiveConfirm, EmptyState, ErrorState, FilterBar,
  LoadingState, PermissionState, RevisionConflictDialog, VirtualDataTable,
} from "@bottega/app-blocks";
type Row = { rowId: string; values: Record<string, unknown> };

export default function CrudStarter() {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Row | null>(null);
  const [remove, setRemove] = useState(false);
  const [conflict, setConflict] = useState(false);
  const result = useBaseRows<{ rows: Row[] }>({
    shape: {
      version: 1, mode: "rows", projection: ["name"],
      filter: query
        ? { kind: "condition", columnId: "name", operator: "contains", value: query }
        : undefined,
    },
    page: { limit: 100 },
  });
  const content = result.status === "loading"
    ? <LoadingState />
    : result.status === "error"
      ? result.error.code === "permission_denied"
        ? <PermissionState description="Grant Base read access in App settings." />
        : <ErrorState action={<button className="min-h-11 rounded-md border px-4" onClick={result.retry}>Retry</button>} />
      : <VirtualDataTable
          rows={result.data.rows}
          getRowId={(row) => row.rowId}
          onActivateRow={setSelected}
          empty={<EmptyState title="No matching records" />}
          columns={[{ id: "name", header: "Name", cell: (row) => String(row.values.name ?? "—") }]}
        />;
  return <DataPage title="Records" description="Search, inspect, and update revision-bound rows.">
    <FilterBar onReset={() => setQuery("")}><label className="grid gap-1 text-sm">Search<input className="min-h-11 rounded-md border px-3" value={query} onChange={(event) => setQuery(event.target.value)} /></label></FilterBar>
    <div className="mt-4">{content}</div>
    {selected && <div className="mt-4 flex min-h-11 items-center justify-between rounded-md border p-3"><span>{String(selected.values.name ?? selected.rowId)}</span><button className="min-h-11 rounded-md border px-4" onClick={() => setRemove(true)}>Delete</button></div>}
    <DestructiveConfirm open={remove} title="Delete this record?" description="This writes against the visible Base revision." onCancel={() => setRemove(false)} onConfirm={() => { setRemove(false); setConflict(true); }} />
    <RevisionConflictDialog open={conflict} title="The record changed" description="Reload the latest revision before applying this edit." onCancel={() => setConflict(false)} onConfirm={() => { setConflict(false); result.retry(); }} />
  </DataPage>;
}
