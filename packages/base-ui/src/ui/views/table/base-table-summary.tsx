/**
 * [INPUT]: Depends on projected table rows, the canonical BaseCellContext, aggregation kernels, column widths, optional frozen left offsets and optional configuration mutations
 * [OUTPUT]: Provides aligned summary cells whose membership follows the view and whose computed/relation values follow the full snapshot; the Calculate prompt is visible on touch
 * [POS]: Shared Base presentation in ui/views/table.
 */

import { useMemo, useState } from "react";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "../../platform/i18n";
import { leadingStickyLefts, STICKY_SUMMARY_CELL_CLASS } from "./table-sticky";
import type { BaseMutationOutcome } from "../../state/base-mutation-error";
import {
  BinaryIcon,
  ChevronsUpDownIcon,
  XIcon,
} from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@ai-chat/ui/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@ai-chat/ui/components/ui/popover";
import {
  baseAggregationsForColumn,
  calculateBaseAggregations,
  formatBaseAggregationValue,
  type BaseAggregation,
  type BaseAggregationSetting,
  type BaseCellContext,
  type BaseColumn,
  type BaseRow,
} from "@ai-chat/base-ui/model/bases-ipc";

const AGGREGATION_LABEL_KEYS = {
  average: "bases.summary.aggregation.average",
  empty: "bases.summary.aggregation.empty",
  filled: "bases.summary.aggregation.filled",
  max: "bases.summary.aggregation.max",
  median: "bases.summary.aggregation.median",
  min: "bases.summary.aggregation.min",
  range: "bases.summary.aggregation.range",
  stddev: "bases.summary.aggregation.stddev",
  sum: "bases.summary.aggregation.sum",
  unique: "bases.summary.aggregation.unique",
} as const satisfies Record<BaseAggregation, string>;
const aggregationLabelKey = (aggregation: BaseAggregation) =>
  AGGREGATION_LABEL_KEYS[aggregation];
const defaultNumberAggregation = (): BaseAggregation => "sum";

export function BaseTableSummaryCells({
  columns,
  context,
  rows,
  widths,
  aggregations,
  busy,
  scope,
  leadingWidths = [],
  stickyLefts,
  onAggregationChange,
}: {
  columns: BaseColumn[];
  context: BaseCellContext;
  rows: readonly BaseRow[];
  widths: Record<string, number>;
  aggregations?: Record<string, BaseAggregationSetting>;
  busy?: boolean;
  scope: string;

  leadingWidths?: readonly number[];
  /** Frozen left offsets by column id; leading placeholders freeze in order when provided. */
  stickyLefts?: ReadonlyMap<string, number>;

  onAggregationChange?(
    columnId: string,
    aggregation?: BaseAggregation
  ): Promise<BaseMutationOutcome>;
}) {
  const leadingLefts = stickyLefts ? leadingStickyLefts(leadingWidths) : [];
  return (
    <>
      {leadingWidths.map((width, index) => (
        <div
          className={cn("shrink-0 border-r", stickyLefts && STICKY_SUMMARY_CELL_CLASS)}
          key={index}
          style={{ width, left: stickyLefts ? leadingLefts[index] : undefined }}
        />
      ))}
      {columns.map((column) => (
        <SummaryCell
          key={column.id}
          aggregationSetting={aggregations?.[column.id]}
          busy={busy}
          column={column}
          context={context}
          onAggregationChange={onAggregationChange}
          rows={rows}
          scope={scope}
          stickyLeft={stickyLefts?.get(column.id)}
          width={widths[column.id]!}
        />
      ))}
    </>
  );
}

