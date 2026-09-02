/**
 * [INPUT]: Depends on React lazy/Suspense, Streamdown renderer contracts, i18n, and ChartSkeleton
 * [OUTPUT]: Provides CHAT_FENCE_RENDERERS plus the localized ChartOverflowNotice
 * [POS]: Lazy registry boundary for components/charts; validation and viewport code load only when a chart fence is encountered
 */

import { lazy, Suspense } from "react";
import type {
  CustomRenderer,
  CustomRendererProps,
} from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import { ChartSkeleton } from "./chart-fence-skeleton";
import { useAppTranslation } from "@/components/providers/i18n-provider";

/**
 * 注册表要在挂载 Provider 时就位，正文里出不出现 chart 围栏却是运行期才
 * 知道的事。静态 import 于是让每一次冷启动都替「可能有图表」预付 zod 与
 * ChartViewport 的体积——lazy 把这笔预付变成实际发生时才付。
 */
const ChartCodeBlock = lazy(async () => ({
  default: (await import("./chart-code-block")).ChartCodeBlock,
}));

function ChartFence(props: CustomRendererProps) {
  return (
    <Suspense fallback={<ChartSkeleton />}>
      <ChartCodeBlock {...props} />
    </Suspense>
  );
}

export function ChartOverflowNotice() {
  const { t } = useAppTranslation();
  return (
    <div className="my-2 rounded-lg border bg-muted/30 p-3 text-muted-foreground text-sm">
      {t("bases.chart.render.overflow")}
    </div>
  );
}

export const CHAT_FENCE_RENDERERS: CustomRenderer[] = [
  { language: "chart", component: ChartFence },
  { language: "chart-overflow", component: ChartOverflowNotice },
];
