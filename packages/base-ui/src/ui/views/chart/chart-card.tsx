/**
 * [INPUT]: Depends on projected Base rows/columns, a canonical BaseCellContext, ChartItem/model, viewport/editor, resize snapping, and dashboard actions
 * [OUTPUT]: Provides ChartCard with localized model states, context-aware payload projection, accessible controls, pointer resize intent and the grid-derived column span limit passed to its editor
 * [POS]: Shared Base presentation in ui/views/chart.
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
} from "@ai-chat/base-ui/model/bases-ipc";
import {
  buildChartPayload,
  type ChartModelMessage,
  type ChartModelMessageCode,
} from "../../../charts/chart-model";
import { snapSpan, type ChartGridColumns } from "../../../charts/chart-pack";
import type { ChartOp } from "../../../charts/chart-ops";
import {
  ChartViewport,
  type ChartComponent,
} from "../../../charts/render/chart-viewport";
import { viewConfigHitAreaClass } from "../view-config-bar";
import { ChartEditor, chartTypeLabelKey } from "./chart-editor";
import { useAppTranslation } from "../../platform/i18n";

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
  maxColSpan: ChartGridColumns;
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


      //



      className="group/chart-card relative flex size-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring/30 focus-visible:ring-2 focus-visible:ring-ring/30"
      tabIndex={0}
    >

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
              maxColSpan={maxColSpan}
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
