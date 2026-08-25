/**
 * [INPUT]: Depends on Streamdown CustomRendererProps, shared ChartPayload schema, ChartSkeleton, ChartViewport and the ChartComponent that can be injected
 * [OUTPUT]: Provides ChartCodeBlock; The official graphs clearly retain unobstructed color texture
 * [POS]: The chart fence of components/charts is tested and presented layer, the whole is located after the graph boundary of chart-fence-renderers; The illegal content is stored in the wrong card
 */

import { useContext } from "react";
import type { CustomRendererProps } from "@ai-chat/ui/components/ai-elements/message/renderer-context";
import { chartPayloadSchema } from "../../../shared/chart-payload";
import { ChartScrollRootContext } from "./chart-scroll-root";
import { ChartSkeleton } from "./chart-fence-skeleton";
import { SlimScroller } from "@ai-chat/ui/components/ui/slim-scroller";
import {
  ChartViewport,
  type ChartComponent,
} from "./chart-viewport";

export function ChartCodeBlock({
  code,
  isIncomplete,
  ChartComponent,
}: CustomRendererProps & { ChartComponent?: ChartComponent }) {
  const scrollRoot = useContext(ChartScrollRootContext);
  if (isIncomplete) return <ChartSkeleton />;
  let input: unknown;
  try {
    input = JSON.parse(code);
  } catch (cause) {
    return (
      <ChartError
        code={code}
        message={`JSON 解析失败：${cause instanceof Error ? cause.message : String(cause)}`}
      />
    );
  }
  const result = chartPayloadSchema.safeParse(input);
  if (!result.success) {
    return (
      <ChartError
        code={code}
        message={result.error.issues[0]?.message ?? "图表格式无效"}
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
  return (
    <div className="my-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm">
      <p className="text-destructive">{message}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-muted-foreground text-xs">
          查看原始图表代码
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
