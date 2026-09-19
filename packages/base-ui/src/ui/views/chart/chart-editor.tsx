/**
 * [INPUT]: Depends on shared ChartItem/Base column/cluster, ChartOp, ChartGridColumns, BaseFilterEditor, viewConfigHitAreaClass and shadcn
 * [OUTPUT]: Provides ChartEditor (per-card type/aggregation/color/filter config form) with chartTypeLabelKey (type-id to catalog-key mapping, see bases.chart.type.*), a failure-recovery view, and keyboard move-up/move-down reordering intent; popover rows keep a 28px visual height inside a 44px hit target per design-system density, and the shell scrolls via SlimScroller only when the available height requires it
 * [POS]: Shared Base presentation in ui/views/chart.
 */

import type { ReactNode } from "react";
import { useAppTranslation } from "../../platform/i18n";
import {
  MinusIcon,
  MoveDownIcon,
  MoveUpIcon,
  PlusIcon,
  Settings2Icon,
} from "lucide-react";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { Button } from "@ai-chat/ui/components/ui/button";
import { Input } from "@ai-chat/ui/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@ai-chat/ui/components/ui/select";
import type {
  BaseAggregation,
  BaseColumn,
  BaseFilter,
  ChartItem,
} from "@ai-chat/base-ui/model/bases-ipc";
import { BASE_AGGREGATIONS } from "@ai-chat/base-ui/model/bases-ipc";
import {
  CHART_TYPES,
  type ChartType,
} from "@ai-chat/base-ui/model/chart-payload";
import type { ChartOp } from "../../../charts/chart-ops";
import type { ChartGridColumns } from "../../../charts/chart-pack";
import { BaseFilterEditor } from "../../chrome/base-filter-editor";
import { viewConfigHitAreaClass } from "../view-config-bar";

export const chartTypeLabelKey = (type: ChartType) => `bases.chart.type.${type}`;

