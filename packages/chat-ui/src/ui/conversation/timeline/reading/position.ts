/**
 * [INPUT]: Ordered outer message rows in the transcript scroll viewport.
 * [OUTPUT]: firstVisibleRow uses binary search over row boxes without measuring skipped descendants.
 * [POS]: Reader geometry helper; only idle flush, prepend and explicit navigation call it.
 */
export function firstVisibleRow(scroller: HTMLElement) {
  const rows = scroller.querySelectorAll<HTMLElement>("[data-message-id]");
  const top = scroller.getBoundingClientRect().top;
  let low = 0, high = rows.length;
  // Outer boxes work across imported wrappers and offset parents. Never read a row's contents.
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (rows[middle].getBoundingClientRect().bottom < top) low = middle + 1;
    else high = middle;
  }
  const row = rows[low];
  if (!row) return null;
  const box = row.getBoundingClientRect();
  return { id: row.dataset.messageId!, top: box.top, offsetTop: box.top - top };
}
export const atTranscriptBottom = (scroller: HTMLElement) => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= 24;
