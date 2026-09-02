/**
 * [INPUT]: Depends on projected Base rows/columns, a canonical BaseCellContext, ChartItem/model, viewport/editor, resize snapping, and dashboard actions
 * [OUTPUT]: Provides ChartCard with localized model states, context-aware payload projection, accessible controls, and pointer resize intent
 * [POS]: Per-card translation/render/gesture boundary; chart-model remains pure and persistence remains an id-scoped ChartOp
 */

import {
  useMemo,
  useRef,
  useState,
  type HTMLAttributes,
  type PointerEvent,
} from "react";
import { GripVerticalIcon, Trash2Icon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import type {
  BaseCellContext,
  BaseColumn,
  BaseRow,
  ChartItem,
} from "../../../../../shared/bases-ipc";
import {
  buildChartPayload,
  type ChartModelMessage,
  type ChartModelMessageCode,
} from "@/lib/charts/chart-model";
import { snapSpan } from "@/lib/charts/chart-pack";
import type { ChartOp } from "@/lib/charts/chart-ops";
import {
  ChartViewport,
  type ChartComponent,
} from "@/components/charts/chart-viewport";
import { viewConfigHitAreaClass } from "../view-config-bar";
import { ChartEditor, chartTypeLabelKey } from "./chart-editor";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function ChartCard({
  item,
  rows,
  columns,
  context,
  busy,
  canMoveUp,
  canMoveDown,
  dragHandleProps,
  onOp,
  onMove,
  onResizePreview,
  resizeUnit,
  maxColSpan,
  ChartComponent,
}: {
  item: ChartItem;
  rows: BaseRow[];
  columns: BaseColumn[];
  context: BaseCellContext;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragHandleProps?: HTMLAttributes<HTMLButtonElement>;
  onOp?(op: ChartOp): void;
  onMove?(direction: -1 | 1): void;
  onResizePreview?(item: ChartItem | null): void;
  resizeUnit: { column: number; row: number };
  maxColSpan: 2 | 4;
  ChartComponent?: ChartComponent;
}) {
  const { t } = useAppTranslation();
  const editable = Boolean(onOp);
  const typeLabel = t(chartTypeLabelKey(item.chartType));
  const cardName = item.name ?? typeLabel;
  const result = useMemo(
    () => buildChartPayload(rows, columns, item, context),
    [columns, context, item, rows]
  );
  const gesture = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    colSpan: ChartItem["colSpan"];
    rowSpan: ChartItem["rowSpan"];
    nextColSpan: ChartItem["colSpan"];
    nextRowSpan: ChartItem["rowSpan"];
  } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const finishResize = (commit: boolean) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    onResizePreview?.(null);
    if (!commit || !onOp) return;
    onOp({
      type: "resize",
      id: item.id,
      colSpan: active.nextColSpan,
      rowSpan: active.nextRowSpan,
    });
    setAnnouncement(
      t("bases.chart.resized", {
        name: cardName,
        cols: active.nextColSpan,
        rows: active.nextRowSpan,
      })
    );
  };

  const moveResize = (event: PointerEvent<HTMLButtonElement>) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    active.nextColSpan = snapSpan(
      event.clientX - active.startX,
      resizeUnit.column,
      active.colSpan,
      maxColSpan
    ) as ChartItem["colSpan"];
    active.nextRowSpan = snapSpan(
      event.clientY - active.startY,
      resizeUnit.row,
      active.rowSpan,
      2
    ) as ChartItem["rowSpan"];
    onResizePreview?.({
      ...item,
      colSpan: active.nextColSpan,
      rowSpan: active.nextRowSpan,
    });
  };

  return (
    <article
      aria-label={t("bases.chart.cardAria", { name: cardName, type: typeLabel })}
      // 焦点环认 :focus-visible：鼠标点一下图表，focus 就留在卡片上，
      // focus-within 会让环从此常驻——它该说明「键盘落点在此」，而非「点过」
      //
      // 不投影：阴影说的是「我浮在画布之上」，可仪表盘的卡片是画布本身的格子，
      // 十二张卡一起投影，就是十二次没发生的悬浮。真正浮起来的只有拖拽替身
      // 与数据表浮层，抬升留给它们，静态卡片交给 border + bg-card。
      className="group/chart-card relative flex size-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30 focus-visible:ring-2 focus-visible:ring-ring/30"
      tabIndex={0}
    >
      {/* 40px 卡头 = 28px 控件 + 上下留白，与 ViewConfigBar 同一节拍；
          命中区的 44px 由 ::after 单撑，不靠把控件本身吹大 */}
      <header className="flex h-10 shrink-0 items-center gap-0.5 border-b px-1.5">
        {editable && (
          <button
            {...dragHandleProps}
            aria-label={t("bases.chart.drag", { name: cardName })}
            className={`flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground active:cursor-grabbing ${viewConfigHitAreaClass}`}
            disabled={busy}
            type="button"
          >
            <GripVerticalIcon className="size-3.5" />
          </button>
        )}
        <h3 className="min-w-0 flex-1 truncate font-medium text-sm">
          {cardName}
        </h3>
        {onOp && onMove && (
          <>
            <ChartEditor
              busy={busy}
              canMoveDown={canMoveDown}
              canMoveUp={canMoveUp}
              columns={columns}
              item={item}
              onMove={onMove}
              onOp={onOp}
            />
            <Button
              aria-label={t("bases.chart.delete")}
              className={viewConfigHitAreaClass}
              disabled={busy}
              onClick={() => onOp({ type: "remove", id: item.id })}
              size="icon"
              type="button"
              variant="ghost"
            >
              <Trash2Icon />
            </Button>
          </>
        )}
      </header>
      <div className="min-h-0 flex-1">
        {"incomplete" in result ? (
          <ChartState tone="warning" text={chartModelText(t, result.incomplete)} />
        ) : "error" in result ? (
          <ChartState tone="error" text={chartModelText(t, result.error)} />
        ) : "empty" in result ? (
          <ChartState tone="empty" text={chartModelText(t, result.empty)} />
        ) : (
          <ChartViewport
            ChartComponent={ChartComponent}
            accessibleColors={item.accessibleColors === true}
            className="h-full"
            cornerReserved
            payload={result}
          />
        )}
      </div>
      {/* 抓手仍占满 44px 命中区，但不再画那块不透明补丁——它压着
          「查看数据」抢指针，外角还被 rounded-xl 削掉一块。玻璃还给图表：
          内缩到圆角之内，只在悬停时露出两笔斜纹；粗指针没有 hover 可言，
          那里保持常显，键盘另有编辑器里的列宽/行高步进器。 */}
      {editable && <button
        aria-label={t("bases.chart.resize")}
        className="absolute right-0 bottom-0 z-10 grid size-11 touch-none cursor-nwse-resize place-items-end p-2.5 text-muted-foreground opacity-100 transition-opacity motion-reduce:transition-none hover:text-foreground [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/chart-card:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100"
        disabled={busy}
        onLostPointerCapture={() => finishResize(false)}
        onPointerCancel={() => finishResize(false)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          gesture.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            colSpan: item.colSpan,
            rowSpan: item.rowSpan,
            nextColSpan: item.colSpan,
            nextRowSpan: item.rowSpan,
          };
        }}
        onPointerMove={moveResize}
        onPointerUp={(event) => {
          finishResize(true);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        type="button"
      >
        <svg
          aria-hidden="true"
          className="size-3"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="1.5"
          viewBox="0 0 12 12"
        >
          <path d="M11 4 4 11M11 8.5 8.5 11" />
        </svg>
      </button>}
      <span aria-live="polite" className="sr-only">
        {announcement}
      </span>
    </article>
  );
}

