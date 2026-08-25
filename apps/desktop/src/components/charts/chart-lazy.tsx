/**
 * [INPUT]: Depends on React lazy/Suspense, Skeleton, shared ChartPayload and ChartRenderPolicy
 * [OUTPUT]: Provides the only LazyChart packaging component, unified dynamic boundaries with reduced-motion fallback
 * [POS]: Exports of components/charts to ECharts; The host must not directly import ChartCore
 */

import { lazy, Suspense } from "react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import type { ChartPayload } from "../../../shared/chart-payload";
import type { ChartRenderPolicy } from "@/lib/charts/chart-option";

const ChartCore = lazy(() => import("./chart-core"));

export function LazyChart({
  payload,
  policy,
  onReady,
}: {
  payload: ChartPayload;
  policy: ChartRenderPolicy;
  onReady?: () => void;
}) {
  return (
    <Suspense
      fallback={
        <div aria-label="正在加载图表" className="size-full p-4" role="status">
          <Skeleton className="size-full motion-reduce:animate-none" />
        </div>
      }
    >
      <ChartCore onReady={onReady} payload={payload} policy={policy} />
    </Suspense>
  );
}
