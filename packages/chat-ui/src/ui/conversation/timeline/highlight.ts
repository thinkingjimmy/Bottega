/**
 * [INPUT]: A row id, the live document and the shared MessageContent message-content slot.
 * [OUTPUT]: Provides findTranscriptTarget, measureOutlineTops (one query for all outline entries), scrollTranscriptTo and highlightTranscriptTarget with bubble-scoped user emphasis and reduced-motion support.
 * [POS]: The timeline's only DOM reach; window.ts decides which row, this file finds and lights it.
 */
export function findTranscriptTarget(id: string, root: ParentNode = document) {
  const node = root.querySelector(
    `[data-message-id="${CSS.escape(id)}"]`
  );
  return node instanceof HTMLElement ? node : null;
}

/**
 * D-07: every outline entry's offset from one querySelectorAll, instead of one querySelector per entry. The first row
 * carrying an id wins, as findTranscriptTarget would pick it; entries whose row isn't rendered are left out.
 */
export function measureOutlineTops(ids: readonly string[], scroller: HTMLElement) {
  const anchors = new Map<string, HTMLElement>();
  for (const node of scroller.querySelectorAll<HTMLElement>("[data-message-id]")) {
    const id = node.dataset.messageId;
    if (id && !anchors.has(id)) anchors.set(id, node);
  }
  const origin = scroller.getBoundingClientRect().top - scroller.scrollTop, tops: number[] = [], indexes: number[] = [];
  ids.forEach((id, index) => {
    const anchor = anchors.get(id);
    if (!anchor) return;
    tops.push(anchor.getBoundingClientRect().top - origin); indexes.push(index);
  });
  return { tops, indexes };
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
  const target = node.querySelector<HTMLElement>('.is-user > [data-slot="message-content"]') ?? node;
  target.classList.remove("ring-2", "ring-primary/60");
  void target.offsetWidth;
  target.classList.add(
    "rounded-lg",
    "ring-2",
    "ring-primary/60",
    "transition-shadow",
    "duration-500",
    "motion-reduce:transition-none"
  );
  window.setTimeout(() => {
    target.classList.remove("ring-2", "ring-primary/60");
  }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 2_000);
}