export function ChartEditor({
  item,
  columns,
  busy,
  canMoveUp,
  canMoveDown,
  maxColSpan = 4,
  onMove,
  onOp,
}: {
  item: ChartItem;
  columns: BaseColumn[];
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  maxColSpan?: ChartGridColumns;
  onMove(direction: -1 | 1): void;
  onOp(op: ChartOp): void;
}) {
  const { t } = useAppTranslation();
  const patch = (value: Partial<ChartItem>) =>
    onOp({ type: "patch", id: item.id, patch: value });
  const dimensionColumns = columns.filter((column) =>
    ["text", "select", "date"].includes(column.type)
  );
  const valueColumns = columns.filter((column) => column.type === "number");
  const validValueIds = new Set(valueColumns.map((column) => column.id));
  const selectedValueIds = (item.valueColumnIds ?? []).filter((id) =>
    validValueIds.has(id)
  );

  const valueColumnCaps: Partial<Record<ChartType, number>> = {
    pie: 1,
    heatmap: 1,
    scatter: 2,
  };
  const maxValueColumns = valueColumnCaps[item.chartType] ?? 3;
  const seriesColumns = columns.filter((column) =>
    ["text", "select"].includes(column.type)
  );
  const dimension = columns.find(
    (column) => column.id === item.dimensionColumnId
  );
  const showSeries = item.chartType !== "scatter" && item.chartType !== "pie";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          aria-label={t("bases.chart.editor.open")}
          className={viewConfigHitAreaClass}
          disabled={busy}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Settings2Icon />
        </Button>
      </PopoverTrigger>


      <PopoverContent align="end" className="w-72 overflow-hidden p-0">

        <SlimScroller className="max-h-(--radix-popover-content-available-height) space-y-2.5 overflow-y-auto p-3">
          <Field label={t("bases.chart.editor.name")}>
            <Input
              aria-label={t("bases.chart.editor.name")}
              defaultValue={item.name ?? ""}
              maxLength={60}
              onBlur={(event) =>
                patch({ name: event.target.value.trim() || undefined })
              }
            />
          </Field>
          <Field label={t("bases.chart.editor.chartType")}>
            <ConfigSelect
              label={t("bases.chart.editor.chartType")}
              options={CHART_TYPES.map((type) => ({
                id: type,
                label: t(chartTypeLabelKey(type)),
              }))}
              value={item.chartType}
              onChange={(chartType) =>
                patch({ chartType: chartType as ChartType })
              }
            />
          </Field>
          <Field label={t("bases.chart.editor.dimension")}>
            <ColumnSelect
              columns={dimensionColumns}
              label={t("bases.chart.editor.dimension")}
              value={item.dimensionColumnId}
              onChange={(dimensionColumnId) => patch({ dimensionColumnId })}
            />
          </Field>
          {dimension?.type === "date" && (
            <Field label={t("bases.chart.editor.dateBucket")}>
              <ConfigSelect
                label={t("bases.chart.editor.dateBucket")}
                options={[
                  { id: "month", label: t("bases.chart.editor.bucketMonth") },
                  { id: "day", label: t("bases.chart.editor.bucketDay") },
                ]}
                value={item.dateBucket ?? "month"}
                onChange={(dateBucket) =>
                  patch({ dateBucket: dateBucket as "day" | "month" })
                }
              />
            </Field>
          )}
          <Field label={t("bases.chart.editor.valueColumns", { max: maxValueColumns })}>
            <div className="grid">
              {valueColumns.map((column) => {
                const checked =
                  item.valueColumnIds?.includes(column.id) ?? false;
                const capped =
                  !checked && selectedValueIds.length >= maxValueColumns;
                return (
                  <label
                    className={`flex h-7 cursor-pointer items-center gap-2 rounded-md px-1 text-xs transition-colors hover:bg-muted pointer-coarse:h-10 ${capped ? "cursor-not-allowed opacity-50" : ""}`}
                    key={column.id}
                  >
                    <input
                      checked={checked}
                      className="size-3.5 cursor-pointer accent-foreground"
                      disabled={capped}
                      onChange={(event) => {
                        patch({
                          valueColumnIds: event.target.checked
                            ? [...selectedValueIds, column.id]
                            : selectedValueIds.filter(
                                (id) => id !== column.id
                              ),
                        });
                      }}
                      type="checkbox"
                    />
                    {column.name}
                  </label>
                );
              })}
            </div>
          </Field>
          {showSeries && (
            <Field label={t("bases.chart.editor.series")}>
              <ColumnSelect
                allowNone
                columns={seriesColumns}
                label={t("bases.chart.editor.series")}
                value={item.seriesColumnId}
                onChange={(seriesColumnId) => patch({ seriesColumnId })}
              />
            </Field>
          )}
          <Field label={t("bases.chart.editor.aggregation")}>
            <ConfigSelect
              label={t("bases.chart.editor.aggregation")}
              options={BASE_AGGREGATIONS.map((aggregation) => ({
                id: aggregation,
                label: aggregation,
              }))}
              value={item.aggregation ?? "sum"}
              onChange={(aggregation) =>
                patch({ aggregation: aggregation as BaseAggregation })
              }
            />
          </Field>

          <label
            className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-md px-1 transition-colors hover:bg-muted ${busy ? "cursor-not-allowed opacity-50" : ""}`}
          >
            <input
              checked={item.accessibleColors === true}
              className="size-3.5 shrink-0 cursor-pointer accent-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed"
              disabled={busy}
              onChange={(event) =>
                patch({ accessibleColors: event.target.checked })
              }
              type="checkbox"
            />
            <span className="grid gap-0.5">
              <span className="text-xs">
                {t("bases.chart.editor.accessibleColors")}
              </span>
              <span className="text-muted-foreground text-[11px] leading-tight">
                {t("bases.chart.editor.accessibleColorsHint")}
              </span>
            </span>
          </label>
          <Field label={t("bases.chart.editor.cardFilter")}>
            {item.filterScrubbed && (
              <div className="mb-2 flex items-center gap-2">
                <p className="flex-1 text-amber-700 text-xs dark:text-amber-300">
                  {t("bases.chart.editor.filterScrubbed")}
                </p>
                <Button
                  disabled={busy}
                  onClick={() =>
                    patch({ filter: undefined, filterScrubbed: undefined })
                  }
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  {t("bases.chart.editor.clearFilter")}
                </Button>
              </div>
            )}
            <BaseFilterEditor
              busy={busy}
              columns={columns}
              filter={item.filter}
              onFilter={async (filter: BaseFilter | undefined) => {

                patch({ filter, filterScrubbed: undefined });
                return null;
              }}
            />
          </Field>

          <div className="grid grid-cols-2 gap-2 border-t pt-2.5">
            <Button
              disabled={!canMoveUp}
              onClick={() => onMove(-1)}
              size="sm"
              type="button"
              variant="outline"
            >
              <MoveUpIcon /> {t("bases.chart.editor.moveUp")}
            </Button>
            <Button
              disabled={!canMoveDown}
              onClick={() => onMove(1)}
              size="sm"
              type="button"
              variant="outline"
            >
              <MoveDownIcon /> {t("bases.chart.editor.moveDown")}
            </Button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <SpanStepper
              busy={busy}
              label={t("bases.chart.editor.colSpan")}
              max={maxColSpan}
              value={item.colSpan}
              onChange={(colSpan) =>
                onOp({
                  type: "resize",
                  id: item.id,
                  colSpan: colSpan as ChartItem["colSpan"],
                  rowSpan: item.rowSpan,
                })
              }
            />
            <SpanStepper
              busy={busy}
              label={t("bases.chart.editor.rowSpan")}
              max={2}
              value={item.rowSpan}
              onChange={(rowSpan) =>
                onOp({
                  type: "resize",
                  id: item.id,
                  colSpan: item.colSpan,
                  rowSpan: rowSpan as ChartItem["rowSpan"],
                })
              }
            />
          </div>
        </SlimScroller>
      </PopoverContent>
    </Popover>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 text-muted-foreground text-xs">
      <span>{label}</span>
      <div className="text-foreground">{children}</div>
    </div>
  );
}

function ColumnSelect({
  columns,
  value,
  label,
  allowNone,
  onChange,
}: {
  columns: BaseColumn[];
  value?: string;
  label: string;
  allowNone?: boolean;
  onChange(value?: string): void;
}) {
  const { t } = useAppTranslation();
  return (
    <ConfigSelect
      label={label}
      options={[
        ...(allowNone ? [{ id: "__none__", label: t("bases.chart.editor.none") }] : []),
        ...columns.map((column) => ({ id: column.id, label: column.name })),
      ]}
      value={value ?? (allowNone ? "__none__" : "")}
      onChange={(next) => onChange(next === "__none__" ? undefined : next)}
    />
  );
}

const stepperButtonClass =
  "grid size-7 shrink-0 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-40 pointer-coarse:size-9";

function ConfigSelect({
  value,
  options,
  label,
  onChange,
}: {
  value: string;
  options: Array<{ id: string; label: string }>;
  label: string;
  onChange(value: string): void;
}) {
  const { t } = useAppTranslation();
  return (
    <Select onValueChange={onChange} value={value}>
      <SelectTrigger aria-label={label} className="w-full">
        <SelectValue placeholder={t("bases.chart.editor.placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function SpanStepper({
  label,
  value,
  max,
  busy,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  busy: boolean;
  onChange(value: number): void;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="grid gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex h-7 items-center justify-between rounded-md border bg-input/20 pointer-coarse:h-9 dark:bg-input/30">
        <button
          aria-label={t("bases.chart.editor.decrease", { label })}
          className={stepperButtonClass}
          disabled={busy || value <= 1}
          onClick={() => onChange(value - 1)}
          type="button"
        >
          <MinusIcon className="size-3" />
        </button>
        <span className="tabular-nums">{value}</span>
        <button
          aria-label={t("bases.chart.editor.increase", { label })}
          className={stepperButtonClass}
          disabled={busy || value >= max}
          onClick={() => onChange(value + 1)}
          type="button"
        >
          <PlusIcon className="size-3" />
        </button>
      </div>
    </div>
  );
}
