/**
 * [INPUT]: Depends on stroke/shape contracts, positive transforms, and bounded curve flattening.
 * [OUTPUT]: Provides common primitive paths, bounds, shape creation, and analytic capsule intersections.
 * [POS]: Sole shape formula authority for display, hit testing, coverage, and PNG.
 */
import type { ShapeElement, ShapeType, StrokeElement } from "../document";
import { flattenCubic, flattenEllipse } from "./flatten";
import { type Bounds, type Point } from "./transform";
export type Primitive = StrokeElement | ShapeElement;
export type Path = readonly Point[];
export function primitivePaths(element: Primitive): readonly Path[] {
  if (element.kind === "stroke") {
    return [
      Array.from({ length: element.points.length / 2 }, (_, i) => ({
        x: element.points[i * 2],
        y: element.points[i * 2 + 1],
      })),
    ];
  }
  const { start: a, end: b, shapeType, strokeWidth, transform } = element;
  const x = Math.min(a.x, b.x),
    y = Math.min(a.y, b.y),
    w = Math.abs(b.x - a.x),
    h = Math.abs(b.y - a.y);
  const p = (u: number, v: number): Point => ({ x: x + u * w, y: y + v * h });
  const close = (points: Point[]) => [[...points, points[0]]];
  const scale = Math.max(transform.scaleX, transform.scaleY);
  switch (shapeType) {
    case "line":
      return [[a, b]];
    case "arrow": {
      const angle = Math.atan2(b.y - a.y, b.x - a.x),
        length = Math.min(
          Math.hypot(b.x - a.x, b.y - a.y) * 0.45,
          Math.max(24, strokeWidth * 4),
        );
      return [
        [a, b],
        [
          {
            x: b.x - length * Math.cos(angle - Math.PI / 6),
            y: b.y - length * Math.sin(angle - Math.PI / 6),
          },
          b,
          {
            x: b.x - length * Math.cos(angle + Math.PI / 6),
            y: b.y - length * Math.sin(angle + Math.PI / 6),
          },
        ],
      ];
    }
    case "rectangle":
      return close([p(0, 0), p(1, 0), p(1, 1), p(0, 1)]);
    case "circle":
      return [flattenEllipse(x + w / 2, y + h / 2, w / 2, h / 2, scale)];
    case "triangle":
      return close([p(0.5, 0), p(1, 1), p(0, 1)]);
    case "diamond":
      return close([p(0.5, 0), p(1, 0.5), p(0.5, 1), p(0, 0.5)]);
    case "star":
      return close(
        Array.from({ length: 10 }, (_, i) => {
          const angle = -Math.PI / 2 + (i * Math.PI) / 5,
            r = i % 2 ? 0.21 : 0.5;
          return p(0.5 + r * Math.cos(angle), 0.5 + r * Math.sin(angle));
        }),
      );
    case "heart": {
      const curves = [
        [p(0.5, 0.22), p(0.18, -0.18), p(-0.3, 0.22), p(0.25, 0.72)],
        [p(0.25, 0.72), p(0.35, 0.82), p(0.45, 0.94), p(0.5, 1)],
        [p(0.5, 1), p(0.55, 0.94), p(0.65, 0.82), p(0.75, 0.72)],
        [p(0.75, 0.72), p(1.3, 0.22), p(0.82, -0.18), p(0.5, 0.22)],
      ];
      return [
        curves.flatMap(([a0, b0, c0, d0], i) =>
          flattenCubic(a0, b0, c0, d0, scale).slice(i ? 1 : 0),
        ),
      ];
    }
  }
}
export function pathBounds(paths: readonly Path[], radius = 0): Bounds {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const path of paths)
    for (const p of path) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  return {
    x: minX - radius,
    y: minY - radius,
    width: maxX - minX + radius * 2,
    height: maxY - minY + radius * 2,
  };
}
export function shapeEnd(
  type: ShapeType,
  start: Point,
  end: Point,
  shift: boolean,
): Point {
  const dx = end.x - start.x,
    dy = end.y - start.y;
  if (type === "line" || type === "arrow") {
    if (!shift) return end;
    const angle =
        (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4,
      length = Math.hypot(dx, dy);
    return {
      x: start.x + Math.cos(angle) * length,
      y: start.y + Math.sin(angle) * length,
    };
  }
  if (!shift && type !== "circle" && type !== "star") return end;
  const size = Math.min(Math.abs(dx), Math.abs(dy));
  return {
    x: start.x + Math.sign(dx) * size,
    y: start.y + Math.sign(dy) * size,
  };
}

/** Horizontal intersection of a round-capped segment: endpoint disks plus its offset rectangle. */
export function capsuleSlice(
  a: Point,
  b: Point,
  radius: number,
  y: number,
): [number, number] | null {
  let lo = Infinity,
    hi = -Infinity;
  for (const p of [a, b]) {
    const dy = y - p.y;
    if (Math.abs(dy) <= radius) {
      const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      lo = Math.min(lo, p.x - dx);
      hi = Math.max(hi, p.x + dx);
    }
  }
  const dx = b.x - a.x,
    dy = b.y - a.y,
    length = Math.hypot(dx, dy);
  if (length) {
    const nx = (-dy * radius) / length,
      ny = (dx * radius) / length;
    const vertices = [
      { x: a.x + nx, y: a.y + ny },
      { x: b.x + nx, y: b.y + ny },
      { x: b.x - nx, y: b.y - ny },
      { x: a.x - nx, y: a.y - ny },
    ];
    for (let i = 0; i < 4; i++) {
      const p = vertices[i],
        q = vertices[(i + 1) % 4];
      if (y < Math.min(p.y, q.y) || y > Math.max(p.y, q.y)) continue;
      if (p.y === q.y) {
        lo = Math.min(lo, p.x, q.x);
        hi = Math.max(hi, p.x, q.x);
      } else {
        const x = p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y);
        lo = Math.min(lo, x);
        hi = Math.max(hi, x);
      }
    }
  }
  return lo <= hi ? [lo, hi] : null;
}
