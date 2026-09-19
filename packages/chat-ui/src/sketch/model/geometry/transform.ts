/**
 * [INPUT]: Depends on finite world-space points and positive axis-aligned transforms.
 * [OUTPUT]: Provides coordinate mapping, bounds, translation, and anchored resize constraints.
 * [POS]: Shared geometry foundation; independent of element kinds and rendering.
 */

export type Point = Readonly<{ x: number; y: number }>;
export type Transform = Readonly<{
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
}>;
export type Bounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
export const HANDLES: readonly Handle[] = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
];
export const CORNERS: readonly Handle[] = ["nw", "ne", "se", "sw"];
export const identityTransform = (): Transform => ({
  x: 0,
  y: 0,
  scaleX: 1,
  scaleY: 1,
});
export const worldPoint = (p: Point, t: Transform): Point => ({
  x: p.x * t.scaleX + t.x,
  y: p.y * t.scaleY + t.y,
});
export const localPoint = (p: Point, t: Transform): Point => ({
  x: (p.x - t.x) / t.scaleX,
  y: (p.y - t.y) / t.scaleY,
});
export const mapBounds = (b: Bounds, t: Transform): Bounds => ({
  ...worldPoint(b, t),
  width: b.width * t.scaleX,
  height: b.height * t.scaleY,
});
export const contains = (b: Bounds, p: Point, pad = 0) =>
  p.x >= b.x - pad &&
  p.y >= b.y - pad &&
  p.x <= b.x + b.width + pad &&
  p.y <= b.y + b.height + pad;
export const intersects = (a: Bounds, b: Bounds) =>
  a.x <= b.x + b.width &&
  a.x + a.width >= b.x &&
  a.y <= b.y + b.height &&
  a.y + a.height >= b.y;
export const finitePoint = (p: Point) =>
  Number.isFinite(p.x) && Number.isFinite(p.y);
export const clamp = (value: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, value));

export function moveTransform(
  t: Transform,
  bounds: Bounds,
  dx: number,
  dy: number,
  side = 1600,
): Transform {
  // Existing clipped edges remain stable; a gesture never snaps them into the page.
  const x = clamp(
    dx,
    Math.min(0, -bounds.x),
    Math.max(0, side - bounds.x - bounds.width),
  );
  const y = clamp(
    dy,
    Math.min(0, -bounds.y),
    Math.max(0, side - bounds.y - bounds.height),
  );
  return { ...t, x: t.x + x, y: t.y + y };
}

export function resizeTransform(
  t: Transform,
  b: Bounds,
  handle: Handle,
  delta: Point,
  proportional: boolean,
  fontSize?: number,
): Transform {
  const horizontal = handle.includes("w") || handle.includes("e");
  const vertical = handle.includes("n") || handle.includes("s");
  const sx = handle.includes("w") ? -1 : 1;
  const sy = handle.includes("n") ? -1 : 1;
  const anchorX = handle.includes("w") ? b.x + b.width : b.x;
  const anchorY = handle.includes("n") ? b.y + b.height : b.y;
  let rx = horizontal
    ? Math.max(Math.min(8, b.width), b.width + delta.x * sx) / b.width
    : 1;
  let ry = vertical
    ? Math.max(Math.min(8, b.height), b.height + delta.y * sy) / b.height
    : 1;
  if (proportional && horizontal && vertical) {
    const ratio = Math.abs(rx - 1) >= Math.abs(ry - 1) ? rx : ry;
    const min = fontSize
      ? Math.max(
          8 / (fontSize * t.scaleX),
          Math.min(8, Math.max(b.width, b.height)) /
            Math.max(b.width, b.height),
        )
      : Math.max(
          Math.min(8, b.width) / b.width,
          Math.min(8, b.height) / b.height,
        );
    rx = ry = clamp(
      ratio,
      min,
      fontSize ? 512 / (fontSize * t.scaleX) : Infinity,
    );
  }
  const maxX = horizontal
    ? (sx < 0
        ? anchorX - Math.min(0, b.x)
        : Math.max(1600, b.x + b.width) - anchorX) / b.width
    : 1;
  const maxY = vertical
    ? (sy < 0
        ? anchorY - Math.min(0, b.y)
        : Math.max(1600, b.y + b.height) - anchorY) / b.height
    : 1;
  if (proportional && horizontal && vertical)
    rx = ry = Math.min(rx, maxX, maxY);
  else {
    rx = Math.min(rx, maxX);
    ry = Math.min(ry, maxY);
  }
  return {
    x: anchorX + (t.x - anchorX) * rx,
    y: anchorY + (t.y - anchorY) * ry,
    scaleX: t.scaleX * rx,
    scaleY: t.scaleY * ry,
  };
}
