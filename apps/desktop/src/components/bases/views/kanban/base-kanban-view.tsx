/**
 * [INPUT]: Depends on React, dnd-kit ((includes DragOverlay), react-virtual, lucide/Button/DropdownMenu and baseActionButtonClass/baseMenuItemHoverClass/InlineNameInput, shared groupBaseRows, kanban-fields Projection and color tables, kanban-card card face, state of BaseMutationOutcome Judgment type
 * [OUTPUT]: Provides BaseKanbanView: Set up select option by Group by group by group, select option by lane, drag LWW patch, drag cards by DragOverlay, top rendering, lane without a border, with "color points + count + the top of the landing card" left, color points are the color menu entry, headers are the name change, and the two are sent onUpdate Option, with select option itself changed, empty lane spaces are given to the landing area, each lane is separately windows and carries the mapped slot spaceWhen a select column is missing, Add select to the column
 * [POS]: The first is the basic basic data structure of the databaseThe classed input, field visibility input and persistence are in the toolbar/workbench, so this view consists only of configuration so it contains the whole column + `visibleColumnIds`The following table lists the selected groups in the full range, rather than the constricted columnsonPatch is missing, so it's only a read-only board (activation distance pushes infinitely, and the drag never starts)
 */

import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useVirtualizer } from "@tanstack/react-virtual";
import { CheckIcon, KanbanIcon, PlusIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@ai-chat/ui/components/ui/dropdown-menu";
import { cn } from "@ai-chat/ui/lib/utils";
import type {
  BaseCellContext,
  BaseColumn,
  BaseColumnType,
  BaseRow,
  BaseRowPatch,
  BaseSelectOption,
} from "../../../../../shared/bases-ipc";
import {
  createBaseCellContext,
  groupBaseRows,
} from "../../../../../shared/bases-ipc";
import {
  baseActionButtonClass,
  baseMenuItemHoverClass,
  InlineNameInput,
} from "../../chrome/base-toolbar";
import {
  KANBAN_CARD_CLASS,
  KanbanCard,
  KanbanCardBody,
  type KanbanAttachmentOwner,
} from "./kanban-card";
import {
  KANBAN_TONE_CHOICES,
  kanbanCardFace,
  kanbanFaceSpec,
  selectTone,
  type KanbanFaceSpec,
  type KanbanTone,
} from "./kanban-fields";

type Lane = ReturnType<typeof groupBaseRows>[number];

/** lane 宽度与卡片宽度同源：DragOverlay 副本必须与它离开的槽位等宽（lane 减去 px-0.5），否则放手前后会跳一次尺寸。 */
const LANE_WIDTH_CLASS = "w-72";
const CARD_WIDTH_CLASS = "w-[17.75rem]";

export function BaseKanbanView({
  columns,
  rows,
  groupByColumnId,
  visibleColumnIds,
  busy = false,
  chatId,
  incarnationId,
  onPatch,
  onAddColumn,
  onAddRow,
  onUpdateOption,
}: {
  /** 全量列：分组要在这里找 select，哪怕分组列本身被藏起来 */
  columns: BaseColumn[];
  rows: BaseRow[];
  groupByColumnId?: string;
  /** 卡面显哪些字段；缺省即全显 */
  visibleColumnIds?: string[];
  busy?: boolean;
  chatId?: string;
  incarnationId?: string;
  /** 缺席即只读：卡片不可拖动，lane 变更无从发生。intent 永不 reject */
  onPatch?(rowId: string, patch: BaseRowPatch): Promise<BaseMutationOutcome>;
  onAddColumn?(type: BaseColumnType): Promise<BaseMutationOutcome>;
  onAddRow?(values: BaseRow["values"]): Promise<BaseMutationOutcome>;
  /** lane 即 select option：改名与改色都是同一条 option 编辑 intent */
  onUpdateOption?(
    columnId: string,
    optionId: string,
    patch: Partial<Pick<BaseSelectOption, "label" | "color">>
  ): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const selectColumns = columns.filter((column) => column.type === "select");
  const group =
    selectColumns.find((column) => column.id === groupByColumnId) ??
    selectColumns[0];
  /* 只读时不换传感器数组（hook 不许条件调用），把激活距离推到无穷远：
     拖拽从「被禁止」变成「永远不会开始」。 */
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: onPatch ? 5 : Number.POSITIVE_INFINITY,
      },
    })
  );
  const [activeRowId, setActiveRowId] = useState("");
  const cellContext = useMemo(
    () => createBaseCellContext({ columns, rows }),
    [columns, rows]
  );
  if (!group) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <div className="flex flex-col items-center gap-3 text-center">
          <KanbanIcon className="size-8 text-muted-foreground/50" />
          <p className="text-muted-foreground text-sm">
            {t("bases.kanban.hint")}
          </p>
          {onAddColumn && (
            <Button
              className="cursor-pointer"
              disabled={busy}
              onClick={() => void onAddColumn("select")}
              size="sm"
              type="button"
              variant="outline"
            >
              <PlusIcon />
              {t("bases.kanban.addColumn")}
            </Button>
          )}
        </div>
      </div>
    );
  }
  const lanes = groupBaseRows(rows, group, columns);
  const laneIds = lanes.map((lane) => lane.id);
  // 卡片投影目录整块视图只算一次：标题/封面/芯片列的划分与具体行无关
  const spec = kanbanFaceSpec(columns, group.id, visibleColumnIds);
  const owner =
    chatId && incarnationId ? { chatId, incarnationId } : undefined;
  const activeRow = rows.find((row) => row.id === activeRowId);
  const dragStart = (event: DragStartEvent) =>
    setActiveRowId(String(event.active.id));
  const dragEnd = (event: DragEndEvent) => {
    setActiveRowId("");
    const rowId = String(event.active.id);
    const laneId = event.over ? String(event.over.id) : "";
    if (!laneIds.includes(laneId)) return;
    void onPatch?.(rowId, { [group.id]: laneId === "__none__" ? null : laneId });
  };

  return (
    <DndContext
      onDragCancel={() => setActiveRowId("")}
      onDragEnd={dragEnd}
      onDragStart={dragStart}
      sensors={sensors}
    >
      <SlimScroller className="flex min-h-0 flex-1 gap-5 overflow-x-auto px-4 py-3">
        {lanes.map((lane) => (
          <KanbanLane
            key={lane.id}
            busy={busy}
            cellContext={cellContext}
            lane={lane}
            onAddRow={
              onAddRow &&
              (() =>
                onAddRow(
                  lane.id === "__none__" ? {} : { [group.id]: lane.id }
                ))
            }
            /* Unassigned 背后没有 option，改名与改色都无处落笔——
               它不是一条被配置出来的 lane，而是「还没被配置」这件事本身 */
            onUpdate={
              onUpdateOption && lane.id !== "__none__"
                ? (patch) => onUpdateOption(group.id, lane.id, patch)
                : undefined
            }
            option={group.options?.find((option) => option.id === lane.id)}
            owner={owner}
            spec={spec}
            tone={selectTone(group, lane.id)}
          />
        ))}
      </SlimScroller>
      {/* 拖起的卡片 portal 到 body 顶层渲染：既不被 lane overflow 剪裁，
            也不受第三栏 aside transform 劫持 fixed 定位的 containing block。

            dropAnimation={null} 是必须的：dnd-kit 默认在放手时把 overlay 用 250ms
            动画移到「源卡片此刻所在处」，它假设放手瞬间排序已同步完成，那段位移
            读起来才是「落位」。我们的 lane 变更走异步 IPC + CAS，放手时源卡片还在
            原 lane，于是同一段动画变成「飞回起点」——语义正好反了，看着像拖拽被拒。
            实测 patch 往返仅约 31ms（≈2 帧），远短于那 250ms：让 overlay 即刻交棒
            给真实卡片，比用动画掩盖一次根本不存在的等待更诚实。 */}
      {createPortal(
        <DragOverlay dropAnimation={null}>
          {activeRow ? (
            <article
              className={`${KANBAN_CARD_CLASS} ${CARD_WIDTH_CLASS} cursor-grabbing shadow-md`}
            >
              <KanbanCardBody
                face={kanbanCardFace(activeRow, spec, cellContext)}
                owner={owner}
              />
            </article>
          ) : null}
        </DragOverlay>,
        document.body
      )}
    </DndContext>
  );
}

