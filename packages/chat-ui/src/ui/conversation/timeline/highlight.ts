/**
 * [INPUT]: A row id and the live document.
 * [OUTPUT]: Provides findTranscriptTarget, scrollTranscriptTo and highlightTranscriptTarget with reduced-motion emphasis.
 * [POS]: The timeline's only DOM reach; window.ts decides which row, this file finds and lights it.
 */
export function findTranscriptTarget(id: string, root: ParentNode = document) {
  const node = root.querySelector(
    `[data-message-id="${CSS.escape(id)}"]`
  );
  return node instanceof HTMLElement ? node : null;
}

/** Scrolls `node` to sit 16px below the scroller's top edge. */
export function scrollTranscriptTo(
  scroller: HTMLElement,
  node: HTMLElement,
  behavior: ScrollBehavior
) {
  const top =
    node.getBoundingClientRect().top -
    scroller.getBoundingClientRect().top +
    scroller.scrollTop;
  scroller.scrollTo({ top: Math.max(0, top - 16), behavior });
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
