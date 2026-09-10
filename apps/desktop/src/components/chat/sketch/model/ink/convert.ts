/**
 * [INPUT]: Depends on shared primitive paths/capsule slices, compact RLE builders, and byte guards.
 * [OUTPUT]: Provides deterministic world-grid conversion and lossless anisotropic refinement.
 * [POS]: Worker geometry lane; never reads canvas pixels or changes a published source buffer.
 */
import type { InkElement } from "../document";
import { assertBudget, assertIndex, SOURCE_BYTES, TEMP_BYTES } from "../budget";
import {
  capsuleSlice,
  pathBounds,
  primitivePaths,
  type Primitive,
} from "../geometry/primitives";
import { mapBounds, type Point } from "../geometry/transform";
import {
  BASE_PRECISION,
  ERASE_PRECISION,
  buildCoverage,
  counts,
  mergeSpans,
  occupiedSpan,
  rows,
  type CoverageRow,
  type InkCoverage,
} from "./coverage";

export function primitiveCoverage(element: Primitive): InkElement | null {
  const paths = primitivePaths(element),
    radius = element.strokeWidth / 2,
    t = element.transform;
  const bounds = mapBounds(pathBounds(paths, radius), t);
  const x = Math.floor(Math.max(0, bounds.x) / BASE_PRECISION) * BASE_PRECISION;
  const y = Math.floor(Math.max(0, bounds.y) / BASE_PRECISION) * BASE_PRECISION;
  const width = Math.ceil(
    (Math.min(1600, bounds.x + bounds.width) - x) / BASE_PRECISION,
  );
  const height = Math.ceil(
    (Math.min(1600, bounds.y + bounds.height) - y) / BASE_PRECISION,
  );
  if (width <= 0 || height <= 0) return null;
  assertIndex(width);
  assertIndex(height);
  const segments: { a: Point; b: Point; minY: number; maxY: number }[] = [];
  for (const path of paths)
    for (let i = 0; i < Math.max(1, path.length - 1); i++) {
      const a = path[i],
        b = path[i + 1] ?? a;
      if (!a) continue;
      assertBudget((segments.length + 1) * 128, TEMP_BYTES / 4);
      segments.push({
        a,
        b,
        minY: (Math.min(a.y, b.y) - radius) * t.scaleY + t.y,
        maxY: (Math.max(a.y, b.y) + radius) * t.scaleY + t.y,
      });
    }
  segments.sort((a, b) => a.minY - b.minY);
  function* scan(): Generator<CoverageRow> {
    let cursor = 0,
      active: typeof segments = [];
    for (let row = 0; row < height; row++) {
      const worldY = y + (row + 0.5) * BASE_PRECISION;
      while (cursor < segments.length && segments[cursor].minY <= worldY)
        active.push(segments[cursor++]);
      active = active.filter((segment) => segment.maxY >= worldY);
      const ranges: [number, number][] = [];
      for (const segment of active) {
        const slice = capsuleSlice(
          segment.a,
          segment.b,
          radius,
          (worldY - t.y) / t.scaleY,
        );
        if (!slice) continue;
        const span = occupiedSpan(
          slice[0] * t.scaleX + t.x,
          slice[1] * t.scaleX + t.x,
          x,
          BASE_PRECISION,
          width,
        );
        if (span) ranges.push(span);
      }
      if (ranges.length) yield [row, mergeSpans(ranges)];
    }
  }
  const coverage = buildCoverage(
    width,
    height,
    BASE_PRECISION,
    BASE_PRECISION,
    scan(),
  );
  if (!coverage.blocks.length) return null;
  return Object.freeze({
    id: element.id,
    kind: "ink",
    color: element.color,
    transform: Object.freeze({ x, y, scaleX: 1, scaleY: 1 }),
    resizeMode: element.kind === "shape" ? "free" : "none",
    coverage,
  });
}

export function refinementCost(
  coverage: InkCoverage,
  scaleX: number,
  scaleY: number,
) {
  const fX = Math.max(
    1,
    Math.ceil((coverage.cellSizeX * scaleX) / ERASE_PRECISION),
  );
  const fY = Math.max(
    1,
    Math.ceil((coverage.cellSizeY * scaleY) / ERASE_PRECISION),
  );
  assertIndex(coverage.width * fX);
  assertIndex(coverage.height * fY);
  const n = counts(coverage),
    rowCount = n.rows * fY,
    spanCount = n.spans * fY;
  assertIndex(rowCount);
  assertIndex(spanCount);
  const bytes =
    rowCount * 12 +
    spanCount * 8 +
    Math.ceil((coverage.height * fY) / 64) * 108 +
    64;
  assertBudget(bytes, SOURCE_BYTES);
  return { fX, fY, bytes, rows: rowCount, spans: spanCount };
}
export function refineCoverage(ink: InkElement): InkElement {
  const c = ink.coverage,
    cost = refinementCost(c, ink.transform.scaleX, ink.transform.scaleY);
  if (cost.fX === 1 && cost.fY === 1) return ink;
  function* expanded(): Generator<CoverageRow> {
    for (const [y, spans] of rows(c)) {
      const values = Int32Array.from(spans, (n) => n * cost.fX);
      for (let i = 0; i < cost.fY; i++) yield [y * cost.fY + i, values];
    }
  }
  const coverage = buildCoverage(
    c.width * cost.fX,
    c.height * cost.fY,
    c.cellSizeX / cost.fX,
    c.cellSizeY / cost.fY,
    expanded(),
  );
  return Object.freeze({ ...ink, coverage });
}
