/**
 * [INPUT]: Depends on projected rows/columns, the canonical BaseCellContext, full relation options, virtualization, grouping, mutation outcomes, and record editors
 * [OUTPUT]: Provides BaseListView with canonical cell rendering, grouped virtual rows, folding, create/edit/delete actions, and a read-only fallback
 * [POS]: The Base List renderer; workbench owns snapshot/context and this view owns list presentation without rebuilding lookup authority
 */

import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDownIcon, PlusIcon } from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Button } from "@ai-chat/ui/components/ui/button";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  BaseCellContext,
  BaseColumn,
  BaseRow,
  BaseRowPatch,
} from "../../../../../shared/bases-ipc";
import { groupBaseRows } from "../../../../../shared/bases-ipc";
import { BaseListRow } from "./list-row";
import {
  ListSelectDot,
  projectListColumns,
  selectOptionTone,
} from "./list-properties";

/* ── 单通道窗口化 ──────────────────────────────────────────────
 * 组头与记录行是同一条序列上的两种居民，与 table 同构：分组只改变 item 序列，
 * 不改变「谁来测量、谁来定位」。折叠因而退化为一次 items 重建，
 * 没有第二套滚动几何，也没有「折叠后要不要重算高度」这类问题。
 * ────────────────────────────────────────────────────────── */
type ListItem =
  | {
      kind: "group";
      id: string;
      label: string;
      count: number;
      tone?: string;
      collapsed: boolean;
    }
  | { kind: "row"; row: BaseRow };

/**
 * 测量缓存必须挂身份而不是下标。折叠一组会把后面的所有 item 往前搬，
 * 下标 3 昨天是一行、今天是一个组头——缓存若只认下标，新居民就穿着前任的
 * 身材出场：实测过 132px 的展开行一收起，它留下的高度会变成下一位的起点，
 * 于是组头与首行之间凭空裂开一道缝。key 一挂身份，这类问题整类消失。
 */
const itemKey = (entry: ListItem) =>
  entry.kind === "group" ? `group:${entry.id}` : `row:${entry.row.id}`;

const GROUP_HEIGHT = 32;
const ROW_HEIGHT = 40;

