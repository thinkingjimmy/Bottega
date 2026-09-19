/**
 * [INPUT]: Depends on React lazy/Suspense, i18n, Skeleton, shared ChartPayload, and ChartRenderPolicy
 * [OUTPUT]: Provides LazyChart, the sole dynamic ChartCore boundary with a localized reduced-motion fallback
 * [POS]: Shared chart presentation in charts/render.
 */

import { lazy, Suspense } from "react";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import type { ChartPayload } from "@ai-chat/base-ui/model/chart-payload";
import type { ChartRenderPolicy } from "../chart-option";
import { useAppTranslation } from "../../ui/platform/i18n";

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
  const { t } = useAppTranslation();
  return (
    <Suspense
      fallback={
        <div
          aria-label={t("bases.chart.render.loading")}
          className="size-full p-4"
          role="status"
        >
          <Skeleton className="size-full motion-reduce:animate-none" />
        </div>
      }
    >
      <ChartCore onReady={onReady} payload={payload} policy={policy} />
    </Suspense>
  );
}
