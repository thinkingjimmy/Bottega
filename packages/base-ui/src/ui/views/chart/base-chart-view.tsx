/**
 * [INPUT]: Depends on projected Base rows/columns, the canonical BaseCellContext, ChartItem limits, dnd-kit, ResizeObserver, packing, ChartCard, the toolbar container-width classes and the shared baseEntityId generator
 * [OUTPUT]: Provides BaseChartView with context-aware cards, 4/2-column packing, add/drag/resize/reset actions, and bounded dashboard states
 * [POS]: Shared Base presentation in ui/views/chart.
 */

import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "../../platform/i18n";
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
import { cn } from "@ai-chat/ui/lib/utils";
import { toolbarIconOnlyNarrowClass, toolbarLabelClass } from "../../chrome/base-toolbar-overflow";
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
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  chartGridColumns,
  chartGridResizeUnit,
  packCharts,
} from "../../../charts/chart-pack";
import type { ChartOp } from "../../../charts/chart-ops";

import { baseEntityId } from "../../base-workbench-support";
import type { ChartComponent } from "../../../charts/render/chart-viewport";
import { ChartCard } from "./chart-card";

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
              aria-label={`${t("bases.chart.add")} · ${t("bases.chart.count", { count, limit: CHART_ITEM_LIMIT })}`}
              className={cn("h-7 text-xs", toolbarIconOnlyNarrowClass)}
              disabled={busy || count >= CHART_ITEM_LIMIT}
              onClick={onAdd}
              size="sm"
              type="button"
              variant="default"
            >
              <PlusIcon />
              <span className={toolbarLabelClass}>{t("bases.chart.add")}</span>
              <InfoIcon aria-hidden="true" className={cn("size-3.5 opacity-70", toolbarLabelClass)} />
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
  // Columns follow the measured grid width; until the first measurement `compact` is the only hint.
  const [gridWidth, setGridWidth] = useState(0);
  const columnsCount = gridWidth ? chartGridColumns(gridWidth) : compact ? 2 : 4;
  const resizeUnit = useMemo(
    () => chartGridResizeUnit(gridWidth || 720, columnsCount),
    [columnsCount, gridWidth]
  );
  useEffect(() => {
    const grid = gridRef.current;
    if (!grid || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (!width || !Number.isFinite(width)) return;
      setGridWidth((current) => (current === width ? current : width));
    });
    observer.observe(grid);
    return () => observer.disconnect();
  }, []);

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


            reorder(activeId, overId);
            setActiveId("");
            setOverId("");
          }}

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
                  <div className="h-32 w-[min(18rem,calc(100vw-2rem))] rounded-xl border bg-card/95 p-3 shadow-xl">
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