const CHART_MODEL_KEYS = {
  filterScrubbed: "bases.chart.state.filterScrubbed",
  dimensionRequired: "bases.chart.state.dimensionRequired",
  valueRequired: "bases.chart.state.valueRequired",
  seriesRequired: "bases.chart.state.seriesRequired",
  pieSeriesUnsupported: "bases.chart.state.pieSeriesUnsupported",
  scatterRequirements: "bases.chart.state.scatterRequirements",
  heatmapRequirements: "bases.chart.state.heatmapRequirements",
  pieValueRequired: "bases.chart.state.pieValueRequired",
  singleValueForSeries: "bases.chart.state.singleValueForSeries",
  labelLimit: "bases.chart.state.labelLimit",
  seriesLimit: "bases.chart.state.seriesLimit",
  pointLimit: "bases.chart.state.pointLimit",
  empty: "bases.chart.state.empty",
  pieNegative: "bases.chart.state.pieNegative",
  invalidPayload: "bases.chart.state.invalidPayload",
} as const satisfies Record<ChartModelMessageCode, string>;

function chartModelText(
  t: ReturnType<typeof useAppTranslation>["t"],
  message: ChartModelMessage
) {
  return t(CHART_MODEL_KEYS[message.code], message.values ?? {});
}

function ChartState({
  text,
  tone,
}: {
  text: string;
  tone: "warning" | "error" | "empty";
}) {
  return (
    <div
      className={`grid size-full place-items-center p-5 text-center text-sm ${
        tone === "error"
          ? "text-destructive"
          : tone === "warning"
            ? "text-amber-700 dark:text-amber-300"
            : "text-muted-foreground"
      }`}
    >
      {text}
    </div>
  );
}
