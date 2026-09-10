/**
 * [INPUT]: Depends on continuous world-space capsules and immutable compact coverage blocks.
 * [OUTPUT]: Provides exact interval subtraction at cell centers with unchanged-block sharing.
 * [POS]: Worker subtraction step; never reconstructs ancestors or rounds fragment end caps.
 */
import type { InkElement } from "../document";
import { assertBudget, TEMP_BYTES } from "../budget";
import { capsuleSlice } from "../geometry/primitives";
import { finitePoint, type Point } from "../geometry/transform";
import {
  blockBytes,
  buildCoverage,
  mergeSpans,
  occupiedSpan,
  type CoverageBlock,
  type CoverageRow,
} from "./coverage";
export function validateSweep(points: readonly Point[], radius: number) {
  if (
    !Number.isFinite(radius) ||
    radius <= 0 ||
    radius > 96 ||
    !points.length ||
    points.some((p) => !finitePoint(p))
  )
    throw new Error("SKETCH_INVALID_SOURCE");
  assertBudget(points.length * 48, TEMP_BYTES / 4);
}
export function subtractSpans(
  source: ArrayLike<number>,
  cuts: ArrayLike<number>,
): number[] {
  const result: number[] = [];
  let j = 0;
  for (let i = 0; i < source.length; i += 2) {
    let start = source[i];
    const end = source[i + 1];
    while (j < cuts.length && cuts[j + 1] <= start) j += 2;
    let k = j;
    while (k < cuts.length && cuts[k] < end) {
      if (cuts[k] > start) result.push(start, Math.min(cuts[k], end));
      start = Math.max(start, cuts[k + 1]);
      if (start >= end) break;
      k += 2;
    }
    if (start < end) result.push(start, end);
  }
  return result;
}
export function eraseCoverage(
  ink: InkElement,
  points: readonly Point[],
  radius: number,
): InkElement {
  validateSweep(points, radius);
  const coverage = ink.coverage,
    t = ink.transform,
    blocks: CoverageBlock[] = [];
  let changed = false,
    bytes = 64;
  for (const block of coverage.blocks) {
    let blockChanged = false;
    const output: CoverageRow[] = [];
    for (let i = 0; i < block.rowIndex.length; i += 3) {
      const y = block.rowIndex[i],
        offset = block.rowIndex[i + 1],
        count = block.rowIndex[i + 2];
      const source = block.spans.subarray(offset * 2, (offset + count) * 2);
      const worldY = t.y + (y + 0.5) * coverage.cellSizeY * t.scaleY;
      const cuts: [number, number][] = [];
      for (let j = 0; j < Math.max(1, points.length - 1); j++) {
        const a = points[j],
          b = points[j + 1] ?? a;
        if (
          worldY < Math.min(a.y, b.y) - radius ||
          worldY > Math.max(a.y, b.y) + radius
        )
          continue;
        const slice = capsuleSlice(a, b, radius, worldY);
        if (!slice) continue;
        const span = occupiedSpan(
          slice[0],
          slice[1],
          t.x,
          coverage.cellSizeX * t.scaleX,
          coverage.width,
        );
        if (span) cuts.push(span);
      }
      if (!cuts.length) {
        output.push([y, source]);
        continue;
      }
      const remaining = subtractSpans(source, mergeSpans(cuts));
      const rowChanged =
        source.length !== remaining.length ||
        remaining.some((value, index) => value !== source[index]);
      blockChanged ||= rowChanged;
      output.push([y, rowChanged ? remaining : source]);
    }
    const replacement = blockChanged
      ? buildCoverage(
          coverage.width,
          coverage.height,
          coverage.cellSizeX,
          coverage.cellSizeY,
          output,
        ).blocks
      : [block];
    for (const next of replacement) {
      bytes += blockBytes(next);
      assertBudget(bytes);
      blocks.push(next);
    }
    changed ||= blockChanged;
  }
  return changed
    ? Object.freeze({
        ...ink,
        coverage: Object.freeze({ ...coverage, blocks: Object.freeze(blocks) }),
      })
    : ink;
}
