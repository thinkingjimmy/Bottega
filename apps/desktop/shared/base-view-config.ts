/**
 * [INPUT]: Depends on the type of chart-payload and the type of unit-value of base-values
 * [OUTPUT]: Provides Base Six classes row-backed view for the separation of combined, Gallery/Chart configuration, stable type list, groupable/column-scoped, determination, visible Base Columns
 * [POS]: The Base view of the shared border configuration; One-way import by bases-IPC to avoid further expansion of IPC protocol files
 */

import type { ChartType } from "./chart-payload";
import type { BaseCellValue } from "./base-values";

export const BASE_VIEW_TYPES = [
  "table",
  "list",
  "kanban",
  "map",
  "chart",
  "gallery",
] as const;

export type BaseViewType = (typeof BASE_VIEW_TYPES)[number];

/**
 * 认 `groupByColumnId` 的视图。同样是一处声明多处消费：
 * toolbar 决定 Group by 是否出现、workbench 决定这条 CAS 能否落盘，
 * 都不必再各自维护一串 `=== "table" || === "kanban"` 的类型或。
 */
export const GROUPABLE_BASE_VIEW_TYPES = ["table", "list", "kanban"] as const;

export type GroupableBaseViewType = (typeof GROUPABLE_BASE_VIEW_TYPES)[number];

/**
 * 认 `visibleColumnIds` 的视图：画面由「显哪些字段」决定的那几类。
 * 又一次一处声明多处消费——toolbar 决定字段开关是否出现、workbench 收窄投影、
 * main 的引用校验与删列清扫都读同一张表，不必各自维护 `=== "table" || === "list"`。
 * 缺省（未配置或空数组）一律读作「全显」，故新增列天然可见。
 */
export const COLUMN_SCOPED_BASE_VIEW_TYPES = ["table", "list", "kanban"] as const;

export type ColumnScopedBaseViewType =
  (typeof COLUMN_SCOPED_BASE_VIEW_TYPES)[number];

type BaseFilterValueOperator =
  | "eq"
  | "neq"
  | "contains"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

type BaseFilterEmptyOperator = "is-empty" | "not-empty";

export type BaseFilterComparison =
  | {
      kind: "condition";
      columnId: string;
      operator: BaseFilterValueOperator;
      value: BaseCellValue;
    }
  | {
      kind: "condition";
      columnId: string;
      operator: BaseFilterEmptyOperator;
      value?: never;
    };

export type BaseFilter =
  | BaseFilterComparison
  | { kind: "and"; filters: BaseFilter[] }
  | { kind: "or"; filters: BaseFilter[] }
  | { kind: "not"; filter: BaseFilter };

export type BaseSort = {
  columnId: string;
  direction: "asc" | "desc";
};

export type BaseAggregation =
  | "average"
  | "empty"
  | "filled"
  | "max"
  | "median"
  | "min"
  | "range"
  | "stddev"
  | "sum"
  | "unique";

export type BaseAggregationSetting = BaseAggregation | null;
export type BaseAggregationValues = Record<BaseAggregation, number | null>;

export type BaseCommonViewConfig = {
  filter?: BaseFilter;
  sorts?: BaseSort[];
};

export type ChartItem = {
  id: string;
  name?: string;
  chartType: ChartType;
  dimensionColumnId?: string;
  dateBucket?: "day" | "month";
  valueColumnIds?: string[];
  seriesColumnId?: string;
  aggregation?: BaseAggregation;
  /** 用 ECharts decal 纹理辅助区分数据系列；缺席即关闭。 */
  accessibleColors?: boolean;
  filter?: BaseFilter;
  filterScrubbed?: true;
  colSpan: 1 | 2 | 3 | 4;
  rowSpan: 1 | 2;
};

export type BaseViewConfig =
  | (BaseCommonViewConfig & {
      type: "table";
      visibleColumnIds?: string[];
      columnWidths?: Record<string, number>;
      groupByColumnId?: string;
      columnAggregations?: Record<string, BaseAggregationSetting>;
    })
  | (BaseCommonViewConfig & {
      type: "list";
      visibleColumnIds?: string[];
      groupByColumnId?: string;
    })
  | (BaseCommonViewConfig & {
      type: "kanban";
      visibleColumnIds?: string[];
      groupByColumnId?: string;
    })
  | (BaseCommonViewConfig & {
      type: "map";
      locationColumnId?: string;
      labelColumnId?: string;
    })
  | (BaseCommonViewConfig & {
      type: "chart";
      charts: ChartItem[];
      viewFilterScrubbed?: true;
    })
  | (BaseCommonViewConfig & {
      type: "gallery";
      attachmentColumnId: string;
      titleColumnId?: string;
      groupByDateColumnId?: string;
      dateBucket?: "minute" | "hour" | "day" | "week" | "month";
    });

export type GroupableViewConfig = Extract<
  BaseViewConfig,
  { type: GroupableBaseViewType }
>;

export function isGroupableView(
  config: BaseViewConfig
): config is GroupableViewConfig {
  return GROUPABLE_BASE_VIEW_TYPES.some((type) => type === config.type);
}

export type ColumnScopedViewConfig = Extract<
  BaseViewConfig,
  { type: ColumnScopedBaseViewType }
>;

export function isColumnScopedView(
  config: BaseViewConfig
): config is ColumnScopedViewConfig {
  return COLUMN_SCOPED_BASE_VIEW_TYPES.some((type) => type === config.type);
}

/**
 * 列可见性的唯一读法：未配置 / 空数组即全显，配置了就按 id 序取（缺席 id 静默跳过，
 * 因为删列的清扫是 main 的事，投影侧不该因一个陈旧 id 崩掉整块视图）。
 * 表格、列表与看板共用这一条，写两遍就会分叉。
 */
export function visibleBaseColumns<T extends { id: string }>(
  columns: readonly T[],
  visibleColumnIds?: readonly string[]
): T[] {
  return visibleColumnIds?.length
    ? visibleColumnIds.flatMap(
        (id) => columns.find((column) => column.id === id) ?? []
      )
    : [...columns];
}

// ============================================================================
// GUI 的相对资源路径：字符集即安全边界
// 一把尺量三处——zod 落盘校验、renderer 的 URL 构造、gateway 的磁盘解析。
// 拒绝首字符 `.` 即同时消灭 `..`、`.` 与隐藏文件三种特例，无需逐个判断。
// ============================================================================

export const GUI_PAGE_MAX_LENGTH = 256;

const GUI_PAGE_SEGMENT = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/;

export function isValidGuiPage(page: string) {
  if (!page || page.length > GUI_PAGE_MAX_LENGTH) return false;
  return page.split("/").every((segment) => GUI_PAGE_SEGMENT.test(segment));
}
