/**
 * [INPUT]: Depends on shared capChartFences/MarkdownFragment with text part shape chat
 * [OUTPUT]: Provides capMarkdown, capMessageMarkdown and capPartMarkdown
 * [POS]: The projected boundary of the renderer message of lib/charts; Quota is determined before rendering and does not depend on React status
 */

import {
  capChartFences,
  scanFences,
  type MarkdownFragment,
} from "../../../shared/markdown-fences";

export const capMarkdown = (markdown: string, limit = 8) =>
  capChartFences([{ id: "content", markdown }], limit)[0]!.markdown;

export const chartFenceCount = (fragments: readonly MarkdownFragment[]) =>
  fragments.reduce(
    (total, fragment) =>
      total +
      scanFences(fragment.markdown).filter((fence) => fence.language === "chart")
        .length,
    0
  );

export function capPartMarkdown<
  T extends { itemId: string; type: string; text?: string },
>(parts: readonly T[], trailing: MarkdownFragment[] = [], limit = 8) {
  const fragments: MarkdownFragment[] = [
    ...parts.flatMap((part) =>
      part.type === "text" && part.text
        ? [{ id: part.itemId, markdown: part.text }]
        : []
    ),
    ...trailing,
  ];
  const capped = new Map(
    capChartFences(fragments, limit).map((fragment) => [
      fragment.id,
      fragment.markdown,
    ])
  );
  return {
    parts: parts.map((part) =>
      part.type === "text" && part.text
        ? { ...part, text: capped.get(part.itemId) ?? part.text }
        : part
    ),
    fragments: trailing.map((fragment) => ({
      ...fragment,
      markdown: capped.get(fragment.id) ?? fragment.markdown,
    })),
    chartCount: Math.min(limit, chartFenceCount(fragments)),
  };
}
