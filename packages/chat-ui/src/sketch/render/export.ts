/**
 * [INPUT]: Depends on font readiness and the common source-document draw function.
 * [OUTPUT]: Provides fixed 1600-square opaque PNG Files and UI-free canvas color sampling.
 * [POS]: Renderer image boundary; encoding never writes the composer or changes source versions.
 */
import { validateDocument, type SketchDocument } from "../model/document";
import { drawDocument } from "./draw";
export async function exportPng(source: SketchDocument): Promise<File> {
  validateDocument(source);
  await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1600;
  try {
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("SKETCH_EXPORT_FAILED");
    drawDocument(ctx, source);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value ? resolve(value) : reject(new Error("SKETCH_EXPORT_FAILED")),
        "image/png",
      ),
    );
    if (blob.size > 8 * 1024 ** 2) throw new Error("SKETCH_IMAGE_TOO_LARGE");
    return new File([blob], "sketch-" + Date.now() + ".png", {
      type: "image/png",
    });
  } finally {
    canvas.width = canvas.height = 0;
  }
}
export function sampleColor(
  source: SketchDocument,
  x: number,
  y: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("SKETCH_EXPORT_FAILED");
  ctx.translate(
    -Math.max(0, Math.min(1599, Math.floor(x))),
    -Math.max(0, Math.min(1599, Math.floor(y))),
  );
  drawDocument(ctx, source);
  const bytes = ctx.getImageData(0, 0, 1, 1).data;
  const color =
    "#" +
    [...bytes.slice(0, 3)]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
  canvas.width = canvas.height = 0;
  return color;
}