function KanbanLane({
  cellContext,
  lane,
  option,
  spec,
  tone,
  owner,
  busy,
  onAddRow,
  onUpdate,
}: {
  cellContext: BaseCellContext;
  lane: Lane;
  option?: BaseSelectOption;
  spec: KanbanFaceSpec;
  tone: KanbanTone;
  owner?: KanbanAttachmentOwner;
  busy: boolean;
  onAddRow?: () => Promise<BaseMutationOutcome>;
  onUpdate?(
    patch: Partial<Pick<BaseSelectOption, "label" | "color">>
  ): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: lane.id });
  // 有封面的板卡片高一截：估值只决定首帧滚动条长度，measureElement 落地后即被真值取代
  // eslint-disable-next-line react-hooks/incompatible-library -- 每条 lane 独立使用 TanStack 窗口化
  const virtualizer = useVirtualizer({
    count: lane.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => (spec.coverColumn ? 200 : 92),
    overscan: 5,
    initialRect: { width: 288, height: 480 },
  });
  /* lane 不是一只盒子：截图里的列没有边框也没有底色，卡片直接站在画布上。
   * 给 lane 画框等于「卡片套卡片」——两层圆角边框争同一件事的注意力，
   * 而列的边界本就由标题、留白与卡片的左对齐说清楚了。
   * 底色只在拖拽悬停时短暂出现：那一刻它要回答的是「这里收得下吗」，
   * 是一次性的反馈，不是常驻的结构。 */
  return (
    <section
      ref={setNodeRef}
      className={`flex ${LANE_WIDTH_CLASS} shrink-0 flex-col rounded-xl transition-colors ${isOver ? "bg-muted/60" : ""}`}
      data-lane-id={lane.id}
    >
      <header className="flex h-9 shrink-0 items-center gap-1.5 px-1.5 text-xs">
        <KanbanLaneDot
          busy={busy}
          color={option?.color}
          label={lane.label}
          onPick={onUpdate && ((color) => onUpdate({ color }))}
          tone={tone}
        />
        {/* 双击进入改名：lane 的名字就是 select option 的 label，改一次全库同步。
            单击留给别处（拖拽落位、菜单），双击才是「我要改这个词」的意思。 */}
        {renaming && onUpdate ? (
          <InlineNameInput
            ariaLabel={`Rename ${lane.label}`}
            autoFocus
            className="h-6 min-w-0 flex-1 px-1.5 text-xs"
            name={lane.label}
            onDone={() => setRenaming(false)}
            onRename={(label) => onUpdate({ label })}
          />
        ) : (
          <span
            className={cn(
              "min-w-0 flex-1 truncate font-medium",
              onUpdate && "cursor-text"
            )}
            onDoubleClick={onUpdate && (() => setRenaming(true))}
            title={
              onUpdate
                ? t("bases.kanban.renameHint", { lane: lane.label })
                : lane.label
            }
          >
            {lane.label}
          </span>
        )}
        <span className="shrink-0 tabular-nums text-muted-foreground">
          {lane.rows.length}
        </span>
        {onAddRow && (
          <button
            aria-label={t("bases.kanban.addCardTo", { lane: lane.label })}
            className={baseActionButtonClass}
            disabled={busy}
            onClick={() => void onAddRow()}
            title={t("bases.kanban.addCard")}
            type="button"
          >
            <PlusIcon className="size-3.5" />
          </button>
        )}
      </header>
      {/* 横向只留 2px：卡片阴影不被裁掉，卡片左缘仍与 lane 标题同轴 */}
      <SlimScroller
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-y-auto px-0.5 pb-1"
      >
        <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((item) => {
            const row = lane.rows[item.index]!;
            return (
              <KanbanCard
                key={row.id}
                cellContext={cellContext}
                index={item.index}
                measure={virtualizer.measureElement}
                owner={owner}
                row={row}
                spec={spec}
                top={item.start}
              />
            );
          })}
        </div>
        {/* 空 lane 不是「什么都没有」，而是一块明确的落位区：
            虚线框告诉拖拽者这里收得下，可点则让空板也能长出第一张卡。 */}
        {lane.rows.length === 0 && <KanbanLaneEmpty busy={busy} onAddRow={onAddRow} />}
      </SlimScroller>
    </section>
  );
}

