/**
 * [INPUT]: Depends only on column ids and pixel widths; no React or DOM
 * [OUTPUT]: Provides stickyLefts (frozen left offsets for the leading select/actions cells and the first data column) plus the sticky cell classes
 * [POS]: Shared Base presentation in ui/views/table; the view applies these to header, body, group summary and total summary cells alike
 */

// A first column wider than this would freeze most of a phone viewport and leave nothing to scroll, so it stays free.
export const STICKY_FIRST_COLUMN_MAX_WIDTH = 240;

/** Opaque backgrounds are required: a frozen cell paints over the cells scrolling underneath it. */
export const STICKY_HEADER_CELL_CLASS = "sticky z-[2] bg-muted";
export const STICKY_CELL_CLASS =
  "sticky z-[1] bg-background group-hover/row:bg-[color-mix(in_oklab,var(--muted)_25%,var(--background))]";
export const STICKY_SUMMARY_CELL_CLASS = "sticky z-[1] bg-background";

export function leadingStickyLefts(leadingWidths: readonly number[]): number[] {
  const lefts: number[] = [];
  let left = 0;
  for (const width of leadingWidths) {
    lefts.push(left);
    left += width;
  }
  return lefts;
}

/**
 * Left offsets keyed by column id. Only the first data column can freeze, and only while it is narrow
 * enough to leave room for the scrolling columns.
 */
export function stickyLefts(
  leadingWidths: readonly number[],
  firstColumnId: string | undefined,
  firstColumnWidth: number | undefined
): Map<string, number> {
  const lefts = new Map<string, number>();
  if (
    firstColumnId &&
    firstColumnWidth !== undefined &&
    firstColumnWidth <= STICKY_FIRST_COLUMN_MAX_WIDTH
  ) {
    lefts.set(
      firstColumnId,
      leadingWidths.reduce((total, width) => total + width, 0)
    );
  }
  return lefts;
}
