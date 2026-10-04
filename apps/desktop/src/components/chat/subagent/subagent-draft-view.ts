/**
 * [INPUT]: Depends on the turn draft shape and capPartMarkdown
 * [OUTPUT]: Provides subagentDraftView: the streamed-but-unsettled texts, capped parts, and streaming ids of a subagent's draft, cached on its parts and stream
 * [POS]: D-17 memo behind SubagentPanel; the reducer is immutable, so identical parts and stream mean nothing here changed
 */

import type { TurnDraft } from "@ai-chat/cloud-protocol/turns/reducer";
import { capPartMarkdown } from "@/lib/charts/chart-markdown";

type View = Readonly<{
  streaming: [string, string][];
  parts: TurnDraft["parts"];
  streamingIds: ReadonlySet<string>;
  fragment(itemId: string): string | undefined;
}>;

const cache = new WeakMap<TurnDraft["parts"], WeakMap<ReadonlyMap<string, string>, { active?: View; idle?: View }>>();

function compute(draft: Pick<TurnDraft, "parts" | "streaming">, active: boolean): View {
  const streaming = [...draft.streaming].filter(([itemId, text]) => text && !draft.parts.some((part) => part.itemId === itemId));
  const capped = capPartMarkdown(draft.parts, streaming.map(([itemId, text]) => ({ id: `stream:${itemId}`, markdown: text })));
  return {
    streaming,
    parts: capped.parts ?? draft.parts,
    streamingIds: active ? new Set(draft.streaming.keys()) : new Set(),
    fragment: (itemId) => capped.fragments.find((fragment) => fragment.id === `stream:${itemId}`)?.markdown,
  };
}

export function subagentDraftView(draft: Pick<TurnDraft, "parts" | "streaming">, active: boolean): View {
  let byStream = cache.get(draft.parts);
  if (!byStream) cache.set(draft.parts, byStream = new WeakMap());
  let views = byStream.get(draft.streaming);
  if (!views) byStream.set(draft.streaming, views = {});
  return active ? (views.active ??= compute(draft, true)) : (views.idle ??= compute(draft, false));
}
