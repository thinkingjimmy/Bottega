/**
 * [INPUT]: IntersectionObserver and contentvisibilityautostatechange on the outer message row.
 * [OUTPUT]: observeVisibleRow runs geometry observers only while a row intersects the viewport and its contents are rendered.
 * [POS]: Measurement gate shared by Fold and Plan; skipped descendants must never be read for geometry.
 */
const targets = new Map<Element, { listeners: Set<(visible: boolean) => void>; visible?: boolean }>();
let observer: IntersectionObserver | undefined;
export function observeVisibleRow(element: HTMLElement, start: () => (() => void)) {
  const row = element.closest<HTMLElement>("[data-message-id]") ?? element;
  if (typeof IntersectionObserver === "undefined") return start();
  let intersecting = false, skipped = false, stop: (() => void) | undefined;
  const update = () => {
    if (intersecting && !skipped) stop ??= start();
    else { stop?.(); stop = undefined; }
  };
  const visible = (value: boolean) => { intersecting = value; update(); };
  const autoState = (event: Event) => {
    if (event.target !== row) return;
    skipped = (event as Event & { skipped: boolean }).skipped;
    update();
  };
  observer ??= new IntersectionObserver(entries => {
    for (const entry of entries) {
      const target = targets.get(entry.target);
      if (!target) continue;
      target.visible = entry.isIntersecting;
      target.listeners.forEach(notify => notify(entry.isIntersecting));
    }
  });
  let group = targets.get(row);
  if (!group) { targets.set(row, group = { listeners: new Set() }); observer.observe(row); }
  group.listeners.add(visible);
  if (group.visible !== undefined) visible(group.visible);
  row.addEventListener("contentvisibilityautostatechange", autoState);
  return () => {
    stop?.(); group.listeners.delete(visible); row.removeEventListener("contentvisibilityautostatechange", autoState);
    if (!group.listeners.size) { targets.delete(row); observer?.unobserve(row); }
    if (!targets.size) { observer?.disconnect(); observer = undefined; }
  };
}
