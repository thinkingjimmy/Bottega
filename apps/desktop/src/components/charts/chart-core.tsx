/**
 * [INPUT]: Depends on React, registered ECharts on request, six charts/components/Canvas, chart option/theme/lifecycle, valid theme store, graphic animation/unobstructed color strategy and shared ChartPayload
 * [OUTPUT]: ChartCore is the default and is responsible for ECharts + ResizeObserverpayload, valid theme or color change without interruption, re-read token and setOption, and pure animation update only works on the next payload
 * [POS]: The only re-running time sheet node of components/charts; It is only possible to download dynamically via LazyChart
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
import type { ChartPayload } from "../../../shared/chart-payload";
import { createChartLifecycle } from "@/lib/charts/chart-lifecycle";
import {
  buildChartOption,
  type ChartRenderPolicy,
} from "@/lib/charts/chart-option";
import { readChartTheme } from "@/lib/charts/chart-theme";
import { resolvedThemeStore } from "@/lib/theme";

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
  /* readChartTheme 是 computed style 的一次快照，不是订阅：主题换了而
     payload 没换，已挂载的实例就会永远停在上一套色。第三参与 getSnapshot
     同函数，静态渲染路径一并盖住。 */
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
