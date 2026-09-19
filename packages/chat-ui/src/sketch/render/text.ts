/**
 * [INPUT]: Depends on native text layout, Canvas glyph rendering, structured text elements, and world geometry.
 * [OUTPUT]: Provides shared native wrapping, positioned text drawing, and bounded glyph-based selection/erasure.
 * [POS]: Common glyph renderer for the editor, hit testing, and PNG; native text-layout owns all positions.
 */
import type { TextElement } from "../model/document";
import { distanceToSegment } from "../model/geometry/flatten";
import {
  mapBounds,
  type Point,
} from "../model/geometry/transform";
import type { TextMetricsPort } from "../model/erasure/hit-test";
import { layoutText, SKETCH_FONT } from "./text-layout";
export { layoutText, SKETCH_FONT } from "./text-layout";
export function drawText(ctx: CanvasRenderingContext2D, element: TextElement) {
  const layout = layoutText(element);
  ctx.font = element.fontSize + "px " + SKETCH_FONT;
  ctx.fontKerning = "normal";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = element.color;
  const metrics = ctx.measureText("Mg"),
    ascent = metrics.fontBoundingBoxAscent,
    descent = metrics.fontBoundingBoxDescent;
  const baseline =
    (element.fontSize * element.lineHeight - ascent - descent) / 2 + ascent;
  for (const line of layout.lines)
    for (const run of line.runs)
      ctx.fillText(run.text, run.x, baseline + line.y);
}
export function textWithinCanvas(element: TextElement) {
  const b = mapBounds(layoutText(element).bounds, element.transform);
  return (
    b.x >= 0 &&
    b.y >= 0 &&
    b.x + b.width <= 1600 + 1e-6 &&
    b.y + b.height <= 1600 + 1e-6
  );
}
/** Only a sweep-bounded 32-row tile is allocated, never one full canvas per text element. */
export function glyphSweepHit(
  element: TextElement,
  points: readonly Point[],
  radius: number,
) {
  const b = mapBounds(layoutText(element).bounds, element.transform);
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const left = Math.floor(Math.max(0, b.x, minX - radius)),
    right = Math.ceil(Math.min(1600, b.x + b.width, maxX + radius));
  const top = Math.floor(Math.max(0, b.y, minY - radius)),
    bottom = Math.ceil(Math.min(1600, b.y + b.height, maxY + radius));
  if (right <= left || bottom <= top) return false;
  const tile = document.createElement("canvas");
  tile.width = right - left;
  tile.height = Math.min(32, bottom - top);
  const ctx = tile.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("SKETCH_EXPORT_FAILED");
  try {
    for (let y = top; y < bottom; y += tile.height) {
      ctx.clearRect(0, 0, tile.width, tile.height);
      ctx.save();
      ctx.translate(element.transform.x - left, element.transform.y - y);
      ctx.scale(element.transform.scaleX, element.transform.scaleY);
      drawText(ctx, element);
      ctx.restore();
      const pixels = ctx.getImageData(
        0,
        0,
        tile.width,
        Math.min(tile.height, bottom - y),
      );
      for (let i = 3; i < pixels.data.length; i += 4) {
        if (!pixels.data[i]) continue;
        const p = {
          x: left + (((i - 3) / 4) % pixels.width) + 0.5,
          y: y + Math.floor((i - 3) / 4 / pixels.width) + 0.5,
        };
        for (let j = 0; j < Math.max(1, points.length - 1); j++)
          if (
            distanceToSegment(p, points[j], points[j + 1] ?? points[j]) <=
            radius + 0.5
          )
            return true;
      }
    }
    return false;
  } finally {
    tile.width = tile.height = 0;
  }
}
export const textMetricsPort: TextMetricsPort = {
  bounds: (element) => layoutText(element).bounds,
  hit: (element, point, tolerance) =>
    glyphSweepHit(element, [point], Math.max(0.5, tolerance)),
};
