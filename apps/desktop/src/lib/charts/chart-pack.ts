/**
 * [INPUT]: Accepts the width of a graph id and grid in an array of ordered arrays perpetuated
 * [OUTPUT]: Provides strict-order packCharts, clampSpan, real grid resize unit and span attachment
 * [POS]: The lib/charts definitive grid solver; The layout, DOM and keyboard sequence are all based on the results
 */

export type PackableChart = {
  id: string;
  colSpan: number;
  rowSpan: number;
};

export type PackedChart = PackableChart & {
  col: number;
  row: number;
};

export function clampSpan(
  item: Pick<PackableChart, "colSpan" | "rowSpan">,
  columns: 2 | 4
) {
  return {
    colSpan: Math.max(1, Math.min(columns, Math.round(item.colSpan))),
    rowSpan: Math.max(1, Math.min(2, Math.round(item.rowSpan))),
  };
}

export function packCharts(
  items: readonly PackableChart[],
  columns: 2 | 4
): PackedChart[] {
  const occupied: boolean[][] = [];
  const result: PackedChart[] = [];
  let scan = 0;
  for (const item of items) {
    const span = clampSpan(item, columns);
    for (;;) {
      const row = Math.floor(scan / columns);
      const col = scan % columns;
      const fitsWidth = col + span.colSpan <= columns;
      const free =
        fitsWidth &&
        Array.from({ length: span.rowSpan }, (_, rowOffset) =>
          Array.from({ length: span.colSpan }, (_, colOffset) =>
            Boolean(occupied[row + rowOffset]?.[col + colOffset])
          ).every((value) => !value)
        ).every(Boolean);
      if (!free) {
        scan += 1;
        continue;
      }
      for (let rowOffset = 0; rowOffset < span.rowSpan; rowOffset += 1) {
        occupied[row + rowOffset] ??= [];
        for (let colOffset = 0; colOffset < span.colSpan; colOffset += 1) {
          occupied[row + rowOffset]![col + colOffset] = true;
        }
      }
      result.push({ id: item.id, col, row, ...span });
      scan += 1;
      break;
    }
  }
  return result;
}

export function snapSpan(delta: number, unit: number, initial: number, max: number) {
  if (!Number.isFinite(unit) || unit <= 0) return initial;
  return Math.max(1, Math.min(max, initial + Math.round(delta / unit)));
}

export function chartGridResizeUnit(
  contentWidth: number,
  columns: 2 | 4,
  gap = 12,
  rowHeight = 180
) {
  const track = Math.max(0, contentWidth - gap * (columns - 1)) / columns;
  return {
    column: track + gap,
    row: rowHeight + gap,
  };
}
