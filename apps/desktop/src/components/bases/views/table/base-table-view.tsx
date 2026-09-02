/**
 * [INPUT]: Depends on projected rows/columns, the canonical BaseCellContext, full relation options, TanStack Table, virtualization, grouping, summaries, editors, InlineNameInput, and mutations
 * [OUTPUT]: Provides BaseTableView with canonical cell values, virtual rows, grouping/summaries, sorting/width/column controls, history, and optional edit actions
 * [POS]: The Base Table renderer; visible membership follows the named view while formula/relation evaluation follows the full snapshot context
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
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
} from "../../../../../shared/bases-ipc";
import {
  cellValue,
  groupBaseRows,
} from "../../../../../shared/bases-ipc";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { BaseCellEditor } from "../../editors/cells/base-cell-editor";
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

// 组头、数据行与组尾统计走同一窗口化通道：分组只改变 item 序列
type TableItem =
  | { kind: "group"; id: string; label: string; count: number }
  | { kind: "summary"; id: string; rows: readonly BaseRow[] }
  | { kind: "row"; row: Row<BaseRow> };

/* 数据列之前的两格：勾选与行动作。它们不是 Base 的列，故表头不排序、
   不改名、不 resize，统计行也只按同样的宽度留白——把它们的 id 收成一处，
   「谁是列、谁是控件」就只判断一次。 */
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
  /** 缺席即无行历史入口：读历史与写行是两根独立的轴，只读面同样看得见变更 */
  ownerKey?: string;
  /* mutation 回调全部可选：缺席即该 affordance 不渲染（read 面一个不传）。
     intent 一律来自 workbench 的收口出口：判决即返回值，永不 reject。 */
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
}) {
  const { t } = useAppTranslation();
  const [selection, setSelection] = useState<RowSelectionState>({});
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renameColumnId, setRenameColumnId] = useState("");
  const [deleteColumnId, setDeleteColumnId] = useState("");
  /* 历史对话框只挂一份：每行各挂一个，窗口化滚动就会不断建/拆 Dialog，
     而同一时刻本来就只可能看一行的历史。 */
  const [historyRowId, setHistoryRowId] = useState("");
  const [draftWidths, setDraftWidths] = useState(columnWidths ?? {});
  const resizingColumnIdRef = useRef("");
  const summaryTrackRef = useRef<HTMLDivElement>(null);
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
      /* 勾选列只为「删行」服务：删不了行时它是一列纯装饰的复选框。 */
      ...(onDelete
        ? [
            columnHelper.display({
              id: "select",
              size: SELECT_COLUMN_WIDTH,
              header: ({ table }) => (
                <input
                  aria-label={t("bases.table.selectAll")}
                  checked={table.getIsAllRowsSelected()}
                  onChange={table.getToggleAllRowsSelectedHandler()}
                  type="checkbox"
                />
              ),
              cell: ({ row }) => (
                <input
                  aria-label={t("bases.table.selectRow", { id: row.original.id })}
                  checked={row.getIsSelected()}
                  onChange={row.getToggleSelectedHandler()}
                  type="checkbox"
                />
              ),
            }),
          ]
        : []),
      /* 行历史此前只有 List 视图的 ⋯ 菜单一个入口——同一条记录在表格里
         就查不到自己被谁改过。入口跟着行走，而不是跟着某一种视图走。 */
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
          cell: ({ row }) => (
            <BaseCellEditor
              attachmentOwner={
                chatId && incarnationId ? { chatId, incarnationId } : undefined
              }
              column={column}
              disabled={busy || !onPatch}
              relationContext={context}
              relationOptions={relationOptions}
              storedValue={row.original.values[column.id]}
              surface="cell"
              value={cellValue(row.original, column, context)}
              onCommit={(value) =>
                onPatch?.(row.original.id, { [column.id]: value })
              }
            />
          ),
        })
      ),
    ],
    /* `t` 必须在列里：勾选列的两条 aria-label 是在这只 memo 里闭包住 t 的，
       漏掉它，切语言后整张表的列定义仍拿着上一门语言——文案不会更新，且只有
       读屏用户撞得见。代价是零：react-i18next 的 t 由 useSyncExternalStore
       快照缓存，普通重渲染同一身份，只有真的换语言才换——那正是该重建的一刻。 */
    [busy, chatId, columnHelper, columns, context, incarnationId, onDelete, onPatch, ownerKey, relationOptions, resolvedWidths, t]
  );
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Table 是本视图的显式状态引擎
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
  const deleteColumn = columns.find((column) => column.id === deleteColumnId);
  const width = table.getTotalSize();
  const leadingWidths = [
    ...(onDelete ? [SELECT_COLUMN_WIDTH] : []),
    ...(ownerKey ? [ROW_ACTIONS_COLUMN_WIDTH] : []),
  ];

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
            className="h-7 cursor-pointer text-xs"
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
        className="min-h-0 flex-1 overflow-auto"
        data-testid="base-table-viewport"
        onScroll={(event) => {
          if (summaryTrackRef.current) {
            summaryTrackRef.current.style.transform = `translateX(-${event.currentTarget.scrollLeft}px)`;
          }
        }}
      >
        <div
          className="sticky top-0 z-10 flex h-9 border-b bg-muted/80"
          style={{ minWidth: width }}
        >
          {table.getHeaderGroups()[0]?.headers.map((header) => {
            const direction = sorts.find(
              (sort) => sort.columnId === header.id
            )?.direction;
            if (DISPLAY_COLUMN_IDS.has(header.id)) {
              return (
                <div
                  key={header.id}
                  className="flex shrink-0 items-center justify-center border-r px-0 font-medium text-xs"
                  style={{ width: header.getSize() }}
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
            const sourceColumn = columns.find(
              (column) => column.id === header.id
            );
            const persistedWidth =
              columnWidths?.[header.id] ??
              (sourceColumn ? defaultColumnWidth(sourceColumn) : 170);
            return (
              <div
                key={header.id}
                className="group/column-header relative flex shrink-0 border-r font-medium text-xs"
                data-column-header={header.id}
                style={{ width: header.getSize() }}
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
                        className="pointer-events-none mr-1 flex shrink-0 items-center opacity-0 transition-opacity group-hover/column-header:pointer-events-auto group-hover/column-header:opacity-100 group-has-[:focus-visible]/column-header:pointer-events-auto group-has-[:focus-visible]/column-header:opacity-100"
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
                      // 失败回滚拖痕：宽度真相在持久层，本地 draft 不该冒充成功
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
          className="relative"
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
                  <span className="font-medium text-xs">{item.label}</span>
                  <span className="text-muted-foreground text-xs">
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
                className="absolute left-0 flex border-b bg-background hover:bg-muted/25"
                data-index={virtualRow.index}
                data-row-id={row.id}
                ref={virtualizer.measureElement}
                style={{
                  minWidth: width,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
              >
                {row.getVisibleCells().map((cell) => (
                  <div
                    key={cell.id}
                    className={
                      DISPLAY_COLUMN_IDS.has(cell.column.id)
                        ? "flex min-h-9 shrink-0 items-center justify-center border-r"
                        : "flex min-h-9 shrink-0 items-center border-r"
                    }
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </div>
                ))}
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
      </SlimScroller>
      <div
        className="shrink-0 overflow-hidden border-t bg-background"
        data-testid="base-table-summary"
      >
        <div
          ref={summaryTrackRef}
          className="flex h-9 will-change-transform"
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
            widths={resolvedWidths}
            leadingWidths={leadingWidths}
          />
          {onAddColumn && <div className="w-9 shrink-0" />}
        </div>
      </div>
      <ConfirmationDialog
        busy={busy}
        confirmLabel={t("bases.table.deleteRowsConfirm")}
        confirmTone="destructive"
        description={t("bases.table.deleteRowsDescription", {
          count: selectedIds.length,
        })}
        onConfirm={() =>
          void onDelete?.(selectedIds).then((error) => {
            // 失败留在原地：错因在顶部横幅，选择与弹窗都是重试的现场
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
            // 失败留在原地：错因在顶部横幅，弹窗关掉反而抹掉现场
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

export function nextBaseSorts(
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
