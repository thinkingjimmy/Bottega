/**
 * [INPUT]: Depends on projected table rows, the canonical BaseCellContext, aggregation kernels, column widths, and optional configuration mutations
 * [OUTPUT]: Provides aligned summary cells whose membership follows the view and whose computed/relation values follow the full snapshot
 * [POS]: The Table aggregation surface; BaseWorkbench persists aggregation intent while this component owns selection and formatted results
 */

import { useMemo, useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
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
} from "../../../../../shared/bases-ipc";

/* 编译器同时核对算子全集与目录寻址；新增聚合若没补文案会直接 typecheck 红。 */
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
  onAggregationChange,
}: {
  columns: BaseColumn[];
  context: BaseCellContext;
  rows: readonly BaseRow[];
  widths: Record<string, number>;
  aggregations?: Record<string, BaseAggregationSetting>;
  busy?: boolean;
  scope: string;
  /* 统计行要对齐的不是「有没有勾选列」，而是「数据列之前还有几格非数据列」。
     曾是一枚布尔，于是每多一种前置列（行动作）就要多一枚布尔和一处分支；
     宽度清单让它退回一次 map——表体加几格，这里就空几格。 */
  leadingWidths?: readonly number[];
  /** 缺席即只读：统计值照算照显，改与清的入口不渲染 */
  onAggregationChange?(
    columnId: string,
    aggregation?: BaseAggregation
  ): Promise<BaseMutationOutcome>;
}) {
  return (
    <>
      {leadingWidths.map((width, index) => (
        <div
          className="shrink-0 border-r"
          key={index}
          style={{ width }}
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
  onAggregationChange,
}: {
  column: BaseColumn;
  context: BaseCellContext;
  rows: readonly BaseRow[];
  width: number;
  aggregationSetting?: BaseAggregationSetting;
  busy?: boolean;
  scope: string;
  onAggregationChange?(
    columnId: string,
    aggregation?: BaseAggregation
  ): Promise<BaseMutationOutcome>;
}) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const aggregation =
    aggregationSetting === undefined && column.type === "number"
      ? defaultNumberAggregation()
      : aggregationSetting ?? undefined;
  const values = useMemo(
    () =>
      aggregation || open
        ? calculateBaseAggregations(rows, column, context)
        : null,
    [aggregation, column, context, open, rows]
  );
  const select = (next?: BaseAggregation) => {
    setOpen(false);
    void onAggregationChange?.(column.id, next);
  };
  /* 只读面：统计值是纯函数、照算照显，配置入口整个不长出来。 */
  if (!onAggregationChange) {
    return (
      <div
        className="flex h-9 shrink-0 items-center gap-1.5 border-r px-2 text-xs"
        data-aggregation={aggregation}
        data-aggregation-column={column.id}
        data-aggregation-scope={scope}
        style={{ width }}
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
          className="group/summary-cell flex h-9 shrink-0 cursor-pointer items-center gap-1.5 border-r px-2 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          data-aggregation={aggregation}
          data-aggregation-column={column.id}
          data-aggregation-scope={scope}
          disabled={busy}
          style={{ width }}
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
              className="truncate text-muted-foreground opacity-0 transition-opacity group-hover/summary-cell:opacity-100 group-focus-visible/summary-cell:opacity-100"
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
