/**
 * [INPUT]: Depends on primitive paths, transformed stroke outlines, coverage rows, and injected glyph metrics.
 * [OUTPUT]: Provides visible element bounds, topmost hit testing, and per-segment sweep broad phase.
 * [POS]: Main-thread lightweight selection/sweep filter; geometry conversion remains in the worker.
 */
import type { SketchElement, TextElement } from "../document";
import { hitTransformedStroke } from "../geometry/stroke-hit";
import { primitivePaths, pathBounds } from "../geometry/primitives";
import {
  contains,
  localPoint,
  mapBounds,
  type Bounds,
  type Point,
} from "../geometry/transform";
import { rows } from "../ink/coverage";
export type TextMetricsPort = {
  bounds(element: TextElement): Bounds;
  hit(element: TextElement, point: Point, tolerance: number): boolean;
};
export function elementBounds(
  element: SketchElement,
  text?: TextMetricsPort,
): Bounds {
  const local =
    element.kind === "ink"
      ? {
          x: 0,
          y: 0,
          width: element.coverage.width * element.coverage.cellSizeX,
          height: element.coverage.height * element.coverage.cellSizeY,
        }
      : element.kind === "text"
        ? (text?.bounds(element) ?? {
            x: 0,
            y: 0,
            width: element.boxWidth,
            height:
              element.fontSize *
              element.lineHeight *
              element.text.split("\n").length,
          })
        : pathBounds(primitivePaths(element), element.strokeWidth / 2);
  return mapBounds(local, element.transform);
}
export function hitElement(
  element: SketchElement,
  point: Point,
  tolerance: number,
  text?: TextMetricsPort,
): boolean {
  if (!contains(elementBounds(element, text), point, tolerance)) return false;
  if (element.kind === "text")
    return text?.hit(element, point, tolerance) ?? false;
  const p = localPoint(point, element.transform),
    t = element.transform;
  if (element.kind === "ink") {
    const c = element.coverage,
      ty = tolerance / t.scaleY;
    for (const [y, spans] of rows(c)) {
      if (p.y + ty < y * c.cellSizeY) break;
      if (p.y - ty > (y + 1) * c.cellSizeY) continue;
      for (let i = 0; i < spans.length; i += 2) {
        const x = spans[i] * c.cellSizeX,
          right = spans[i + 1] * c.cellSizeX;
        const dx = Math.max(x - p.x, 0, p.x - right) * t.scaleX;
        const dy =
          Math.max(y * c.cellSizeY - p.y, 0, p.y - (y + 1) * c.cellSizeY) *
          t.scaleY;
        if (Math.hypot(dx, dy) <= tolerance) return true;
      }
    }
    return false;
  }
  // World-space tolerance follows the scaled outline, including elliptical round caps.
  const radius = element.strokeWidth / 2;
  for (const path of primitivePaths(element))
    for (let i = 0; i < Math.max(1, path.length - 1); i++) {
      if (
        hitTransformedStroke(point, path[i], path[i + 1] ?? path[i], radius, t, tolerance)
      )
        return true;
    }
  return false;
}
export function topmostElement(
  elements: readonly SketchElement[],
  point: Point,
  tolerance: number,
  text?: TextMetricsPort,
) {
  return [...elements]
    .reverse()
    .find((element) => hitElement(element, point, tolerance, text));
}
export function sweepIntersectsBounds(
  points: readonly Point[],
  radius: number,
  bounds: Bounds,
): boolean {
  const b = {
    x: bounds.x - radius,
    y: bounds.y - radius,
    width: bounds.width + radius * 2,
    height: bounds.height + radius * 2,
  };
  for (let i = 0; i < Math.max(1, points.length - 1); i++) {
    const a = points[i],
      z = points[i + 1] ?? a;
    let lo = 0,
      hi = 1;
    const dx = z.x - a.x,
      dy = z.y - a.y;
    const tests = [
      [-dx, a.x - b.x],
      [dx, b.x + b.width - a.x],
      [-dy, a.y - b.y],
      [dy, b.y + b.height - a.y],
    ];
    let hit = true;
    for (const [p, q] of tests) {
      if (p === 0) {
        if (q < 0) hit = false;
        continue;
      }
      const u = q / p;
      if (p < 0) lo = Math.max(lo, u);
      else hi = Math.min(hi, u);
    }
    if (hit && lo <= hi) return true;
  }
  return false;
}
