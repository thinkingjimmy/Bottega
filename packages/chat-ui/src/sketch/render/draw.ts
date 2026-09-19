/**
 * [INPUT]: Depends on shared primitive paths, compact ink rows, text layout, and positive transforms.
 * [OUTPUT]: Provides one element/document drawing path for the editor, eyedropper, and PNG export.
 * [POS]: Layer-order compositing boundary; controls and white eraser strokes are never source content.
 */
import type { SketchDocument, SketchElement } from "../model/document";
import { primitivePaths } from "../model/geometry/primitives";
import { rows } from "../model/ink/coverage";
import { drawText } from "./text";
export function drawElement(
  ctx: CanvasRenderingContext2D,
  element: SketchElement,
) {
  ctx.save();
  const t = element.transform;
  ctx.translate(t.x, t.y);
  ctx.scale(t.scaleX, t.scaleY);
  ctx.fillStyle = ctx.strokeStyle = element.color;
  if (element.kind === "text") drawText(ctx, element);
  else if (element.kind === "ink") {
    ctx.beginPath();
    const c = element.coverage;
    for (const [y, spans] of rows(c))
      for (let i = 0; i < spans.length; i += 2)
        ctx.rect(
          spans[i] * c.cellSizeX,
          y * c.cellSizeY,
          (spans[i + 1] - spans[i]) * c.cellSizeX,
          c.cellSizeY,
        );
    ctx.fill();
  } else {
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = element.strokeWidth;
    for (const path of primitivePaths(element)) {
      if (!path.length) continue;
      ctx.beginPath();
      if (path.length === 1) {
        ctx.arc(path[0].x, path[0].y, element.strokeWidth / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y);
        ctx.stroke();
      }
    }
  }
  ctx.restore();
}
export function drawDocument(
  ctx: CanvasRenderingContext2D,
  document: SketchDocument,
  options: { background?: boolean; skipTextId?: string } = {},
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, document.width, document.height);
  ctx.clip();
  if (options.background !== false) {
    ctx.fillStyle = document.background;
    ctx.fillRect(0, 0, document.width, document.height);
  }
  for (const element of document.elements)
    if (element.id !== options.skipTextId) drawElement(ctx, element);
  ctx.restore();
}
