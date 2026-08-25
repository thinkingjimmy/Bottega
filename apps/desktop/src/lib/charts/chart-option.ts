/**
 * [INPUT]: Depends on shared ChartPayload, ChartTheme, Clear animation/unobstructed color strategy and ECharts pure type
 * [OUTPUT]: Provides ChartRenderPolicy with buildChartOption
 * [POS]: The pixel configuration kernel of lib/charts; No import of ECharts, no host title when running
 */

import type { EChartsCoreOption } from "echarts/core";
import type { ChartPayload } from "../../../shared/chart-payload";
import type { ChartTheme } from "./chart-theme";

export type ChartRenderPolicy = {
  animation: boolean;
  accessibleColors: boolean;
};

const finiteValues = (payload: ChartPayload) =>
  payload.series.flatMap((series) =>
    series.data.filter((value): value is number => value !== null)
  );

export function buildChartOption(
  payload: ChartPayload,
  theme: ChartTheme,
  policy: ChartRenderPolicy
): EChartsCoreOption {
  const base = {
    animation: policy.animation,
    color: theme.palette,
    backgroundColor: theme.background,
    textStyle: { color: theme.text, fontSize: 12 },
    aria: {
      enabled: true,
      label: { enabled: false },
      decal: { show: policy.accessibleColors },
    },
    tooltip: { trigger: "item", renderMode: "richText" as const },
    legend: {
      show: payload.series.some((series) => Boolean(series.name)),
      textStyle: { color: theme.text },
      top: 0,
    },
  };
  if (payload.type === "pie") {
    return {
      ...base,
      series: [
        {
          type: "pie",
          radius: ["35%", "70%"],
          label: { formatter: "{b}: {d}%" },
          data: payload.labels.map((name, index) => ({
            name,
            value: payload.series[0]!.data[index],
          })),
        },
      ],
    };
  }
  if (payload.type === "radar") {
    return {
      ...base,
      radar: {
        indicator: payload.labels.map((name, index) => {
          const axisValues = payload.series
            .map((series) => series.data[index])
            .filter((value): value is number => value !== null);
          const min = Math.min(0, ...axisValues);
          return { name, min, max: Math.max(...axisValues, min + 1) };
        }),
        axisName: { color: theme.text },
        splitLine: { lineStyle: { color: theme.axis } },
      },
      series: [
        {
          type: "radar",
          data: payload.series.map((series) => ({
            name: series.name,
            value: series.data,
          })),
        },
      ],
    };
  }
  if (payload.type === "heatmap") {
    const values = finiteValues(payload);
    const min = Math.min(...values);
    const rawMax = Math.max(...values);
    const max = rawMax === min ? min + 1 : rawMax;
    return {
      ...base,
      grid: { left: 72, right: 24, top: 48, bottom: 48, containLabel: true },
      xAxis: axis("category", theme, payload.labels),
      yAxis: axis(
        "category",
        theme,
        payload.series.map((series) => series.name ?? "")
      ),
      visualMap: {
        min,
        max,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
      },
      series: [
        {
          type: "heatmap",
          data: payload.series.flatMap((series, y) =>
            series.data.flatMap((value, x) =>
              value === null ? [] : [[x, y, value]]
            )
          ),
        },
      ],
    };
  }
  if (payload.type === "scatter") {
    return {
      ...base,
      grid: grid(),
      xAxis: axis("value", theme),
      yAxis: axis("value", theme),
      tooltip: {
        ...base.tooltip,
        formatter: (params: { name: string; value: [number, number] }) =>
          `${params.name}: ${params.value[0]}, ${params.value[1]}`,
      },
      series: [
        {
          type: "scatter",
          name: payload.series.map((series) => series.name).join(" × "),
          data: payload.labels.flatMap((label, index) => {
            const x = payload.series[0]!.data[index];
            const y = payload.series[1]!.data[index];
            return x === null || y === null
              ? []
              : [{ name: label, value: [x, y] }];
          }),
        },
      ],
    };
  }
  const type = payload.type === "line" ? "line" : "bar";
  return {
    ...base,
    tooltip: { trigger: "axis", renderMode: "richText" },
    grid: grid(),
    xAxis: axis("category", theme, payload.labels),
    yAxis: axis("value", theme),
    series: payload.series.map((series) => ({
      type,
      name: series.name,
      data: series.data,
      ...(payload.type === "stacked-bar" ? { stack: "total" } : {}),
      ...(type === "line" ? { connectNulls: false, smooth: false } : {}),
    })),
  };
}

function grid() {
  return { left: 16, right: 16, top: 40, bottom: 16, containLabel: true };
}

function axis(
  type: "category" | "value",
  theme: ChartTheme,
  data?: string[]
) {
  return {
    type,
    ...(data ? { data } : {}),
    axisLabel: { color: theme.text },
    axisLine: { lineStyle: { color: theme.axis } },
    splitLine: { lineStyle: { color: theme.axis } },
  };
}
