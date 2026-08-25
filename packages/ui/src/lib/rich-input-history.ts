/**
 * [INPUT]: Depends on PromptInput RichNode/RichValue type and editor history snapshot
 * [OUTPUT]: Provides discardedRichNodes, calculating the truly inaccessible atomic nodes from throughout history
 * [POS]: The RichInput resource availability rules of ui/lib; Remove current aluminum from aluminum and permanently discard aluminum clearly separate
 */

import type {
  RichNode,
  RichValue,
} from "@ai-chat/ui/components/ai-elements/prompt-input";

type AtomicRichNode = Exclude<RichNode, { type: "text" }>;

export function discardedRichNodes(
  previous: readonly RichValue[],
  next: readonly RichValue[]
): AtomicRichNode[] {
  const reachable = new Set(
    next.flatMap((snapshot) => snapshot.map((node) => node.id))
  );
  const discarded = new Map<string, AtomicRichNode>();
  for (const snapshot of previous) {
    for (const node of snapshot) {
      if (node.type !== "text" && !reachable.has(node.id)) {
        discarded.set(node.id, node);
      }
    }
  }
  return [...discarded.values()];
}
