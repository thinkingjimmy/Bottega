/**
 * [INPUT]: Depends on shared Base view/filter/column DTO, aggregation matrix and filter column
 * [OUTPUT]: Provides six row-backed column references/type fail-closed column references/type fail-closed column references/type fail-closed column references/type fail-closed column references/view/formulae delete column scrub and Gallery required attachment
 * [POS]: The view-model rules of bases/validation; BasesService only organizes transactions, not cross-view branches
 */

import {
  baseAggregationsForColumn,
  baseFormulaDependencies,
  filterReferencesColumn,
  isColumnScopedView,
  isGroupableView,
  type BaseColumn,
  type BaseFilter,
  type BaseView,
} from "../../../../shared/bases-ipc";
import type { ChartItem } from "../../../../shared/base-view-config";

const clone = <T>(value: T): T => structuredClone(value);

export function validateBaseView(
  view: BaseView,
  columns: ReadonlyMap<string, BaseColumn>
) {
  const config = view.config;
  const referenced = new Set<string>();
  for (const sort of config.sorts ?? []) referenced.add(sort.columnId);
  for (const id of isColumnScopedView(config)
    ? config.visibleColumnIds ?? []
    : []) {
    referenced.add(id);
  }
  if (config.type === "table") {
    for (const id of Object.keys(config.columnWidths ?? {})) {
      referenced.add(id);
    }
    for (const id of Object.keys(config.columnAggregations ?? {})) {
      referenced.add(id);
    }
  }
  if (isGroupableView(config) && config.groupByColumnId) {
    if (columns.get(config.groupByColumnId)?.type === "formula") {
      throw validationError("formula 列不能作为视图分组配置");
    }
    referenced.add(config.groupByColumnId);
  }
  if (config.type === "map") {
    if (config.locationColumnId) {
      referenced.add(config.locationColumnId);
    }
    if (config.labelColumnId) {
      if (columns.get(config.labelColumnId)?.type === "formula") {
        throw validationError("formula 列不能作为 Map 标签配置");
      }
      referenced.add(config.labelColumnId);
    }
  }
  if (config.type === "chart") {
    validateCharts(view, columns);
  }
  if (config.type === "gallery") {
    validateGallery(view, columns);
    referenced.add(config.attachmentColumnId);
    if (config.titleColumnId) referenced.add(config.titleColumnId);
    if (config.groupByDateColumnId) referenced.add(config.groupByDateColumnId);
  }
  if (config.filter) {
    assertAttachmentFilter(config.filter, columns);
  }
  visitFilter(config.filter, (id) => referenced.add(id));
  for (const id of referenced) {
    if (!columns.has(id)) {
      throw validationError(
        `视图 ${view.name} 引用了未知列 ${id}`
      );
    }
  }
  validateAggregations(view, columns);
}

function validateGallery(
  view: BaseView,
  columns: ReadonlyMap<string, BaseColumn>
) {
  if (view.config.type !== "gallery") return;
  const attachment = requireColumn(
    view,
    columns,
    view.config.attachmentColumnId
  );
  if (attachment.type !== "attachment") {
    throw validationError(`列 ${attachment.name} 不能作为 Gallery 附件列`);
  }
  if (view.config.groupByDateColumnId) {
    const date = requireColumn(
      view,
      columns,
      view.config.groupByDateColumnId
    );
    if (date.type !== "date") {
      throw validationError(`列 ${date.name} 不能作为 Gallery 日期列`);
    }
  }
  if (
    view.config.titleColumnId &&
    columns.get(view.config.titleColumnId)?.type === "formula"
  ) {
    throw validationError("formula 列不能作为 Gallery 标题配置");
  }
}

function validateCharts(
  view: BaseView,
  columns: ReadonlyMap<string, BaseColumn>
) {
  if (view.config.type !== "chart") return;
  for (const item of view.config.charts) {
    if (item.dimensionColumnId) {
      const column = requireColumn(view, columns, item.dimensionColumnId);
      if (!["text", "select", "date"].includes(column.type)) {
        throw validationError(`列 ${column.name} 不能作为图表维度`);
      }
    }
    for (const id of item.valueColumnIds ?? []) {
      const column = requireColumn(view, columns, id);
      if (column.type !== "number") {
        throw validationError(`列 ${column.name} 不能作为图表数值`);
      }
    }
    if (item.seriesColumnId) {
      const column = requireColumn(view, columns, item.seriesColumnId);
      if (!["text", "select"].includes(column.type)) {
        throw validationError(`列 ${column.name} 不能作为图表次维度`);
      }
    }
    visitFilter(item.filter, (id) => {
      if (!columns.has(id)) {
        throw validationError(
          `视图 ${view.name} 的图表筛选引用了未知列 ${id}`
        );
      }
    });
  }
}

function requireColumn(
  view: BaseView,
  columns: ReadonlyMap<string, BaseColumn>,
  id: string
) {
  const column = columns.get(id);
  if (!column) {
    throw validationError(`视图 ${view.name} 引用了未知列 ${id}`);
  }
  return column;
}

function validateAggregations(
  view: BaseView,
  columns: ReadonlyMap<string, BaseColumn>
) {
  if (view.config.type !== "table") return;
  for (const [id, aggregation] of Object.entries(
    view.config.columnAggregations ?? {}
  )) {
    const column = columns.get(id)!;
    if (aggregation === null) continue;
    if (!baseAggregationsForColumn(column).includes(aggregation)) {
      throw validationError(
        `列 ${column.name} 不支持 ${aggregation} 统计`
      );
    }
  }
}

