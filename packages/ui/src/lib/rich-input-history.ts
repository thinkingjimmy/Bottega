/**
 * [INPUT]: Depends on PromptInput RichNode/RichValue type and editor history snapshot
 * [OUTPUT]: Provides discardedRichNodes, calculating the truly inaccessible atomic nodes from throughout history
 * [POS]: RichInput resource-lifetime rules in ui/lib; clearly separates nodes removed from the current value from nodes permanently discarded across history
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
