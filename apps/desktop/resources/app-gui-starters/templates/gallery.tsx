/**
 * [INPUT]: Depends on typed Base query, attachment projection, declared Host export, and Bottega Gallery Blocks
 * [OUTPUT]: Provides the Gallery/Catalog official Starter entry
 * [POS]: Production authoring template for preview/search/detail/export flows
 */

import { useEffect, useState } from "react";
import { useBaseRows, useFileExport } from "@bottega/app-react";
import {
  AttachmentViewer, DataPage, DetailDrawer, EmptyState,
  ErrorState, ExportButton, FilterBar, LoadingState, VirtualDataTable,
} from "@bottega/app-blocks";
type Item = { rowId: string; values: Record<string, unknown> };

export default function GalleryStarter() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Item | null>(null);
  const [exporting, setExporting] = useState(false);
  const [prepared, setPrepared] = useState<{ data: string; sha256: `sha256:${string}` } | null>(null);
  const exportFile = useFileExport();
  const result = useBaseRows<{ rows: Item[] }>({
    shape: {
      version: 1, mode: "rows",
      projection: ["title", "previewUrl", "mediaType"],
      filter: search
        ? { kind: "condition", columnId: "title", operator: "contains", value: search }
        : undefined,
    },
    page: { limit: 100 },
  });
  useEffect(() => {
    let current = true;
    const data = JSON.stringify({ selection: selected?.rowId ?? null });
    void crypto.subtle.digest("SHA-256", new TextEncoder().encode(data)).then((digest) => {
      const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
      if (current) setPrepared({ data, sha256: `sha256:${hex}` });
    });
    return () => { current = false; };
  }, [selected?.rowId]);
  const exportSelection = async () => {
    if (!prepared) return;
    setExporting(true);
    try {
      await exportFile({
        data: prepared.data,
        request: {
          version: 1,
          suggestedName: "catalog-selection.json",
          mediaType: "application/json",
          byteLength: new TextEncoder().encode(prepared.data).byteLength,
          sha256: prepared.sha256,
        },
      });
    } finally {
      setExporting(false);
    }
  };
  const content = result.status === "loading"
    ? <LoadingState />
    : result.status === "error"
      ? <ErrorState action={<button className="min-h-11 rounded-md border px-4" onClick={result.retry}>Retry</button>} />
      : <VirtualDataTable
          rows={result.data.rows}
          getRowId={(row) => row.rowId}
          onActivateRow={setSelected}
          empty={<EmptyState />}
          columns={[{ id: "title", header: "Item", cell: (row) => String(row.values.title ?? row.rowId) }]}
        />;
  return <DataPage title="Catalog" actions={<ExportButton busy={exporting} disabled={!prepared} onExport={exportSelection} />}>
    <FilterBar onReset={() => setSearch("")}><label className="grid gap-1 text-sm">Search<input className="min-h-11 rounded-md border px-3" value={search} onChange={(event) => setSearch(event.target.value)} /></label></FilterBar>
    <div className="mt-4">{content}</div>
    <DetailDrawer open={Boolean(selected)} title={String(selected?.values.title ?? "Item")} onClose={() => setSelected(null)}>{selected && <AttachmentViewer alt={String(selected.values.title ?? "Preview")} mediaType={String(selected.values.mediaType ?? "")} source={String(selected.values.previewUrl ?? "")} />}</DetailDrawer>
  </DataPage>;
}
