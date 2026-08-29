/**
 * [INPUT]: Depends on projected Base rows, chart-visible columns, a canonical BaseCellContext, ChartItem filters/aggregations, and ChartPayload limits
 * [OUTPUT]: Provides buildChartPayload and uniqueDisplayNames with payload/incomplete/empty/error outcomes
 * [POS]: The pure Chart projection model; view membership is filtered without replacing the caller's full-snapshot evaluation context
 */

import {
  calculateBaseAggregations,
  dedupeSelectOptions,
  parseBaseDate,
  projectBaseRows,
  type BaseCellContext,
  type BaseColumn,
  type BaseRow,
  type ChartItem,
} from "../../../shared/bases-ipc";
import {
  CHART_LABEL_LIMIT,
  CHART_POINT_LIMIT,
  CHART_SERIES_LIMIT,
  chartPayloadSchema,
  type ChartPayload,
} from "../../../shared/chart-payload";

export type ChartModelResult =
  | ChartPayload
  | { incomplete: string }
  | { empty: string }
  | { error: string };

type Group = { key: string; label: string };
type RowBuckets = Map<string, Map<string, BaseRow[]>>;

export function buildChartPayload(
  rows: readonly BaseRow[],
  columns: readonly BaseColumn[],
  item: ChartItem,
  context: BaseCellContext
): ChartModelResult {
  if (item.filterScrubbed) {
    return { incomplete: "筛选已因删列失效，请重新设置" };
  }
  const dimension = columns.find(
    (column) => column.id === item.dimensionColumnId
  );
  const values = (item.valueColumnIds ?? []).flatMap((id) => {
    const column = columns.find((candidate) => candidate.id === id);
    return column?.type === "number" ? [column] : [];
  });
  const seriesColumn = columns.find(
    (column) => column.id === item.seriesColumnId
  );
  if (!dimension || !["text", "select", "date"].includes(dimension.type)) {
    return { incomplete: "请选择文本、选项或日期维度列" };
  }
  if (!values.length || values.length !== (item.valueColumnIds?.length ?? 0)) {
    return { incomplete: "请选择有效的数值列" };
  }
  if (item.seriesColumnId && !seriesColumn) {
    return { incomplete: "请选择有效的次维度列" };
  }
  if (item.chartType === "pie" && seriesColumn) {
    return { incomplete: "饼图不支持次维度" };
  }
  if (
    item.chartType === "scatter" &&
    (seriesColumn || values.length !== 2)
  ) {
    return { incomplete: "散点图需要两个独立数值列，且不支持次维度" };
  }
  if (
    item.chartType === "heatmap" &&
    (!seriesColumn || values.length !== 1)
  ) {
    return { incomplete: "热力图需要一个数值列和一个次维度列" };
  }
  if (item.chartType === "pie" && values.length !== 1) {
    return { incomplete: "饼图需要一个数值列" };
  }
  if (seriesColumn && values.length !== 1) {
    return { incomplete: "使用次维度时只能选择一个数值列" };
  }

  const filtered = projectBaseRows(rows, { filter: item.filter }, context);
  const aggregation = item.aggregation ?? "sum";
  const valueColumn = values[0]!;
  const dimensionKeys = new Map<string, Group>();
  const seriesKeys = new Map<string, Group>();
  const buckets: RowBuckets = new Map();
  const valueSeriesCount = seriesColumn ? 0 : values.length;
  const dimensionOptionIds = selectOptionIds(dimension);
  const seriesOptionIds = seriesColumn
    ? selectOptionIds(seriesColumn)
    : undefined;
  for (const row of filtered) {
    const dimensionKey = groupKey(
      row.values[dimension.id],
      dimension,
      item.dateBucket
    );
    if (
      dimensionKey === undefined ||
      (dimensionOptionIds && !dimensionOptionIds.has(dimensionKey))
    ) {
      continue;
    }
    const seriesKey = seriesColumn
      ? groupKey(row.values[seriesColumn.id], seriesColumn)
      : undefined;
    if (
      seriesColumn &&
      (seriesKey === undefined ||
        (seriesOptionIds && !seriesOptionIds.has(seriesKey)))
    ) {
      continue;
    }
    addGroup(dimensionKeys, dimensionKey);
    if (dimensionKeys.size > CHART_LABEL_LIMIT) {
      return { error: "标签数量不能超过 120" };
    }
    if (seriesColumn) {
      addGroup(seriesKeys, seriesKey!);
      if (seriesKeys.size > CHART_SERIES_LIMIT) {
        return { error: "序列数量不能超过 12" };
      }
    }
    const seriesCount = seriesColumn ? seriesKeys.size : valueSeriesCount;
    if (dimensionKeys.size * seriesCount > CHART_POINT_LIMIT) {
      return { error: "图表数据点不能超过 2000" };
    }
    const dimensionBucket = buckets.get(dimensionKey) ?? new Map();
    const bucketKey = seriesColumn ? seriesKey! : "";
    const bucket = dimensionBucket.get(bucketKey) ?? [];
    bucket.push(row);
    dimensionBucket.set(bucketKey, bucket);
    buckets.set(dimensionKey, dimensionBucket);
  }
  const dimensionGroups = orderGroups(
    dimensionKeys,
    dimension
  );
  if (!dimensionGroups.length) return { empty: "无数据" };
  const seriesGroups = seriesColumn
    ? orderGroups(seriesKeys, seriesColumn)
    : values.map((column) => ({ key: column.id, label: column.name }));
  if (!seriesGroups.length) return { empty: "无数据" };
  const names = uniqueDisplayNames(seriesGroups.map((group) => group.label));
  const labels = uniqueDisplayNames(dimensionGroups.map((group) => group.label));
  const payload: ChartPayload = {
    type: item.chartType,
    labels,
    series: seriesGroups.map((seriesGroup, seriesIndex) => {
      const column = seriesColumn
        ? valueColumn
        : values.find((candidate) => candidate.id === seriesGroup.key)!;
      return {
        // ── pie 恒单序列且无次维度，扇区名走 labels；其余图型序列一律命名 ──
        ...(item.chartType === "pie" ? {} : { name: names[seriesIndex]! }),
        data: dimensionGroups.map((dimensionGroup) => {
          const bucket = buckets
            .get(dimensionGroup.key)
            ?.get(seriesColumn ? seriesGroup.key : "");
          return bucket?.length
            ? calculateBaseAggregations(bucket, column, context)[aggregation]
            : null;
        }),
      };
    }),
  };
  const points = payload.series.flatMap((series) => series.data);
  if (!points.some((value) => value !== null)) return { empty: "无数据" };
  if (
    payload.type === "pie" &&
    points.some((value) => value !== null && value < 0)
  ) {
    return { error: "饼图不能表示负值，请更换图型或筛选数据" };
  }
  if (
    payload.type === "pie" &&
    points.every((value) => value === null || value === 0)
  ) {
    return { empty: "无数据" };
  }
  const parsed = chartPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "图表数据超出限制" };
  }
  return parsed.data;
}