function assertAttachmentFilter(
  filter: BaseFilter,
  columns: ReadonlyMap<string, BaseColumn>
) {
  if (filter.kind === "and" || filter.kind === "or") {
    filter.filters.forEach((child) =>
      assertAttachmentFilter(child, columns)
    );
    return;
  }
  if (filter.kind === "not") {
    assertAttachmentFilter(filter.filter, columns);
    return;
  }
  if (
    columns.get(filter.columnId)?.type === "attachment" &&
    filter.operator !== "is-empty" &&
    filter.operator !== "not-empty"
  ) {
    throw validationError(
      "attachment 列只支持 is-empty/not-empty 筛选"
    );
  }
}

function visitFilter(
  filter: BaseFilter | undefined,
  visit: (columnId: string) => void
) {
  if (!filter) return;
  if (filter.kind === "condition") return visit(filter.columnId);
  if (filter.kind === "not") return visitFilter(filter.filter, visit);
  filter.filters.forEach((child) => visitFilter(child, visit));
}

export function scrubBaseView(
  view: BaseView,
  removed: ReadonlySet<string>
): BaseView {
  if (!removed.size) return view;
  const config = clone(view.config);
  const viewFilterRemoved = [...removed].some((id) =>
    filterReferencesColumn(config.filter, id)
  );
  if (viewFilterRemoved) {
    delete config.filter;
    if (config.type === "chart") config.viewFilterScrubbed = true;
  }
  config.sorts = config.sorts?.filter(
    (sort) => !removed.has(sort.columnId)
  );
  if (isColumnScopedView(config)) {
    config.visibleColumnIds = config.visibleColumnIds?.filter(
      (id) => !removed.has(id)
    );
  }
  if (config.type === "table" && config.columnWidths) {
    config.columnWidths = Object.fromEntries(
      Object.entries(config.columnWidths).filter(
        ([id]) => !removed.has(id)
      )
    );
    if (!Object.keys(config.columnWidths).length) {
      delete config.columnWidths;
    }
  }
  if (config.type === "table" && config.columnAggregations) {
    config.columnAggregations = Object.fromEntries(
      Object.entries(config.columnAggregations).filter(
        ([id]) => !removed.has(id)
      )
    );
    if (!Object.keys(config.columnAggregations).length) {
      delete config.columnAggregations;
    }
  }
  if (isGroupableView(config) && removed.has(config.groupByColumnId ?? "")) {
    delete config.groupByColumnId;
  }
  if (config.type === "map") {
    if (removed.has(config.locationColumnId ?? "")) {
      delete config.locationColumnId;
    }
    if (removed.has(config.labelColumnId ?? "")) {
      delete config.labelColumnId;
    }
  }
  if (config.type === "chart") {
    config.charts = config.charts.map((item) => scrubChart(item, removed));
  }
  if (config.type === "gallery") {
    if (removed.has(config.titleColumnId ?? "")) {
      delete config.titleColumnId;
    }
    if (removed.has(config.groupByDateColumnId ?? "")) {
      delete config.groupByDateColumnId;
      delete config.dateBucket;
    }
  }
  return { ...view, config };
}

export function scrubBaseViews(
  views: BaseView[],
  removed: ReadonlySet<string>,
  remainingColumns: BaseColumn[]
) {
  const attachmentColumnId = remainingColumns.find(
    (column) => column.type === "attachment"
  )?.id;
  const scrubbed = views.flatMap((view) => {
    if (
      view.config.type === "gallery" &&
      removed.has(view.config.attachmentColumnId)
    ) {
      if (!attachmentColumnId) return [];
      return [scrubBaseView({
        ...view,
        config: { ...view.config, attachmentColumnId },
      }, removed)];
    }
    return [scrubBaseView(view, removed)];
  });
  if (scrubbed.length) {
    return scrubbed.map((view, order) => ({ ...view, order }));
  }
  return [{
    id: "table",
    name: "Table",
    order: 0,
    config: { type: "table" as const },
  }];
}

export function scrubBaseFormulaColumns(
  columns: BaseColumn[],
  removed: ReadonlySet<string>
) {
  if (!removed.size) return columns;
  return columns.map((column) => {
    if (column.type !== "formula" || !column.formula) return column;
    const broken = baseFormulaDependencies(column.formula.expression).filter(
      (columnId) => removed.has(columnId)
    );
    if (!broken.length) return column;
    return {
      ...column,
      formula: {
        ...column.formula,
        invalidReferences: [
          ...new Set([...(column.formula.invalidReferences ?? []), ...broken]),
        ],
      },
    };
  });
}

export function scrubBaseRelationColumns(
  columns: BaseColumn[],
  removed: ReadonlySet<string>
) {
  if (!removed.size) return columns;
  const fallback = columns.find((column) => column.type === "text")?.id ?? null;
  return columns.map((column) =>
    column.type === "relation" &&
    column.relation &&
    removed.has(column.relation.labelColumnId ?? "")
      ? { ...column, relation: { labelColumnId: fallback } }
      : column
  );
}

function scrubChart(
  item: ChartItem,
  removed: ReadonlySet<string>
) {
  const next = clone(item);
  if (removed.has(next.dimensionColumnId ?? "")) {
    delete next.dimensionColumnId;
  }
  if (removed.has(next.seriesColumnId ?? "")) {
    delete next.seriesColumnId;
  }
  next.valueColumnIds = next.valueColumnIds?.filter(
    (id) => !removed.has(id)
  );
  if (!next.valueColumnIds?.length) delete next.valueColumnIds;
  if (
    [...removed].some((id) =>
      filterReferencesColumn(next.filter, id)
    )
  ) {
    delete next.filter;
    next.filterScrubbed = true;
  }
  return next;
}

function validationError(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}
