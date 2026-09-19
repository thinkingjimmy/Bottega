/**
 * [INPUT]: Depends on React, ECharts registered on demand, its six chart types/components/the Canvas renderer, chart option/theme/lifecycle helpers, the resolved theme store, and the shared ChartPayload's animation/accessible-color strategy
 * [OUTPUT]: Provides ChartCore (default export), which owns the ECharts instance plus its ResizeObserver, reapplies setOption on a theme or color-token change without disrupting it, and only replays entrance animation on the next payload
 * [POS]: Shared chart presentation in charts/render.
 */

import { useEffect, useRef, useSyncExternalStore } from "react";
import { init, use as registerEChartsModules } from "echarts/core";
import {
  BarChart,
  HeatmapChart,
  LineChart,
  PieChart,
  RadarChart,
  ScatterChart,
} from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  RadarComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { ChartPayload } from "@ai-chat/base-ui/model/chart-payload";
import { createChartLifecycle } from "../chart-lifecycle";
import {
  buildChartOption,
  type ChartRenderPolicy,
} from "../chart-option";
import { readChartTheme } from "../chart-theme";
import { resolvedThemeStore } from "./theme-observer";

registerEChartsModules([
  PieChart,
  BarChart,
  LineChart,
  ScatterChart,
  RadarChart,
  HeatmapChart,
  GridComponent,
  RadarComponent,
  TooltipComponent,
  LegendComponent,
  VisualMapComponent,
  AriaComponent,
  CanvasRenderer,
]);

export default function ChartCore({
  payload,
  policy,
  onReady,
}: {
  payload: ChartPayload;
  policy: ChartRenderPolicy;
  onReady?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const lifecycleRef = useRef<ReturnType<typeof createChartLifecycle> | null>(null);
  const readyRef = useRef(false);
  const policyRef = useRef(policy);
  const onReadyRef = useRef(onReady);

  const resolvedTheme = useSyncExternalStore(
    resolvedThemeStore.subscribe,
    resolvedThemeStore.getSnapshot,
    resolvedThemeStore.getSnapshot
  );
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const lifecycle = createChartLifecycle({
      element,
      init: (target) => init(target, undefined, { renderer: "canvas" }),
      createResizeObserver: (callback) => new ResizeObserver(callback),
    });
    lifecycleRef.current = lifecycle;
    return () => {
      lifecycleRef.current = null;
      lifecycle.destroy();
    };
  }, []);
  useEffect(() => {
    policyRef.current = policy;
    onReadyRef.current = onReady;
  }, [onReady, policy]);
  useEffect(() => {
    const element = ref.current;
    const lifecycle = lifecycleRef.current;
    if (!element || !lifecycle) return;
    lifecycle.setOption(
      buildChartOption(payload, readChartTheme(element), policyRef.current)
    );
    if (readyRef.current) return;
    readyRef.current = true;
    onReadyRef.current?.();
  }, [payload, policy.accessibleColors, resolvedTheme]);
  return <div className="size-full" ref={ref} />;
}
