/**
 * [INPUT]: Depends on projected Base rows/columns, the canonical BaseCellContext, ChartItem limits, dnd-kit, ResizeObserver, packing, ChartCard, and the shared baseEntityId generator
 * [OUTPUT]: Provides BaseChartView with context-aware cards, 4/2-column packing, add/drag/resize/reset actions, and bounded dashboard states
 * [POS]: The Base Chart dashboard host; it owns layout interactions while ChartCard/model own canonical value projection
 */

import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { createPortal } from "react-dom";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { InfoIcon, PlusIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@ai-chat/ui/components/ui/tooltip";
import {
  CHART_ITEM_LIMIT,
  type BaseCellContext,
  type BaseColumn,
  type BaseRow,
  type ChartItem,
} from "../../../../../shared/bases-ipc";
import {
  chartGridResizeUnit,
  packCharts,
} from "@/lib/charts/chart-pack";
import type { ChartOp } from "@/lib/charts/chart-ops";
/* id 生成与 workbench 共用一份：这条 import 与 support 的 guessChartItem
   互为环，但两端都只在调用期取用，模块求值期互不依赖。 */
import { baseEntityId } from "../../base-workbench-support";
import type { ChartComponent } from "@/components/charts/chart-viewport";
import { ChartCard } from "./chart-card";

// ── 工具栏主按钮：chart 视图下取代 Add row；计数经 info icon hover 呈现，
//    禁用态用 span 包裹保住 hover（disabled button 吞指针事件）──
export function AddChartButton({
  busy,
  count,
  onAdd,
}: {
  busy: boolean;
  count: number;
  onAdd(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex">
            <Button
              className="h-7 text-xs"
              disabled={busy || count >= CHART_ITEM_LIMIT}
              onClick={onAdd}
              size="sm"
              type="button"
              variant="default"
            >
              <PlusIcon />
              {t("bases.chart.add")}
              <InfoIcon aria-hidden="true" className="size-3.5 opacity-70" />
            </Button>
          </span>
        </TooltipTrigger>
        <TooltipContent>
          {t("bases.chart.count", { count, limit: CHART_ITEM_LIMIT })}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export function guessChartItem(columns: readonly BaseColumn[]): ChartItem {
  const dimension =
    columns.find((column) => column.type === "date") ??
    columns.find((column) => column.type === "select") ??
    columns.find((column) => column.type === "text");
  const value = columns.find((column) => column.type === "number");
  return {
    id: baseEntityId("chart"),
    chartType: "bar",
    dimensionColumnId: dimension?.id,
    valueColumnIds: value ? [value.id] : undefined,
    aggregation: "sum",
    colSpan: 2,
    rowSpan: 1,
  };
}

export function BaseChartView({
  busy,
  columns,
  context,
  charts,
  rows,
  compact,
  viewFilterScrubbed,
  onOp,
  ChartComponent,
}: {
  busy: boolean;
  columns: BaseColumn[];
  context: BaseCellContext;
  charts: ChartItem[];
  rows: BaseRow[];
  compact: boolean;
  viewFilterScrubbed?: true;
  onOp?(op: ChartOp): void;
  ChartComponent?: ChartComponent;
}) {
  const { t } = useAppTranslation();
  const editable = Boolean(onOp);
  const [preview, setPreview] = useState<ChartItem | null>(null);
  const [activeId, setActiveId] = useState("");
  const [overId, setOverId] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const gridRef = useRef<HTMLDivElement>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragPreview = useMemo(() => {
    if (!activeId || !overId || activeId === overId) return charts;
    const next = [...charts];
    const from = next.findIndex((item) => item.id === activeId);
    const to = next.findIndex((item) => item.id === overId);
    if (from < 0 || to < 0) return charts;
    next.splice(to, 0, next.splice(from, 1)[0]!);
    return next;
  }, [activeId, charts, overId]);
  const displayed = preview
    ? dragPreview.map((item) => (item.id === preview.id ? preview : item))
    : dragPreview;
  const columnsCount = compact ? 2 : 4;
  const [resizeUnit, setResizeUnit] = useState(() =>
    chartGridResizeUnit(720, columnsCount)
  );
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;
    // ── RO observe 时立即回调一次，contentRect 是宽度的唯一口径（不含 padding）──
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width || !Number.isFinite(width)) return;
      const next = chartGridResizeUnit(width, columnsCount);
      setResizeUnit((current) =>
        current.column === next.column && current.row === next.row
          ? current
          : next
      );
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, [columnsCount]);
  /* ── 预览序只喂 packer，DOM 序永远是持久序 ──────────────────────────
   * 位置本来就不由 DOM 序表达——它写在 gridArea 里。若让拖拽预览连渲染顺序
   * 一起改，React 会按 key 把整棵卡片子树 insertBefore 搬一遍，而每搬一次，
   * 卡里那块 ECharts canvas 就要重挂一次合成层：眼睛把「换位置」读成「图表在闪」。
   * 故 packer 收预览序算坐标，渲染只认 charts 序，按 id 取槽位。搬动就此消失。
   * ────────────────────────────────────────────────────────────────── */
  const slots = useMemo(
    () =>
      new Map(
        packCharts(displayed, columnsCount).map((slot) => [slot.id, slot])
      ),
    [columnsCount, displayed]
  );
  const byId = new Map(displayed.map((item) => [item.id, item]));
  const reorder = (active: string, over: string) => {
    if (!onOp) return;
    const ids = charts.map((item) => item.id);
    const from = ids.indexOf(active);
    const to = ids.indexOf(over);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]!);
    onOp({ type: "reorder", orderedIds: ids });
    setAnnouncement(t("bases.chart.moved", { position: to + 1 }));
  };
  const move = (id: string, direction: -1 | 1) => {
    if (!onOp) return;
    const index = charts.findIndex((item) => item.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= charts.length) return;
    const ids = charts.map((item) => item.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    onOp({ type: "reorder", orderedIds: ids });
    setAnnouncement(t("bases.chart.moved", { position: target + 1 }));
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {viewFilterScrubbed && (
        <div className="border-b border-amber-300 bg-amber-50 px-3 py-2 text-amber-800 text-xs dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          {t("bases.chart.filterScrubbedView")}
        </div>
      )}
      {!charts.length ? (
        <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
          <div>
            <p className="font-medium text-sm">{t("bases.chart.emptyTitle")}</p>
            <p className="mt-1 text-muted-foreground text-xs">
              {t("bases.chart.emptyHint")}
            </p>
            {onOp && (
              <Button
                className="mt-4"
                disabled={busy}
                onClick={() => onOp({ type: "append", item: guessChartItem(columns) })}
                size="sm"
                type="button"
              >
                <PlusIcon /> {t("bases.chart.add")}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <DndContext
          onDragCancel={() => {
            setActiveId("");
            setOverId("");
          }}
          onDragEnd={() => {
            // 认预览里那个目标，不认松手瞬间的 event.over：眼睛看了一路的
            // 排布才是承诺，松在缝里不该把它作废
            reorder(activeId, overId);
            setActiveId("");
            setOverId("");
          }}
          /* over 落空只当「目标没变」——卡与卡之间有 12px 缝，画布下方还有
             大片空地，指针每次路过 event.over 都是 null。照单全收清成 ""，
             整块 dashboard 就在「预览序」与「原序」之间反复重排，那正是
             拖动时看见的闪。最后一个有效目标一直留到松手。 */
          onDragOver={(event) => {
            if (event.over) setOverId(String(event.over.id));
          }}
          onDragStart={(event) => {
            const id = String(event.active.id);
            setActiveId(id);
            setOverId(id);
          }}
          sensors={sensors}
        >
          {/* scrollbar-gutter:stable —— 沟槽先占住，别等滚动条来抢。
              自绘滚动条占 8px 宽，「拇指显隐不回流」说的只是拇指；重排改了
              总行数、内容越过阈值时，滚动条本身是从无到有，8px 当场从内容
              宽里扣走：所有 1fr 轨道一起变窄，所有 ECharts 一起 resize 重绘。
              更坏的是它还闭环——这次真实尺寸变化会唤醒 dnd-kit 的 droppable
              ResizeObserver 重测 rect，碰撞结果翻转，于是再重排一次。
              恒定的 8px 没人看得见，来回的 8px 就是那阵闪。 */}
          <SlimScroller
            className="grid min-h-0 flex-1 auto-rows-[180px] gap-3 overflow-auto p-3 [scrollbar-gutter:stable]"
            ref={gridRef}
            style={{ gridTemplateColumns: `repeat(${columnsCount}, minmax(0, 1fr))` }}
          >
            {charts.map((chart, index) => {
              const item = byId.get(chart.id)!;
              return (
                <DraggableChart
                  disabled={!editable}
                  key={chart.id}
                  slot={slots.get(chart.id)!}
                  item={item}
                >
                  {(dragHandleProps) => (
                    <ChartCard
                      ChartComponent={ChartComponent}
                      busy={busy}
                      canMoveDown={index < charts.length - 1}
                      canMoveUp={index > 0}
                      columns={columns}
                      context={context}
                      dragHandleProps={editable ? dragHandleProps : undefined}
                      item={item}
                      maxColSpan={columnsCount}
                      onMove={editable ? (direction) => move(item.id, direction) : undefined}
                      onOp={onOp}
                      onResizePreview={setPreview}
                      resizeUnit={resizeUnit}
                      rows={rows}
                    />
                  )}
                </DraggableChart>
              );
            })}
          </SlimScroller>
          {typeof document !== "undefined" &&
            createPortal(
              <DragOverlay dropAnimation={null}>
                {activeId ? (
                  <div className="h-32 w-72 rounded-xl border bg-card/95 p-3 shadow-xl">
                    {byId.get(activeId)?.name ?? t("bases.chart.unnamed")}
                  </div>
                ) : null}
              </DragOverlay>,
              document.body
            )}
        </DndContext>
      )}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}

function DraggableChart({
  item,
  slot,
  children,
  disabled = false,
}: {
  item: ChartItem;
  slot: ReturnType<typeof packCharts>[number];
  disabled?: boolean;
  children(
    props: React.HTMLAttributes<HTMLButtonElement>
  ): React.ReactNode;
}) {
  const draggable = useDraggable({ id: item.id, disabled });
  const droppable = useDroppable({ id: item.id, disabled });
  const { setNodeRef: setDraggableNode } = draggable;
  const { setNodeRef: setDroppableNode } = droppable;
  /* 合并 ref 必须是稳定引用：内联箭头每次渲染都是新函数，React 会先用 null
     卸一遍再挂回去。拖拽期间每次 over 变化都要渲染，dnd-kit 于是每次
     unobserve/observe 一遍 droppable——而 observe 后的首帧回调是被吞掉的，
     紧随其后的那次真实尺寸变化也一并丢了，rect 就此过期。 */
  const setNodeRef = useCallback(
    (node: HTMLDivElement | null) => {
      setDroppableNode(node);
      setDraggableNode(node);
    },
    [setDraggableNode, setDroppableNode]
  );
  return (
    <div
      ref={setNodeRef}
      className={droppable.isOver ? "ring-2 ring-primary/40" : undefined}
      style={{
        gridArea: `${slot.row + 1} / ${slot.col + 1} / span ${slot.rowSpan} / span ${slot.colSpan}`,
        opacity: draggable.isDragging ? 0.3 : 1,
      }}
    >
      {children({
        ...draggable.listeners,
        ...draggable.attributes,
      })}
    </div>
  );
}
