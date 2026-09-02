/**
 * [INPUT]: Depends on Streamdown renderer props, i18n, the shared ChartPayload schema, ChartSkeleton, ChartViewport, and an injectable chart component
 * [OUTPUT]: Provides ChartCodeBlock with localized streaming, validation, source-disclosure, and accessible chart states
 * [POS]: Validating chart-fence renderer for components/charts; the registry owns lazy loading while this module owns payload acceptance and presentation
 */

import { useContext } from "react";
import type { CustomRendererProps } from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import { chartPayloadSchema } from "../../../shared/chart-payload";
import { ChartScrollRootContext } from "./chart-scroll-root";
import { ChartSkeleton } from "./chart-fence-skeleton";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import {
  ChartViewport,
  type ChartComponent,
} from "./chart-viewport";

export function ChartCodeBlock({
  code,
  isIncomplete,
  ChartComponent,
}: CustomRendererProps & { ChartComponent?: ChartComponent }) {
  const { t } = useAppTranslation();
  const scrollRoot = useContext(ChartScrollRootContext);
  if (isIncomplete) return <ChartSkeleton />;
  let input: unknown;
  try {
    input = JSON.parse(code);
  } catch {
    return (
      <ChartError
        code={code}
        message={t("bases.chart.render.invalidJson")}
      />
    );
  }
  const result = chartPayloadSchema.safeParse(input);
  if (!result.success) {
    return (
      <ChartError
        code={code}
        message={t("bases.chart.render.invalidFormat")}
      />
    );
  }
  return (
    <section className="my-3 overflow-hidden rounded-xl border bg-background">
      {result.data.title && (
        <h3 className="border-b px-4 py-2 font-medium text-sm">
          {result.data.title}
        </h3>
      )}
      <ChartViewport
        ChartComponent={ChartComponent}
        accessibleColors
        defer
        payload={result.data}
        scrollRoot={scrollRoot}
      />
    </section>
  );
}

function ChartError({ code, message }: { code: string; message: string }) {
  const { t } = useAppTranslation();
  return (
    <div className="my-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p className="text-destructive">{message}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground text-xs">
          {t("bases.chart.render.showSource")}
        </summary>
        <SlimScroller asChild>
          <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">
            {code}
          </pre>
        </SlimScroller>
      </details>
    </div>
  );
}
