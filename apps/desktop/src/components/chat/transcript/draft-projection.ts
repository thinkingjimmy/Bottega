/**
 * [INPUT]: Depends on React use Memo, TurnDraft/DraftPlanProjection and chart Markdown quota projection
 * [OUTPUT]: Provides useDraftProjection, which separates the cold scan of the finished parts from the hot scan of the flow text/Plan
 * [POS]: The current draft of the chat/transcript is a pure projection hook; chat-turn is only responsible for the layout of the components, and no longer has a history of each scan
 */

import { useMemo } from "react";
import {
  type DraftPlanProjection,
  type TurnDraft,
} from "../../../../shared/chat-turn-reducer";
import { capPartMarkdown } from "@/lib/charts/chart-markdown";

const CHART_LIMIT = 8;

export function useDraftProjection(
  draft: TurnDraft,
  plan: DraftPlanProjection | null
) {
  const planItemId = plan?.itemId;
  const cold = useMemo(() => {
    const visibleParts = planItemId
      ? draft.parts.filter((part) => part.itemId !== planItemId)
      : draft.parts;
    const planIndex = planItemId
      ? draft.parts.findIndex((part) => part.itemId === planItemId)
      : -1;
    return {
      ...capPartMarkdown(visibleParts),
      planIndex,
      visibleCount: visibleParts.length,
    };
  }, [draft.parts, planItemId]);

  const streamingTexts = [...draft.streaming.entries()].filter(
    ([itemId, text]) =>
      itemId !== plan?.itemId &&
      text &&
      !draft.parts.some((part) => part.itemId === itemId)
  );
  const hot = capPartMarkdown(
    [],
    [
      ...streamingTexts.map(([itemId, text]) => ({
        id: `stream:${itemId}`,
        markdown: text,
      })),
      ...(plan ? [{ id: `plan:${plan.itemId}`, markdown: plan.content }] : []),
    ],
    Math.max(0, CHART_LIMIT - cold.chartCount)
  );
  const cappedStreaming = new Map(
    hot.fragments
      .filter((fragment) => fragment.id.startsWith("stream:"))
      .map((fragment) => [fragment.id.slice(7), fragment.markdown])
  );
  const cappedPlan = plan
    ? hot.fragments.find((fragment) => fragment.id === `plan:${plan.itemId}`)
        ?.markdown ?? plan.content
    : "";
  const streamingKey = JSON.stringify([...draft.streaming.keys()]);
  const streamingIds = useMemo(
    () => new Set<string>(JSON.parse(streamingKey) as string[]),
    [streamingKey]
  );

  return {
    beforePlan:
      cold.planIndex >= 0
        ? cold.parts.slice(0, cold.planIndex)
        : cold.parts,
    afterPlan:
      cold.planIndex >= 0 ? cold.parts.slice(cold.planIndex) : [],
    cappedPlan,
    cappedStreaming,
    streamingIds,
    streamingTexts,
    visibleCount: cold.visibleCount,
  };
}