function addGroup(groups: Map<string, Group>, key: string) {
  if (!groups.has(key)) groups.set(key, { key, label: key });
}

function selectOptionIds(column: BaseColumn) {
  return column.type === "select"
    ? new Set(dedupeSelectOptions(column.options).map((option) => option.id))
    : undefined;
}

function orderGroups(
  groups: ReadonlyMap<string, Group>,
  column: BaseColumn
): Group[] {
  if (column.type === "select") {
    return dedupeSelectOptions(column.options)
      .filter((option) => groups.has(option.id))
      .map((option) => ({ key: option.id, label: option.label }));
  }
  const result = [...groups.values()];
  return column.type === "date"
    ? result.sort((left, right) => left.key.localeCompare(right.key))
    : result;
}

function groupKey(
  value: unknown,
  column: BaseColumn,
  dateBucket: ChartItem["dateBucket"] = "month"
) {
  if (value === undefined || value === "") return undefined;
  if (column.type === "date") {
    if (!parseBaseDate(value)) return undefined;
    return String(value).slice(0, dateBucket === "day" ? 10 : 7);
  }
  if (typeof value !== "string") return undefined;
  return value;
}

function truncateName(value: string, limit: number) {
  let result = value.slice(0, limit);
  const last = result.charCodeAt(result.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) result = result.slice(0, -1);
  return result;
}

export function uniqueDisplayNames(values: readonly string[]) {
  const used = new Set<string>();
  return values.map((raw) => {
    const source = raw || "未命名";
    let candidate = truncateName(source, 40);
    let suffixNumber = 2;
    while (used.has(candidate)) {
      const suffix = ` (${suffixNumber})`;
      candidate = `${truncateName(source, 40 - suffix.length)}${suffix}`;
      suffixNumber += 1;
    }
    used.add(candidate);
    return candidate;
  });
}
