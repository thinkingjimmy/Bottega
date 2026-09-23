/**
 * [INPUT]: Browser createImageBitmap (EXIF orientation from the image) and OffscreenCanvas, with a DOM canvas fallback.
 * [OUTPUT]: canvasImageCodec — the default ImageCodec; decodes HEIC only where the browser can and otherwise reports attachment-format.
 * [POS]: The only DOM-bound step of the image pipeline; tests inject their own codec.
 */
import type { ImageCodec } from "./pipeline";
export const canvasImageCodec: ImageCodec = {
  async transcode(source, { mime, maxEdge, quality, maxPixels }, signal) {
    let bitmap: ImageBitmap;
    try { bitmap = await createImageBitmap(source, { imageOrientation: "from-image" }); }
    catch { throw new Error("attachment-format"); }
    try {
      signal.throwIfAborted();
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > maxPixels) throw new Error("attachment-dimensions");
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
      const offscreen = typeof OffscreenCanvas === "function" ? new OffscreenCanvas(width, height) : null;
      const canvas = offscreen ?? Object.assign(document.createElement("canvas"), { width, height });
      const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) throw new Error("attachment-format");
      // JPEG has no alpha: transparent pixels would otherwise turn black.
      if (mime === "image/jpeg") { context.fillStyle = "#fff"; context.fillRect(0, 0, width, height); }
      context.imageSmoothingQuality = "high"; context.drawImage(bitmap, 0, 0, width, height);
      const blob = offscreen ? await offscreen.convertToBlob({ type: mime, quality })
        : await new Promise<Blob | null>(resolve => (canvas as HTMLCanvasElement).toBlob(resolve, mime, quality));
      signal.throwIfAborted();
      // A browser without this encoder silently falls back to PNG; that would break the fixed type.
      if (!blob || blob.type !== mime) throw new Error("attachment-format");
      return blob;
    } finally { bitmap.close(); }
  },
};
