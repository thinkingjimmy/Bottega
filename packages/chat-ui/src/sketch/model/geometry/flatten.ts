/**
 * [INPUT]: Depends on geometry points and positive world scale.
 * [OUTPUT]: Provides bounded cubic and ellipse polylines with 1/64 world-pixel error.
 * [POS]: Shared curve subdivision used by primitive rendering and analytic coverage.
 */
import type { Point } from "./transform";
export const CURVE_TOLERANCE = 1 / 64;
const MAX_POINTS = 65536;
const midpoint = (a: Point, b: Point): Point => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
});
export function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const u = length
    ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
}
export function flattenCubic(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  worldScale: number,
): Point[] {
  const result: Point[] = [a];
  const visit = (p: Point, q: Point, r: Point, s: Point, depth: number) => {
    if (
      Math.max(distanceToSegment(q, p, s), distanceToSegment(r, p, s)) *
        worldScale <=
      CURVE_TOLERANCE
    ) {
      if (result.length >= MAX_POINTS) throw new Error("SKETCH_BUDGET");
      result.push(s);
      return;
    }
    if (depth >= 24) throw new Error("SKETCH_BUDGET");
    const pq = midpoint(p, q),
      qr = midpoint(q, r),
      rs = midpoint(r, s);
    const pqr = midpoint(pq, qr),
      qrs = midpoint(qr, rs),
      m = midpoint(pqr, qrs);
    visit(p, pq, pqr, m, depth + 1);
    visit(m, qrs, rs, s, depth + 1);
  };
  visit(a, b, c, d, 0);
  return result;
}
export function flattenEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  worldScale: number,
): Point[] {
  const radius = Math.max(rx, ry) * worldScale;
  const count = Math.max(
    8,
    Math.ceil(
      Math.PI /
        Math.acos(
          Math.max(-1, 1 - CURVE_TOLERANCE / Math.max(radius, CURVE_TOLERANCE)),
        ),
    ),
  );
  if (!Number.isFinite(count) || count > MAX_POINTS)
    throw new Error("SKETCH_BUDGET");
  return Array.from({ length: count + 1 }, (_, i) => ({
    x: cx + rx * Math.cos((i * Math.PI * 2) / count),
    y: cy + ry * Math.sin((i * Math.PI * 2) / count),
  }));
}