function SummaryCell({
  column,
  context,
  rows,
  width,
  aggregationSetting,
  busy,
  scope,
  stickyLeft,
  onAggregationChange,
}: {
  column: BaseColumn;
  context: BaseCellContext;
  rows: readonly BaseRow[];
  width: number;
  aggregationSetting?: BaseAggregationSetting;
  busy?: boolean;
  scope: string;
  stickyLeft?: number;
  onAggregationChange?(
    columnId: string,
    aggregation?: BaseAggregation
  ): Promise<BaseMutationOutcome>;
}) {
  const stickyClass = stickyLeft !== undefined ? STICKY_SUMMARY_CELL_CLASS : undefined;
  const stickyStyle = stickyLeft !== undefined ? { width, left: stickyLeft } : { width };
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const aggregation =
    aggregationSetting === undefined && column.type === "number"
      ? defaultNumberAggregation()
      : aggregationSetting ?? undefined;

  const computeValues = useMemo(() => {
    let cached: ReturnType<typeof calculateBaseAggregations> | null = null;
    return () => (cached ??= calculateBaseAggregations(rows, column, context));
  }, [column, context, rows]);
  const values = aggregation || open ? computeValues() : null;
  const select = (next?: BaseAggregation) => {
    setOpen(false);
    void onAggregationChange?.(column.id, next);
  };

  if (!onAggregationChange) {
    return (
      <div
        className={cn("flex h-9 shrink-0 items-center gap-1.5 border-r px-2 text-xs", stickyClass)}
        data-aggregation={aggregation}
        data-aggregation-column={column.id}
        data-aggregation-scope={scope}
        style={stickyStyle}
      >
        {aggregation && (
          <>
            <span className="min-w-0 truncate text-muted-foreground">
              {t(aggregationLabelKey(aggregation))}
            </span>
            <span className="ml-auto truncate font-medium tabular-nums">
              {formatBaseAggregationValue(values?.[aggregation] ?? null)}
            </span>
          </>
        )}
      </div>
    );
  }
  return (
    <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger asChild>
        <button
          aria-label={t("bases.summary.cellAria", {
            column: column.name,
            value: aggregation
              ? t(aggregationLabelKey(aggregation))
              : t("bases.summary.calculate"),
          })}
          className={cn("group/summary-cell flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-r px-2 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50", stickyClass)}
          data-aggregation={aggregation}
          data-aggregation-column={column.id}
          data-aggregation-scope={scope}
          disabled={busy}
          style={stickyStyle}
          type="button"
        >
          {aggregation ? (
            <>
              <ChevronsUpDownIcon className="size-3 shrink-0 text-muted-foreground" />
              <span className="min-w-0 truncate">
                {t(aggregationLabelKey(aggregation))}
              </span>
              <span className="ml-auto truncate font-medium tabular-nums">
                {formatBaseAggregationValue(values?.[aggregation] ?? null)}
              </span>
            </>
          ) : (
            <span
              aria-hidden="true"
              className="truncate text-muted-foreground opacity-0 transition-opacity group-hover/summary-cell:opacity-100 group-focus-visible/summary-cell:opacity-100 no-hover:opacity-100"
            >
              {t("bases.summary.calculate")}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-72 max-w-[calc(100vw-1rem)] p-0"
        side="top"
        sideOffset={6}
      >
        <Command>
          <CommandInput placeholder={t("bases.summary.search")} />
          <CommandList className="max-h-80">
            <CommandEmpty>{t("bases.summary.empty")}</CommandEmpty>
            <CommandGroup>
              {baseAggregationsForColumn(column).map((option) => (
                <CommandItem
                  key={option}
                  data-checked={aggregation === option}
                  onSelect={() => select(option)}
                  value={t(aggregationLabelKey(option))}
                >
                  <BinaryIcon className="text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">
                    {t(aggregationLabelKey(option))}
                  </span>
                  <span
                    className="w-20 shrink-0 text-right tabular-nums text-muted-foreground group-data-selected/command-item:text-foreground"
                    data-aggregation-preview={option}
                  >
                    {formatBaseAggregationValue(values?.[option] ?? null)}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
            {aggregation && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => select()} value={t("bases.summary.clear")}>
                    <XIcon className="text-muted-foreground" />
                    {t("bases.summary.clear")}
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