export function BaseListView({
  busy,
  chatId,
  columns,
  context,
  groupByColumnId,
  incarnationId,
  ownerKey,
  rows,
  relationOptions,
  onCreateRow,
  onDelete,
  onPatch,
}: {
  busy?: boolean;
  chatId?: string;
  columns: BaseColumn[];
  context: BaseCellContext;
  groupByColumnId?: string;
  incarnationId?: string;
  ownerKey?: string;
  rows: BaseRow[];
  relationOptions: BaseRow[];
  /* intent 一律来自 workbench 的收口出口：判决即返回值，永不 reject。 */
  onCreateRow?(values: BaseRow["values"]): Promise<BaseMutationOutcome>;
  onDelete?(rowIds: string[]): Promise<BaseMutationOutcome>;
  /** 缺席即只读：行内编辑入口不渲染 */
  onPatch?(rowId: string, patch: BaseRowPatch): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  // 同时只有一行处于编辑态：编辑是聚焦动作，单值即单一真相源，
  // 也让「退出」永远只有一种写法——置空。
  const [editingRowId, setEditingRowId] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, true>>({});
  const [deleteRowId, setDeleteRowId] = useState("");
  const groupColumn = columns.find(
    (column) => column.id === groupByColumnId && column.type === "select"
  );
  const projection = useMemo(
    () => projectListColumns(columns, groupColumn?.id),
    [columns, groupColumn?.id]
  );
  const items = useMemo<ListItem[]>(() => {
    if (!groupColumn) return rows.map((row) => ({ kind: "row", row }));
    return groupBaseRows(rows, groupColumn, context)
      // 空的 Unassigned 不是一个分组，只是「没人落在这儿」；
      // 真实 option 即使为空也留着，那枚 + 是它唯一的入口。
      .filter((lane) => lane.rows.length > 0 || lane.id !== "__none__")
      .flatMap((lane) => [
        {
          kind: "group" as const,
          id: lane.id,
          label: lane.label,
          count: lane.rows.length,
          tone: selectOptionTone(groupColumn, lane.id),
          collapsed: Boolean(collapsed[lane.id]),
        },
        ...(collapsed[lane.id]
          ? []
          : lane.rows.map((row) => ({ kind: "row" as const, row }))),
      ]);
  }, [collapsed, context, groupColumn, rows]);
  // 估值只决定首帧滚动条长度，measureElement 落地后即被真值取代；
  // 读态行恒为 ROW_HEIGHT，只有编辑态展开才需要重测。
  // eslint-disable-next-line react-hooks/incompatible-library -- 10k 行必须使用 TanStack 窗口化
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) =>
      items[index]?.kind === "group" ? GROUP_HEIGHT : ROW_HEIGHT,
    getItemKey: (index) => itemKey(items[index]!),
    overscan: 8,
    initialRect: { width: 800, height: 640 },
  });
  const attachmentOwner =
    chatId && incarnationId ? { chatId, incarnationId } : undefined;
  return (
    <SlimScroller
      ref={scrollRef}
      className="@container/base-list min-h-0 flex-1 overflow-auto"
      data-testid="base-list-viewport"
    >
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((item) => {
          const entry = items[item.index]!;
          // data-index 是测量协议的另一半：measureElement 靠它认出自己测的是谁，
          // 缺了就静默丢弃测量，所有行永远停在 estimateSize 上互相叠压。
          const geometry = {
            "data-index": item.index,
            ref: virtualizer.measureElement,
            style: { transform: `translateY(${item.start}px)` },
          };
          if (entry.kind === "group") {
            return (
              <div
                key={item.key}
                className="group/base-group absolute left-0 flex h-8 w-full items-center gap-1 border-b bg-muted/50 pr-2 pl-1"
                data-group-header={entry.id}
                {...geometry}
              >
                <button
                  aria-expanded={!entry.collapsed}
                  className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-sm px-1.5 py-1 text-left"
                  onClick={() =>
                    setCollapsed((current) => {
                      const next = { ...current };
                      if (next[entry.id]) delete next[entry.id];
                      else next[entry.id] = true;
                      return next;
                    })
                  }
                  type="button"
                >
                  <ChevronDownIcon
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                      entry.collapsed && "-rotate-90"
                    )}
                  />
                  <ListSelectDot label={entry.label} tone={entry.tone} />
                  <span className="truncate font-medium text-xs">
                    {entry.label}
                  </span>
                  <span className="shrink-0 text-muted-foreground text-xs tabular-nums">
                    {entry.count}
                  </span>
                </button>
                {onCreateRow && groupColumn && (
                  <Button
                    aria-label={`Add row to ${entry.label}`}
                    className="size-6 shrink-0 cursor-pointer text-muted-foreground"
                    disabled={busy}
                    onClick={() =>
                      void onCreateRow(
                        entry.id === "__none__" ? {} : { [groupColumn.id]: entry.id }
                      )
                    }
                    size="icon-sm"
                    title={t("bases.list.addRow")}
                    type="button"
                    variant="ghost"
                  >
                    <PlusIcon />
                  </Button>
                )}
              </div>
            );
          }
          const editing = editingRowId === entry.row.id;
          return (
            <article
              key={item.key}
              className="group/base-row absolute left-0 w-full border-b transition-colors hover:bg-muted/40 data-[row-editing]:bg-muted/25"
              data-row-editing={editing || undefined}
              data-row-id={entry.row.id}
              onKeyDown={(event) => {
                if (event.key === "Escape" && editing) setEditingRowId("");
              }}
              {...geometry}
            >
              <BaseListRow
                busy={busy}
                cellContext={context}
                columns={columns}
                editing={editing}
                onDelete={onDelete && setDeleteRowId}
                onEditingChange={(next) =>
                  setEditingRowId(next ? entry.row.id : "")
                }
                onPatch={onPatch}
                owner={attachmentOwner}
                ownerKey={ownerKey}
                projection={projection}
                relationOptions={relationOptions}
                row={entry.row}
              />
            </article>
          );
        })}
      </div>
      {!rows.length && (
        <p className="py-10 text-center text-muted-foreground text-sm">
          {t("bases.list.empty")}
        </p>
      )}
      <ConfirmationDialog
        busy={busy}
        confirmLabel={t("bases.list.deleteConfirm")}
        confirmTone="destructive"
        description={t("bases.list.deleteDescription")}
        onConfirm={() =>
          void onDelete?.([deleteRowId]).then((error) => {
            // 失败留在原地：错因由 workbench 顶部统一播报，弹窗关掉反而抹掉现场
            if (!error) setDeleteRowId("");
          })
        }
        onOpenChange={(open) => {
          if (!open) setDeleteRowId("");
        }}
        open={Boolean(deleteRowId)}
        title={t("bases.list.deleteTitle")}
      />
    </SlimScroller>
  );
}
