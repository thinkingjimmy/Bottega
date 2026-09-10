/**
 * [INPUT]: Depends on positive axis transforms and Euclidean point-to-segment distance.
 * [OUTPUT]: Provides world-space tolerance around the actual transformed round stroke outline.
 * [POS]: Analytic selection geometry; unequal scaling produces straight sides and elliptical round caps.
 */
import { distanceToSegment } from "./flatten";
import { localPoint, type Point, type Transform } from "./transform";

function nearEllipse(point: Point, center: Point, rx: number, ry: number, tolerance: number) {
  const x = Math.abs(point.x - center.x), y = Math.abs(point.y - center.y);
  if (x > rx + tolerance || y > ry + tolerance) return false;
  if ((x / rx) ** 2 + (y / ry) ** 2 <= 1) return true;
  const rx2 = rx * rx, ry2 = ry * ry;
  let low = 0, high = Math.hypot(rx * x, ry * y);
  // The closest ellipse point satisfies a monotone Lagrange-multiplier equation outside its boundary.
  for (let i = 0; i < 56; i++) {
    const lambda = (low + high) / 2;
    const norm = (rx * x / (lambda + rx2)) ** 2 + (ry * y / (lambda + ry2)) ** 2;
    if (norm > 1) low = lambda;
    else high = lambda;
  }
  const lambda = (low + high) / 2;
  return Math.hypot(x - rx2 * x / (lambda + rx2), y - ry2 * y / (lambda + ry2)) <= tolerance;
}

export function hitTransformedStroke(
  point: Point, a: Point, b: Point, radius: number, transform: Transform, tolerance: number,
): boolean {
  const { x, y, scaleX, scaleY } = transform;
  const start = { x: a.x * scaleX + x, y: a.y * scaleY + y };
  const end = { x: b.x * scaleX + x, y: b.y * scaleY + y };
  if (scaleX === scaleY)
    return distanceToSegment(point, start, end) <= radius * scaleX + tolerance;
  const rx = radius * scaleX, ry = radius * scaleY;
  if (
    point.x < Math.min(start.x, end.x) - rx - tolerance ||
    point.x > Math.max(start.x, end.x) + rx + tolerance ||
    point.y < Math.min(start.y, end.y) - ry - tolerance ||
    point.y > Math.max(start.y, end.y) + ry + tolerance
  ) return false;
  if (distanceToSegment(localPoint(point, transform), a, b) <= radius) return true;
  if (tolerance === 0) return false;
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  if (length) {
    const nx = -dy * radius * scaleX / length, ny = dx * radius * scaleY / length;
    for (const sign of [-1, 1]) {
      if (distanceToSegment(point,
        { x: start.x + sign * nx, y: start.y + sign * ny },
        { x: end.x + sign * nx, y: end.y + sign * ny },
      ) <= tolerance) return true;
    }
  }
  return nearEllipse(point, start, rx, ry, tolerance) || nearEllipse(point, end, rx, ry, tolerance);
}
