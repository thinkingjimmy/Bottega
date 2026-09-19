/**
 * [INPUT]: Depends on the complete filtered row projection, canonical labels and scoped record actions.
 * [OUTPUT]: Provides bounded record search and selection for all six views and compact screens.
 * [POS]: Common source-record entry; chart aggregates and map markers never become editable cells.
 */
import { useMemo, useState } from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@ai-chat/ui/components/ui/dialog";
import { baseCellText, cellValue, type BaseCellContext, type BaseColumn, type BaseRow } from "../../../model/bases-ipc";
import { useAppTranslation } from "../../platform/i18n";

export function BaseRecordBrowser({ open, rows, columns, context, onOpenChange, onSelect, onCreate }: {
  open: boolean; rows: BaseRow[]; columns: BaseColumn[]; context: BaseCellContext;
  onOpenChange(open: boolean): void; onSelect(row: BaseRow): void; onCreate?: () => void;
}) {
  const { t } = useAppTranslation(), [query, setQuery] = useState(""), [page, setPage] = useState(0);
  const matches = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase(), labelColumn = columns.find(column => column.type === "text") ?? columns[0];
    return rows.map(row => ({ row, label: labelColumn ? baseCellText(labelColumn, cellValue(row, labelColumn, context)) || row.id : row.id }))
      .filter(item => !needle || `${item.label}\n${item.row.id}`.toLocaleLowerCase().includes(needle));
  }, [rows, columns, context, query]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(matches.length / 100) - 1));
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent sheetOnNarrow className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
    <DialogHeader><DialogTitle>{t("bases.record.browse")}</DialogTitle>
      <DialogDescription>{t("bases.record.sourceDescription")}</DialogDescription></DialogHeader>
    <Input aria-label={t("bases.record.search")} placeholder={t("bases.record.search")} value={query}
      onChange={event => { setQuery(event.target.value); setPage(0); }} className="text-base" />
    <div className="max-h-[55dvh] space-y-1 overflow-y-auto">
      {matches.slice(currentPage * 100, (currentPage + 1) * 100).map(({ row, label }) => <Button key={row.id} variant="ghost" type="button"
        className="h-auto min-h-11 w-full justify-start whitespace-normal break-words text-left" onClick={() => onSelect(row)}>{label}</Button>)}
      {!matches.length && <p className="py-6 text-sm text-muted-foreground">{t("bases.record.noResults")}</p>}
    </div>
    <div className="flex flex-wrap gap-2 pb-[env(safe-area-inset-bottom)]">
      <Button variant="outline" type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>{t("bases.record.previous")}</Button>
      <Button variant="outline" type="button" disabled={(currentPage + 1) * 100 >= matches.length} onClick={() => setPage(currentPage + 1)}>{t("bases.record.next")}</Button>
      {onCreate && <Button type="button" className="ml-auto" onClick={onCreate}>{t("bases.toolbar.addRow")}</Button>}
    </div>
  </DialogContent></Dialog>;
}
