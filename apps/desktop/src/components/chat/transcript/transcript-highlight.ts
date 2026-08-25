/**
 * [INPUT]: Depends on the browser DOM and the data-message-id conversion focus
 * [OUTPUT]: Provides findTranscriptTarget/highlightTranscriptTarget, a unified roll-in life 2 second ring with reduced-motion downgrade
 * [POS]: The first is the "Changes" of the "Changes" of the "Changes" of the "Changes"Outline, deep-chain and Find bar, without window extensions
 */

export function findTranscriptTarget(id: string, root: ParentNode = document) {
  const node = root.querySelector(
    `[data-message-id="${CSS.escape(id)}"]`
  );
  return node instanceof HTMLElement ? node : null;
}

export function highlightTranscriptTarget(node: HTMLElement) {
  node.classList.remove("ring-2", "ring-primary/60");
  void node.offsetWidth;
  node.classList.add(
    "rounded-lg",
    "ring-2",
    "ring-primary/60",
    "transition-shadow",
    "duration-500",
    "motion-reduce:transition-none"
  );
  window.setTimeout(() => {
    node.classList.remove("ring-2", "ring-primary/60");
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 2_000);
}
