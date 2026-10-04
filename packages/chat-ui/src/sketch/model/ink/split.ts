/**
 * [INPUT]: Depends on compact remaining-ink rows and bounded integer buffers.
 * [OUTPUT]: Provides four-neighbor connected components with tight bounds and stable spatial order.
 * [POS]: Worker finalization step; preserves every represented nonempty component and resize permission.
 */
import type { InkElement } from "../document";
import { assertBudget, MAX_ELEMENTS, TEMP_BYTES } from "../budget";
import { buildCoverage, counts, rows, type CoverageRow } from "./coverage";
export function splitInk(ink: InkElement): InkElement[] {
  const coverage = ink.coverage,
    n = counts(coverage).spans;
  if (!n) return [];
  // Union-find plus span labels are bounded before allocating; no pixel bitmap exists.
  assertBudget(n * 12, TEMP_BYTES / 2);
  const parents = new Int32Array(n),
    labels = new Int32Array(n);
  for (let i = 0; i < n; i++) parents[i] = i;
  const root = (i: number): number => {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  };
  let previous: ArrayLike<number> = [],
    previousY = -2,
    previousOffset = 0,
    cursor = 0;
  for (const [y, spans] of rows(coverage)) {
    if (y === previousY + 1) {
      let i = 0,
        j = 0;
      while (i < spans.length && j < previous.length) {
        if (spans[i] < previous[j + 1] && previous[j] < spans[i + 1])
          parents[root(cursor + i / 2)] = root(previousOffset + j / 2);
        if (spans[i + 1] <= previous[j + 1]) i += 2;
        else j += 2;
      }
    }
    previous = spans;
    previousY = y;
    previousOffset = cursor;
    cursor += spans.length / 2;
  }
  const components = new Map<
    number,
    { label: number; minX: number; minY: number; maxX: number; maxY: number }
  >();
  cursor = 0;
  for (const [y, spans] of rows(coverage))
    for (let i = 0; i < spans.length; i += 2) {
      const r = root(cursor),
        existing = components.get(r);
      if (!existing && components.size >= MAX_ELEMENTS)
        throw new Error("SKETCH_BUDGET");
      const c = existing ?? {
        label: components.size,
        minX: Infinity,
        minY: Infinity,
        maxX: -Infinity,
        maxY: -Infinity,
      };
      c.minX = Math.min(c.minX, spans[i]);
      c.maxX = Math.max(c.maxX, spans[i + 1]);
      c.minY = Math.min(c.minY, y);
      c.maxY = Math.max(c.maxY, y + 1);
      components.set(r, c);
      labels[cursor++] = c.label;
    }
  const sorted = [...components.values()].sort(
    (a, b) => a.minY - b.minY || a.minX - b.minX || a.label - b.label,
  );
  if (sorted.length === 1) {
    const c = sorted[0];
    if (
      c.minX === 0 &&
      c.minY === 0 &&
      c.maxX === coverage.width &&
      c.maxY === coverage.height
    )
      return [ink];
  }
  let totalBytes = 0;
  return sorted.map((component) => {
    function* selected(): Generator<CoverageRow> {
      let index = 0;
      for (const [y, spans] of rows(coverage)) {
        const row: number[] = [];
        for (let i = 0; i < spans.length; i += 2)
          if (labels[index++] === component.label)
            row.push(spans[i] - component.minX, spans[i + 1] - component.minX);
        if (row.length) yield [y - component.minY, row];
      }
    }
    const next = buildCoverage(
      component.maxX - component.minX,
      component.maxY - component.minY,
      coverage.cellSizeX,
      coverage.cellSizeY,
      selected(),
    );
    for (const b of next.blocks)
      totalBytes += b.rowIndex.byteLength + b.spans.byteLength + 108;
    assertBudget(totalBytes);
    return Object.freeze({
      ...ink,
      coverage: next,
      transform: Object.freeze({
        ...ink.transform,
        x:
          ink.transform.x +
          component.minX * coverage.cellSizeX * ink.transform.scaleX,
        y:
          ink.transform.y +
          component.minY * coverage.cellSizeY * ink.transform.scaleY,
      }),
    });
  });
}
