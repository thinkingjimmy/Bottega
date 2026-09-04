/**
 * [INPUT]: Accepts the latest chart view config and the renderer generates the id level intent op
 * [OUTPUT]: Provides ChartOp, applyChartOpToConfig, and stripChartSorts
 * [POS]: The lib/charts syntax is also usedThe workbench is read/commit only and does not directly reconfigure the old array
 */

import {
  CHART_ITEM_LIMIT,
  type BaseViewConfig,
  type ChartItem,
} from "../../../shared/bases-ipc";

export type ChartOp =
  | { type: "patch"; id: string; patch: Partial<ChartItem> }
  | { type: "remove"; id: string }
  | { type: "append"; item: ChartItem }
  | { type: "reorder"; orderedIds: string[] }
  | {
      type: "resize";
      id: string;
      colSpan: ChartItem["colSpan"];
      rowSpan: ChartItem["rowSpan"];
    };

export function applyChartOpToConfig(
  config: Extract<BaseViewConfig, { type: "chart" }>,
  op: ChartOp
): Extract<BaseViewConfig, { type: "chart" }> {
  if (op.type === "append") {
    if (config.charts.some((item) => item.id === op.item.id)) return config;
    if (config.charts.length >= CHART_ITEM_LIMIT) {
      throw new Error(`一个 Chart 视图最多 ${CHART_ITEM_LIMIT} 张图`);
    }
    return { ...config, charts: [...config.charts, op.item] };
  }
  if (op.type === "remove") {
    return {
      ...config,
      charts: config.charts.filter((item) => item.id !== op.id),
    };
  }
  if (op.type === "reorder") {
    const byId = new Map(config.charts.map((item) => [item.id, item]));
    const ordered = op.orderedIds.flatMap((id) => {
      const item = byId.get(id);
      if (!item) return [];
      byId.delete(id);
      return [item];
    });
    return { ...config, charts: [...ordered, ...byId.values()] };
  }
  const charts = config.charts.map((item) => {
    if (item.id !== op.id) return item;
    if (op.type === "resize") {
      return {
        ...item,
        colSpan: op.colSpan,
        rowSpan: op.rowSpan,
      };
    }
    const next = { ...item, ...op.patch };
    for (const key of Object.keys(op.patch) as Array<keyof ChartItem>) {
      if (op.patch[key] === undefined) delete next[key];
    }
    return next;
  });
  return { ...config, charts };
}

export function stripChartSorts(
  config: BaseViewConfig
): BaseViewConfig {
  if (config.type !== "chart" || config.sorts === undefined) return config;
  const { sorts: _sorts, ...rest } = config;
  return rest;
}
