/**
 * [INPUT]: Depends on projected rows/columns, the canonical BaseCellContext, full relation options, TanStack Table, virtualization, grouping, summaries, editors, the read-only cell display, the shared coarse-pointer hook, InlineNameInput, and mutations
 * [OUTPUT]: Provides BaseTableView with stable draft-preserving editor identity, canonical values, virtual rows, summaries, scoped edit actions that stay reachable on touch, and tap-to-open cells on coarse pointers.
 * [POS]: Shared Base presentation in ui/views/table.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "../../platform/i18n";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Row,
  type RowSelectionState,
} from "@tanstack/react-table";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  HistoryIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import type {
  BaseAggregation,
  BaseAggregationSetting,
  BaseCellContext,
  BaseColumn,
  BaseColumnType,
  BaseRow,
  BaseRowPatch,
  BaseSort,
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  cellValue,
  groupBaseRows,
} from "@ai-chat/base-ui/model/bases-ipc";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { BaseCellEditor } from "../../editors/cells/base-cell-editor";
import { BaseCellDisplay } from "../../editors/cells/base-cell-display";
import { cn } from "@ai-chat/ui/lib/utils";
import { viewConfigHitAreaClass } from "../view-config-bar";
import { leadingStickyLefts, STICKY_CELL_CLASS, STICKY_HEADER_CELL_CLASS, stickyLefts } from "./table-sticky";
import { useCoarsePointer } from "@ai-chat/ui/hooks/use-mobile";
import { BaseRowHistoryDialog } from "../../editors/panels/base-row-history";
import {
  AddColumnMenu,
  baseActionButtonClass,
  baseDestructiveActionButtonClass,
  baseMenuItemHoverClass,
} from "../../chrome/base-toolbar";
import { InlineNameInput } from "../../chrome/inline-name-input";
import { BaseTableSummaryCells } from "./base-table-summary";
import { ColumnResizeHandle } from "./table-column-resize";

type TableItem =
  | { kind: "group"; id: string; label: string; count: number }
  | { kind: "summary"; id: string; rows: readonly BaseRow[] }
  | { kind: "row"; row: Row<BaseRow> };

const SELECT_COLUMN_WIDTH = 38;
const ROW_ACTIONS_COLUMN_WIDTH = 36;
const DISPLAY_COLUMN_IDS = new Set(["select", "actions"]);

export function BaseTableView({
  chatId,
  incarnationId,
  columns,
  context,
  rows,
  relationOptions,
  compact,
  busy,
  sorts,
  columnWidths,
  columnAggregations,
  groupByColumnId,
  ownerKey,
  onAddColumn,
  onDeleteColumn,
  onColumnWidthChange,
  onAggregationChange,
  onPatch,
  onRenameColumn,
  onDelete,
  onSortsChange,
  onOpenRecord,
}: {
  chatId?: string;
  incarnationId?: string;
  columns: BaseColumn[];
  context: BaseCellContext;
  rows: BaseRow[];
  relationOptions: BaseRow[];
  compact?: boolean;
  busy?: boolean;
  sorts: BaseSort[];
  columnWidths?: Record<string, number>;
  columnAggregations?: Record<string, BaseAggregationSetting>;
  groupByColumnId?: string;

  ownerKey?: string;

  onAddColumn?(
    type: BaseColumnType,
    formula?: NonNullable<BaseColumn["formula"]>
  ): Promise<BaseMutationOutcome>;
  onDeleteColumn?(columnId: string): Promise<BaseMutationOutcome>;
  onColumnWidthChange?(
    columnId: string,
    width: number
  ): Promise<BaseMutationOutcome>;
  onAggregationChange?(
    columnId: string,
    aggregation?: BaseAggregation
  ): Promise<BaseMutationOutcome>;
  onPatch?(rowId: string, patch: BaseRowPatch): Promise<BaseMutationOutcome>;
  onRenameColumn?(
    columnId: string,
    name: string
  ): Promise<BaseMutationOutcome>;
  onDelete?(rowIds: string[]): Promise<BaseMutationOutcome>;
  onSortsChange?(sorts: BaseSort[]): Promise<BaseMutationOutcome>;
  /** Coarse pointers open the record editor from a cell instead of editing inline; without it cells stay live. */
  onOpenRecord?(row: BaseRow): void;
}) {
  const { t } = useAppTranslation();
  const coarse = useCoarsePointer();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameColumnId, setRenameColumnId] = useState("");
  const [deleteColumnId, setDeleteColumnId] = useState("");

  const [historyRowId, setHistoryRowId] = useState("");
  const [draftWidths, setDraftWidths] = useState(columnWidths ?? {});
  const resizingColumnIdRef = useRef("");
  const columnHelper = useMemo(() => createColumnHelper<BaseRow>(), []);
  useEffect(() => {
    if (!resizingColumnIdRef.current) setDraftWidths(columnWidths ?? {});
  }, [columnWidths]);
  const resolvedWidths = useMemo(
    () =>
      Object.fromEntries(
        columns.map((column) => [
          column.id,
          draftWidths[column.id] ?? defaultColumnWidth(column),
        ])
      ),
    [columns, draftWidths]
  );
  const tableColumns = useMemo(
    () => [

      ...(onDelete
        ? [
            columnHelper.display({
              id: "select",
              size: SELECT_COLUMN_WIDTH,
              header: ({ table }) => (
                <input
                  aria-label={t("bases.table.selectAll")}
                  checked={table.getIsAllRowsSelected()}
                  className="pointer-coarse:size-5"
                  onChange={table.getToggleAllRowsSelectedHandler()}
                  type="checkbox"
                />
              ),
              cell: ({ row }) => (
                <input
                  aria-label={t("bases.table.selectRow", { id: row.original.id })}
                  checked={row.getIsSelected()}
                  className="pointer-coarse:size-5"
                  onChange={row.getToggleSelectedHandler()}
                  type="checkbox"
                />
              ),
            }),
          ]
        : []),

      ...(ownerKey
        ? [
            columnHelper.display({
              id: "actions",
              size: ROW_ACTIONS_COLUMN_WIDTH,
              header: () => null,
              cell: ({ row }) => (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      aria-label={t("bases.table.rowActions", {
                        id: row.original.id,
                      })}
                      className={baseActionButtonClass}
                      type="button"
                    >
                      <MoreHorizontalIcon className="size-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem
                      className={baseMenuItemHoverClass}
                      onSelect={() => setHistoryRowId(row.original.id)}
                    >
                      <HistoryIcon className="size-3.5" />
                      {t("bases.history.open")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ),
            }),
          ]
        : []),
      ...columns.map((column) =>
        columnHelper.accessor((row) => cellValue(row, column, context), {
          id: column.id,
          header: column.name,
          size: resolvedWidths[column.id],
        })
      ),
    ],

    [columnHelper, columns, context, onDelete, ownerKey, resolvedWidths, t]
  );

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (row) => row.id,
    enableRowSelection: Boolean(onDelete),
    onRowSelectionChange: setSelection,
    state: { rowSelection: selection },
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const visibleRows = table.getRowModel().rows;
  const selectColumns = useMemo(
    () => columns.filter((column) => column.type === "select"),
    [columns]
  );
  const groupColumn = selectColumns.find(
    (column) => column.id === groupByColumnId
  );
  const items: TableItem[] = useMemo(() => {
    if (!groupColumn) {
      return visibleRows.map((row) => ({ kind: "row", row }));
    }
    const rowById = new Map(visibleRows.map((row) => [row.original.id, row]));
    return groupBaseRows(rows, groupColumn, context).flatMap((lane) => [
      {
        kind: "group" as const,
        id: lane.id,
        label:
          lane.unassigned
            ? t("bases.group.unassigned")
            : lane.label,
        count: lane.rows.length,
      },
      ...lane.rows.flatMap((laneRow) => {
        const row = rowById.get(laneRow.id);
        return row ? [{ kind: "row" as const, row }] : [];
      }),
      {
        kind: "summary" as const,
        id: lane.id,
        rows: lane.rows,
      },
    ]);
  }, [context, groupColumn, rows, t, visibleRows]);
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      items[index]?.kind === "group"
        ? 32
        : items[index]?.kind === "summary"
          ? 36
          : compact
            ? 34
            : 38,
    overscan: 8,
    initialRect: { width: 900, height: 640 },
  });
  const selectedIds = table
    .getSelectedRowModel()
    .rows.map((row) => row.original.id);

  const columnById = useMemo(
    () => new Map(columns.map((column) => [column.id, column])),
    [columns]
  );
  const sortDirections = useMemo(
    () => new Map(sorts.map((sort) => [sort.columnId, sort.direction])),
    [sorts]
  );
  const deleteColumn = columnById.get(deleteColumnId);
  const width = table.getTotalSize();
  const leadingWidths = [
    ...(onDelete ? [SELECT_COLUMN_WIDTH] : []),
    ...(ownerKey ? [ROW_ACTIONS_COLUMN_WIDTH] : []),
  ];
  // Frozen columns: the leading select/actions cells always, the first data column while it stays narrow.
  const leadingLefts = leadingStickyLefts(leadingWidths);
  const frozen = stickyLefts(leadingWidths, columns[0]?.id, columns[0] ? resolvedWidths[columns[0].id] : undefined);
  const stickyLeft = (columnId: string, index: number) =>
    DISPLAY_COLUMN_IDS.has(columnId) ? leadingLefts[index] : frozen.get(columnId);

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      data-column-delete-pending={deleteColumnId || undefined}
    >
      {selectedIds.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b bg-muted/30 px-2">
          <span className="text-muted-foreground text-xs">
            {t("bases.table.selected", { count: selectedIds.length })}
          </span>
          <Button
            className={cn("h-7 cursor-pointer text-xs", viewConfigHitAreaClass)}
            disabled={busy}
            onClick={() => setDeleteOpen(true)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Trash2Icon />
            {t("bases.table.delete")}
          </Button>
        </div>
      )}
      <SlimScroller
        ref={scrollRef}
        className="flex min-h-0 flex-1 flex-col overflow-auto"
        data-testid="base-table-viewport"
      >
        <div
          className="sticky top-0 z-10 flex h-9 shrink-0 border-b bg-muted/80"
          style={{ minWidth: width }}
        >
          {table.getHeaderGroups()[0]?.headers.map((header, headerIndex) => {
            const direction = sortDirections.get(header.id);
            const left = stickyLeft(header.id, headerIndex);
            if (DISPLAY_COLUMN_IDS.has(header.id)) {
              return (
                <div
                  key={header.id}
                  className={cn("flex shrink-0 items-center justify-center border-r px-0 font-medium text-xs", left !== undefined && STICKY_HEADER_CELL_CLASS)}
                  style={{ width: header.getSize(), left }}
                >
                  <span className="truncate">
                    {flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )}
                  </span>
                </div>
              );
            }
            const sourceColumn = columnById.get(header.id);
            const persistedWidth =
              columnWidths?.[header.id] ??
              (sourceColumn ? defaultColumnWidth(sourceColumn) : 170);
            return (
              <div
                key={header.id}
                className={cn("group/column-header relative flex shrink-0 border-r font-medium text-xs", left !== undefined && STICKY_HEADER_CELL_CLASS)}
                data-column-header={header.id}
                style={{ width: header.getSize(), left }}
              >
                {renameColumnId === header.id && onRenameColumn ? (
                  <InlineNameInput
                    ariaLabel={t("bases.table.renameColumnAria", {
                      column:
                        sourceColumn?.name ?? t("bases.table.unnamedColumn"),
                    })}
                    autoFocus
                    className="h-full min-w-0 flex-1 rounded-none border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
                    name={sourceColumn?.name ?? ""}
                    onDone={() => setRenameColumnId("")}
                    onRename={(name) => onRenameColumn(header.id, name)}
                  />
                ) : (
                  <>
                    <button
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-1 px-2 text-left transition-colors enabled:hover:bg-muted disabled:cursor-default"
                      disabled={busy || !onSortsChange}
                      onClick={(event) => {
                        void onSortsChange?.(
                          nextBaseSorts(sorts, header.id, event.shiftKey)
                        );
                      }}
                      title={onSortsChange ? t("bases.table.sortHint") : undefined}
                      type="button"
                    >
                      <span
                        className="min-w-0 truncate"
                        data-column-label={header.id}
                      >
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                      </span>
                      {direction === "asc" ? (
                        <ArrowUpIcon className="size-3 shrink-0 text-muted-foreground" />
                      ) : direction === "desc" ? (
                        <ArrowDownIcon className="size-3 shrink-0 text-muted-foreground" />
                      ) : null}
                    </button>
                    {(onRenameColumn || onDeleteColumn) && (
                      <span
                        className="pointer-events-none mr-1 flex shrink-0 items-center opacity-0 transition-opacity group-hover/column-header:pointer-events-auto group-hover/column-header:opacity-100 group-has-[:focus-visible]/column-header:pointer-events-auto group-has-[:focus-visible]/column-header:opacity-100 no-hover:pointer-events-auto no-hover:opacity-100"
                        data-column-actions={header.id}
                      >
                        {onRenameColumn && (
                          <button
                            aria-label={t("bases.table.renameColumnAria", {
                              column: sourceColumn?.name ?? "",
                            })}
                            className={baseActionButtonClass}
                            disabled={busy}
                            onClick={() => setRenameColumnId(header.id)}
                            title={t("bases.table.renameColumn")}
                            type="button"
                          >
                            <PencilIcon className="size-3" />
                          </button>
                        )}
                        {onDeleteColumn && (
                          <button
                            aria-label={t("bases.table.deleteColumnAria", {
                              column: sourceColumn?.name ?? "",
                            })}
                            className={baseDestructiveActionButtonClass}
                            disabled={busy}
                            onClick={() => setDeleteColumnId(header.id)}
                            title={t("bases.table.deleteColumn")}
                            type="button"
                          >
                            <Trash2Icon className="size-3" />
                          </button>
                        )}
                      </span>
                    )}
                  </>
                )}
                {onColumnWidthChange && (
                  <ColumnResizeHandle
                    busy={busy}
                    columnId={header.id}
                    name={String(header.column.columnDef.header)}
                    onActiveChange={(active) => {
                      resizingColumnIdRef.current = active ? header.id : "";
                    }}
                    onChange={(nextWidth) =>
                      setDraftWidths((current) => ({
                        ...current,
                        [header.id]: nextWidth,
                      }))
                    }
                    onCancel={() =>
                      setDraftWidths((current) => ({
                        ...current,
                        [header.id]: persistedWidth,
                      }))
                    }
                    onCommit={async (nextWidth) => {
                      const error = await onColumnWidthChange(
                        header.id,
                        nextWidth
                      );

                      if (error) {
                        setDraftWidths((current) => ({
                          ...current,
                          [header.id]: persistedWidth,
                        }));
                      }
                      return error;
                    }}
                    width={header.getSize()}
                  />
                )}
              </div>
            );
          })}
          {onAddColumn && (
            <AddColumnMenu
              columns={columns}
              onAddColumn={onAddColumn}
              trigger={
                <button
                  aria-label={t("bases.table.addColumn")}
                  className="flex w-9 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  disabled={busy}
                  title={t("bases.table.addColumn")}
                  type="button"
                >
                  <PlusIcon className="size-3.5" />
                </button>
              }
            />
          )}
        </div>
        <div
          className="relative shrink-0"
          style={{
            height: virtualizer.getTotalSize(),
            minWidth: width,
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = items[virtualRow.index]!;
            if (item.kind === "group") {
              return (
                <div
                  key={`group-${item.id}`}
                  className="absolute left-0 flex h-8 items-center gap-2 border-b bg-muted/40 px-3"
                  data-group-header={item.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    minWidth: width,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <span className="sticky left-3 font-medium text-xs">{item.label}</span>
                  <span className="sticky left-3 text-muted-foreground text-xs">
                    {item.count}
                  </span>
                </div>
              );
            }
            if (item.kind === "summary") {
              return (
                <div
                  key={`summary-${item.id}`}
                  className="absolute left-0 flex h-9 border-b bg-muted/20"
                  data-group-summary={item.id}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    minWidth: width,
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  <BaseTableSummaryCells
                    aggregations={columnAggregations}
                    busy={busy}
                    columns={columns}
                    context={context}
                    onAggregationChange={onAggregationChange}
                    rows={item.rows}
                    scope={`group-${item.id}`}
                    stickyLefts={frozen}
                    widths={resolvedWidths}
                    leadingWidths={leadingWidths}
                  />
                </div>
              );
            }
            const row = item.row;
            return (
              <div
                key={row.id}
                className="group/row absolute left-0 flex border-b bg-background hover:bg-muted/25"
                data-index={virtualRow.index}
                data-row-id={row.id}
                ref={virtualizer.measureElement}
                style={{
                  minWidth: width,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.getVisibleCells().map((cell, cellIndex) => {
                  const column = columnById.get(cell.column.id);
                  const left = stickyLeft(cell.column.id, cellIndex);
                  // Checkbox and select stay inline on touch: one-tap status edits fit the cell; everything else opens the record.
                  const inline = !coarse || !onOpenRecord || column?.type === "checkbox" || column?.type === "select";
                  return (
                  <div
                    key={cell.id}
                    className={cn(
                      DISPLAY_COLUMN_IDS.has(cell.column.id)
                        ? "flex min-h-9 shrink-0 items-center justify-center border-r"
                        : "flex min-h-9 shrink-0 items-center border-r",
                      left !== undefined && STICKY_CELL_CLASS
                    )}
                    style={{ width: cell.column.getSize(), left }}
                  >
                    {column ? inline ? <BaseCellEditor column={column} disabled={busy || !onPatch} surface="cell"
                      attachmentOwner={chatId && incarnationId ? { chatId, incarnationId } : undefined}
                      relationContext={context} relationOptions={relationOptions} storedValue={row.original.values[column.id]}
                      value={cellValue(row.original, column, context)}
                      onCommit={value => onPatch?.(row.original.id, { [column.id]: value })} /> :
                      <BaseCellDisplay column={column} row={row.original} context={context} attachmentOwner={chatId && incarnationId ? { chatId, incarnationId } : undefined}
                        onOpen={() => onOpenRecord!(row.original)} /> : flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                  );
                })}
              </div>
            );
          })}
        </div>
        {!rows.length && (
          <div className="p-6 text-center text-muted-foreground text-sm">
            {t(
              !columns.length
                ? "bases.table.emptyNoColumns"
                : onPatch || onDelete
                  ? "bases.table.emptyEditable"
                  : "bases.table.emptyReadOnly"
            )}
          </div>
        )}
        {/* The total bar lives inside the scroller so its frozen cells share the same scrollport; sticky bottom keeps it visible. */}
        <div
          className="sticky bottom-0 z-10 mt-auto flex h-9 shrink-0 border-t bg-background"
          data-testid="base-table-summary"
          style={{ width: width + (onAddColumn ? 36 : 0) }}
        >
          <BaseTableSummaryCells
            aggregations={columnAggregations}
            busy={busy}
            columns={columns}
            context={context}
            onAggregationChange={onAggregationChange}
            rows={rows}
            scope="total"
            stickyLefts={frozen}
            widths={resolvedWidths}
            leadingWidths={leadingWidths}
          />
          {onAddColumn && <div className="w-9 shrink-0" />}
        </div>
      </SlimScroller>
      <ConfirmationDialog
        busy={busy}
        confirmLabel={t("bases.table.deleteRowsConfirm")}
        confirmTone="destructive"
        description={t("bases.table.deleteRowsDescription", {
          count: selectedIds.length,
        })}
        onConfirm={() =>
          void onDelete?.(selectedIds).then((error) => {

            if (error) return;
            setSelection({});
            setDeleteOpen(false);
          })
        }
        onOpenChange={setDeleteOpen}
        open={deleteOpen}
        title={t("bases.table.deleteRowsTitle")}
      />
      <ConfirmationDialog
        busy={busy}
        confirmLabel={t("bases.table.deleteColumnConfirm")}
        confirmTone="destructive"
        description={t("bases.table.deleteColumnDescription", {
          column: deleteColumn?.name ?? "",
        })}
        onConfirm={() =>
          void onDeleteColumn?.(deleteColumnId).then((error) => {

            if (!error) setDeleteColumnId("");
          })
        }
        onOpenChange={(open) => {
          if (!open) setDeleteColumnId("");
        }}
        open={Boolean(deleteColumn)}
        title={t("bases.table.deleteColumnTitle")}
      />
      {ownerKey && historyRowId ? (
        <BaseRowHistoryDialog
          columns={columns}
          onOpenChange={(open) => {
            if (!open) setHistoryRowId("");
          }}
          open
          ownerKey={ownerKey}
          rowId={historyRowId}
        />
      ) : null}
    </div>
  );
}

function defaultColumnWidth(column: BaseColumn) {
  if (column.type === "formula") return 190;
  return column.type === "location" ? 210 : 170;
}

function nextBaseSorts(
  current: BaseSort[],
  columnId: string,
  additive = false
) {
  const existing = current.find((sort) => sort.columnId === columnId);
  const next = existing
    ? existing.direction === "asc"
      ? { columnId, direction: "desc" as const }
      : null
    : { columnId, direction: "asc" as const };
  if (!additive) return next ? [next] : [];
  const rest = current.filter((sort) => sort.columnId !== columnId);
  return next ? [...rest, next] : rest;
}