/* ── lane 色点 ────────────────────────────────────────────────
 * 不可编辑时它只是一枚状态点；可编辑时它长出命中区与菜单，
 * 但视觉上仍是同一枚点——控件不该为了「看起来能点」而改变它表达的事实。
 *
 * 「Auto」不是第十种颜色，而是清空 color 这条路：清空后 lane 重新按 option
 * 序位取色，于是整块板回到那条有序光谱。少一个显式值，就少一处会过时的状态。
 * ────────────────────────────────────────────────────────── */
function KanbanLaneDot({
  tone,
  color,
  label,
  busy,
  onPick,
}: {
  tone: KanbanTone;
  color?: string;
  label: string;
  busy: boolean;
  onPick?(color: string | undefined): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const dot = <span className={`size-2 shrink-0 rounded-full ${tone.dot}`} />;
  if (!onPick) return dot;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label={t("bases.kanban.laneColorCurrent", { lane: label })}
          className="grid size-5 shrink-0 cursor-pointer place-items-center rounded transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          disabled={busy}
          title={t("bases.kanban.laneColor")}
          type="button"
        >
          {dot}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-36">
        <DropdownMenuLabel>{t("bases.kanban.laneColor")}</DropdownMenuLabel>
        <DropdownMenuItem
          className={baseMenuItemHoverClass}
          onSelect={() => void onPick(undefined)}
        >
          <CheckIcon className={cn("size-3.5", color && "opacity-0")} />
          {t("bases.kanban.auto")}
        </DropdownMenuItem>
        {KANBAN_TONE_CHOICES.map((choice) => (
          <DropdownMenuItem
            key={choice.color}
            className={baseMenuItemHoverClass}
            onSelect={() => void onPick(choice.color)}
          >
            <CheckIcon
              className={cn("size-3.5", choice.color !== color && "opacity-0")}
            />
            <span className={`size-2 rounded-full ${choice.tone.dot}`} />
            {t(`bases.kanban.color.${choice.color}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function KanbanLaneEmpty({
  busy,
  onAddRow,
}: {
  busy: boolean;
  onAddRow?: () => Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const className =
    "flex h-20 w-full items-center justify-center gap-1 rounded-lg border border-dashed text-[11px] text-muted-foreground";
  if (!onAddRow) return <div className={className}>{t("bases.kanban.dropHere")}</div>;
  return (
    <button
      className={`${className} cursor-pointer transition-colors hover:border-foreground/25 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50`}
      disabled={busy}
      onClick={() => void onAddRow()}
      type="button"
    >
      <PlusIcon aria-hidden className="size-3.5" />
      {t("bases.kanban.addCard")}
    </button>
  );
}
