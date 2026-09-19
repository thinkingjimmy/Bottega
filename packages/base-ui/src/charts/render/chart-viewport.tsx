/**
 * [INPUT]: Depends on React, i18n, shared ChartPayload, ChartRenderPolicy, LazyChart, SlimScroller, and optional IntersectionObserver roots
 * [OUTPUT]: Provides ChartViewport and ChartComponent with a localized figure label, deferred rendering, one-shot animation, accessible data tables, and corner reservation
 * [POS]: Shared chart presentation in charts/render.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type MouseEvent,
} from "react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import type { ChartPayload } from "@ai-chat/base-ui/model/chart-payload";
import type { ChartRenderPolicy } from "../chart-option";
import type { TFunction } from "i18next";
import { useAppTranslation } from "../../ui/platform/i18n";
import { LazyChart } from "./chart-lazy";

export type ChartComponent = ComponentType<{
  payload: ChartPayload;
  policy: ChartRenderPolicy;
  onReady?: () => void;
}>;

function chartAriaLabel(payload: ChartPayload, t: TFunction) {
  const values = {
    type: t(`bases.chart.type.${payload.type}`),
    labels: t("bases.chart.render.labelCount", {
      count: payload.labels.length,
    }),
    series: t("bases.chart.render.seriesCount", {
      count: payload.series.length,
    }),
  };
  return payload.title
    ? t("bases.chart.render.ariaWithTitle", {
        ...values,
        title: payload.title,
      })
    : t("bases.chart.render.aria", values);
}

const actionHitAreaClass =
  "after:absolute after:inset-x-0 after:-inset-y-2.5 after:content-['']";

const actionRevealClass =
  "transition-opacity motion-reduce:transition-none [@media(hover:hover)_and_(pointer:fine)]:pointer-events-none [@media(hover:hover)_and_(pointer:fine)]:opacity-0 [@media(hover:hover)_and_(pointer:fine)]:group-hover/chart-viewport:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:group-hover/chart-viewport:opacity-100 [@media(hover:hover)_and_(pointer:fine)]:focus-visible:pointer-events-auto [@media(hover:hover)_and_(pointer:fine)]:focus-visible:opacity-100 aria-expanded:pointer-events-auto aria-expanded:opacity-100";

export function ChartViewport({
  payload,
  accessibleColors,
  scrollRoot,
  defer = false,
  className = "h-[280px]",
  cornerReserved = false,
  ChartComponent = LazyChart,
}: {
  payload: ChartPayload;

  accessibleColors: boolean;
  scrollRoot?: Element | null;
  defer?: boolean;
  className?: string;

  cornerReserved?: boolean;
  ChartComponent?: ChartComponent;
}) {
  const { t } = useAppTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const canDefer = defer && typeof IntersectionObserver !== "undefined";
  const [visible, setVisible] = useState(!canDefer);
  const [tableOpen, setTableOpen] = useState(false);
  const reducedMotion = useMemo(
    () =>
      typeof matchMedia === "function" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const [animation, setAnimation] = useState(!reducedMotion);
  const policy: ChartRenderPolicy = { animation, accessibleColors };
  useEffect(() => {
    if (!canDefer) return;
    const target = rootRef.current;
    if (!target) return;
    let destroyed = false;
    const observer = new IntersectionObserver(
      (entries) => {
        if (destroyed) return;
        const next = entries.some((entry) => entry.isIntersecting);
        setVisible(next);
      },
      { root: scrollRoot ?? null, rootMargin: "200% 0px" }
    );
    observer.observe(target);
    return () => {
      destroyed = true;
      observer.disconnect();
    };
  }, [canDefer, scrollRoot]);
  const markRendered = useCallback(() => {
    setAnimation(false);
  }, []);
  const stop = (event: MouseEvent) => event.stopPropagation();
  return (
    <figure
      aria-label={chartAriaLabel(payload, t)}
      className={`group/chart-viewport relative min-w-0 ${className}`}
      ref={rootRef}
    >
      <div aria-hidden="true" className="size-full">
        {visible ? (
          <ChartComponent
            onReady={markRendered}
            payload={payload}
            policy={policy}
          />
        ) : (
          <div className="size-full rounded-md bg-muted/30" />
        )}
      </div>
      <Button
        aria-expanded={tableOpen}
        className={`absolute bottom-1 ${cornerReserved ? "right-12" : "right-1"} shadow-sm ${actionHitAreaClass} ${actionRevealClass}`}
        onClick={(event) => {
          stop(event);
          setTableOpen((value) => !value);
        }}
        size="sm"
        type="button"
        variant="secondary"
      >
        {t(
          tableOpen
            ? "bases.chart.render.hideData"
            : "bases.chart.render.showData"
        )}
      </Button>
      {tableOpen && (
        <SlimScroller
          className="absolute inset-x-1 bottom-8 z-20 max-h-48 overflow-auto rounded-md border bg-background p-2 shadow-lg"
          onClick={stop}
        >
          <ChartDataTable payload={payload} />
        </SlimScroller>
      )}
    </figure>
  );
}

function ChartDataTable({ payload }: { payload: ChartPayload }) {
  const { t } = useAppTranslation();
  return (
    <table className="w-full border-collapse text-left text-xs">
      <caption className="sr-only">
        {payload.title ?? t("bases.chart.render.dataCaption")}
      </caption>
      <thead>
        <tr>
          <th className="border-b p-1">{t("bases.chart.render.labelHeader")}</th>
          {payload.series.map((series, index) => (
            <th className="border-b p-1" key={`${series.name}:${index}`}>
              {series.name ??
                t("bases.chart.render.seriesName", { index: index + 1 })}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {payload.labels.map((label, labelIndex) => (
          <tr key={`${label}:${labelIndex}`}>
            <th className="border-b p-1 font-normal">{label}</th>
            {payload.series.map((series, seriesIndex) => (
              <td className="border-b p-1" key={seriesIndex}>
                {series.data[labelIndex] ?? "—"}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
