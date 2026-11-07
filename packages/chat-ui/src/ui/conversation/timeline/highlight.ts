/**
 * [INPUT]: A row id, the live document, shared MessageContent slot and bounded ResizeObserver notifications for explicit message navigation.
 * [OUTPUT]: Provides findTranscriptTarget, measureOutlineTops (one query for all outline entries), scrollTranscriptTo, cancelTranscriptScroll, settleTranscriptBottom and highlightTranscriptTarget with bounded user-cancellable bubble alignment, coalesced resize corrections, bubble-scoped emphasis and reduced-motion support.
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

const pendingScrolls = new WeakMap<HTMLElement, () => void>();
export function cancelTranscriptScroll(scroller: HTMLElement) {
  pendingScrolls.get(scroller)?.();
}
function emphasisTarget(node: HTMLElement) {
  return node.querySelector<HTMLElement>('.is-user > [data-slot="message-content"]') ?? node;
}
/** Correct after visible row and Fold measurements, unless the user takes control. */
function settleTranscriptScroll(scroller: HTMLElement, align: () => void, corrections = 2, navigationTarget?: HTMLElement) {
  cancelTranscriptScroll(scroller);
  let frame: number | undefined;
  let remaining = corrections, active = true, scheduled = false;
  let allowance = navigationTarget ? 8 : corrections;
  let observer: ResizeObserver | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const key = (event: KeyboardEvent) => { if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) cancel(); };
  const cancel = () => {
    if (!active) return;
    active = false;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    scheduled = false;
    clearTimeout(expiry);
    observer?.disconnect();
    scroller.removeEventListener("wheel", cancel);
    scroller.removeEventListener("touchstart", cancel);
    scroller.removeEventListener("keydown", key);
    scroller.removeEventListener("pointerdown", cancel);
    scroller.removeEventListener("transcript-latest", cancel);
    pendingScrolls.delete(scroller);
  };
  const schedule = () => {
    if (!active || scheduled) return;
    scheduled = true;
    frame = requestAnimationFrame(() => {
      if (!active) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        scheduled = false;
        correct();
      });
    });
  };
  const correct = () => {
    if (!active || !scroller.isConnected || (navigationTarget && !navigationTarget.isConnected)) { cancel(); return; }
    align();
    if (--allowance === 0) { cancel(); return; }
    if (--remaining > 0) schedule(); else if (!observer) cancel();
  };
  pendingScrolls.set(scroller, cancel);
  scroller.addEventListener("wheel", cancel, { passive: true });
  scroller.addEventListener("touchstart", cancel, { passive: true });
  scroller.addEventListener("keydown", key);
  if (navigationTarget && typeof ResizeObserver !== "undefined") {
    // A seek must survive deferred row sizes without retaining scroll authority indefinitely.
    observer = new ResizeObserver(() => {
      if (!active) return;
      remaining = Math.min(corrections, allowance);
      schedule();
    });
    const content = navigationTarget.closest<HTMLElement>("[data-transcript-content]") ?? navigationTarget;
    observer.observe(content);
    observer.observe(scroller);
    if (navigationTarget !== content) observer.observe(navigationTarget);
    scroller.addEventListener("pointerdown", cancel, { passive: true });
    scroller.addEventListener("transcript-latest", cancel);
    expiry = setTimeout(cancel, 2_000);
  }
  align(); schedule();
}
export function scrollTranscriptTo(scroller: HTMLElement, node: HTMLElement, _behavior: ScrollBehavior) {
  const target = emphasisTarget(node);
  settleTranscriptScroll(scroller, () => {
    if (!target.isConnected) return;
    const top = target.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
    scroller.scrollTo({ top: Math.max(0, top - 16), behavior: "auto" });
  }, 2, target);
}
export function settleTranscriptBottom(scroller: HTMLElement, follow: () => void) {
  settleTranscriptScroll(scroller, follow, 4);
}

export function highlightTranscriptTarget(node: HTMLElement) {
  const target = emphasisTarget(node);
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

const mountedNavigation = new Map<string, Set<(id: string) => boolean>>();
/** Only mounted readers own paging, scroll position and message highlighting. */
export function registerTimelineNavigation(scope: string, jump: (id: string) => boolean) {
  let readers = mountedNavigation.get(scope);
  if (!readers) mountedNavigation.set(scope, readers = new Set());
  readers.add(jump);
  return () => { readers.delete(jump); if (!readers.size) mountedNavigation.delete(scope); };
}
export function revealTimelineMessage(scope: string, id: string) {
  if (!id || id.length > 128) return;
  const reader = [...(mountedNavigation.get(scope) ?? [])].at(-1);
  reader?.(id);
}
