/**
 * [INPUT]: Depends on the renderer i18n provider
 * [OUTPUT]: Provides ChartSkeleton, the localized status placeholder shared by streaming and lazy boundaries
 * [POS]: Single waiting-state source for components/charts; both ChartCodeBlock and ChartFence reuse it
 */

import { useAppTranslation } from "@/components/providers/i18n-provider";

/**
 * 「正文还没流完」与「渲染器还没到」在用户眼里是同一种等待，因此只能有
 * 一块骨架。它留在首包（十几个字节）正是为了这一点：懒边界两侧都要用它，
 * 复制一份就等于允许两种等待长得不一样。
 */
export function ChartSkeleton() {
  const { t } = useAppTranslation();
  return (
    <div
      aria-label={t("bases.chart.render.generating")}
      className="h-[280px] animate-pulse rounded-xl border bg-muted/40 motion-reduce:animate-none"
      role="status"
    />
  );
}
