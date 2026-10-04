/**
 * [INPUT]: Depends on ./bytes for real formats and metadata stripping, @ai-chat/shell-bridge/contract SHELL_LIMITS for the source limits shared with the Android HEIC entry, and an injected ImageCodec.
 * [OUTPUT]: IMAGE_INPUT limits, isImageSource, admitImageSource, processImage (one fixed, metadata-free File) and admitProcessedImage.
 * [POS]: Shared image input algorithm for remote Chat drafts and Cloud Web Base uploads; each caller keeps its own owner, upload contract and size policy.
 */
import { SHELL_LIMITS } from "@ai-chat/shell-bridge/contract";
import { hasImageMagic, IMAGE_MIME, sniffImage, stripGif, stripJpeg, stripPng, stripWebp, type ImageFormat } from "./bytes";
export const IMAGE_INPUT = Object.freeze({ sourceBytes: SHELL_LIMITS.imageSourceMaxBytes, sourcePixels: SHELL_LIMITS.imageSourceMaxPixels,
  maxEdge: SHELL_LIMITS.imageOutputMaxEdge, jpegQuality: 0.85 });
export const SENDABLE_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"] as const;
export type ImageOutput = { mime: "image/jpeg" | "image/png"; maxEdge: number; quality: number; maxPixels: number };
/** Decodes with EXIF orientation applied and re-encodes within maxEdge; nothing but pixels survives. Throws attachment-format when it cannot decode. */
export interface ImageCodec { transcode(source: Blob, output: ImageOutput, signal: AbortSignal): Promise<Blob> }
const SOURCE_EXTENSIONS = /\.(heic|heif|avif|jpe?g|png|gif|webp)$/i;
/** A picked file enters the image path by its claimed type or, when the browser gives none (HEIC on many desktops), by its extension. */
export const isImageSource = (file: Pick<File, "type" | "name">) => file.type.startsWith("image/") || !file.type && SOURCE_EXTENSIONS.test(file.name);
export function assertFileName(name: string) {
  if (!name || new TextEncoder().encode(name).length > 255 || /[\p{Cc}/\\]/u.test(name)) throw new Error("attachment-name");
}
/** Source admission: cheap checks that reserve a draft slot before any decode. */
export function admitImageSource(file: Pick<File, "size" | "name">) {
  if (!file.size || file.size > IMAGE_INPUT.sourceBytes) throw new Error("attachment-size");
  assertFileName(file.name);
}
const EXTENSION: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };
export function renamed(name: string, mime: string) {
  const extension = EXTENSION[mime]!, stem = name.replace(/\.[^./\\]{1,8}$/, "") || "image";
  return `${stem}.${extension}`;
}
const fits = (width: number | null, height: number | null) => width !== null && height !== null && Math.max(width, height) <= IMAGE_INPUT.maxEdge;
/**
 * Produces the one File every later step uses: thumbnail, name, type, size, hash, upload and retry.
 * Photos (JPEG/HEIF/AVIF) become JPEG within 2048 px unless an upright JPEG already fits, which only loses its metadata;
 * PNG and WebP keep their format and are resized only past the byte limit (a rotated one is redrawn upright first); GIF is stripped byte-wise so every frame survives.
 * Every size comes from headers (HEIF/AVIF included) and is checked before any decode.
 */
export async function processImage(file: Blob & { name: string }, codec: ImageCodec, signal: AbortSignal, byteLimit: number): Promise<File> {
  signal.throwIfAborted();
  if (!file.size || file.size > IMAGE_INPUT.sourceBytes) throw new Error("attachment-size");
  const bytes = new Uint8Array(await file.arrayBuffer()); signal.throwIfAborted();
  const sniff = sniffImage(bytes); if (!sniff) throw new Error("attachment-format");
  // A size that headers cannot give is refused, never discovered by decoding the whole image.
  if (!sniff.width || !sniff.height || sniff.width * sniff.height > IMAGE_INPUT.sourcePixels) throw new Error("attachment-dimensions");
  const output = (value: Uint8Array | Blob, mime: string) => {
    const result = new File([value as Blob | Uint8Array<ArrayBuffer>], renamed(file.name, mime), { type: mime });
    if (result.size > byteLimit) throw new Error("attachment-size");
    return result;
  };
  const transcode = async (mime: ImageOutput["mime"], maxEdge: number = IMAGE_INPUT.maxEdge) => output(await codec.transcode(new Blob([bytes], { type: IMAGE_MIME[sniff.format] }),
    { mime, maxEdge, quality: IMAGE_INPUT.jpegQuality, maxPixels: IMAGE_INPUT.sourcePixels }, signal), mime);
  const strip: Partial<Record<ImageFormat, (value: Uint8Array, orientation: number) => Uint8Array>> = { png: stripPng, webp: stripWebp, gif: stripGif };
  let result: File;
  switch (sniff.format) {
    case "jpeg":
      result = sniff.orientation === 1 && fits(sniff.width, sniff.height) && bytes.length <= byteLimit ? output(stripJpeg(bytes), "image/jpeg") : await transcode("image/jpeg");
      break;
    case "gif": result = output(stripGif(bytes), "image/gif"); break;
    case "png": case "webp": {
      const mime = sniff.format === "png" || sniff.alpha ? "image/png" : "image/jpeg";
      /* Stripping EXIF would drop a rotation browsers apply, so a rotated still is redrawn upright at full size
         (only resized when that no longer fits); an animation keeps its frames and a bare orientation tag in place of its EXIF. */
      if (sniff.orientation !== 1 && !sniff.animated) {
        result = await transcode(mime, Math.max(sniff.width, sniff.height)).catch(error => {
          if (error instanceof Error && error.message === "attachment-size") return transcode(mime);
          throw error;
        });
        break;
      }
      const stripped = strip[sniff.format]!(bytes, sniff.orientation);
      if (stripped.length <= byteLimit) { result = output(stripped, IMAGE_MIME[sniff.format]); break; }
      if (sniff.animated) throw new Error("attachment-size");
      result = await transcode(mime); break;
    }
    default: result = await transcode("image/jpeg");
  }
  signal.throwIfAborted();
  await admitProcessedImage(result, byteLimit);
  return result;
}
/** Send admission for images: whitelisted type, bytes whose magic matches that type, and the caller's byte limit. */
export async function admitProcessedImage(file: Blob, byteLimit: number) {
  if (!SENDABLE_IMAGE_TYPES.includes(file.type as typeof SENDABLE_IMAGE_TYPES[number])) throw new Error("attachment-type");
  if (!file.size || file.size > byteLimit) throw new Error("attachment-size");
  if (!hasImageMagic(new Uint8Array(await file.slice(0, 32).arrayBuffer()), file.type)) throw new Error("attachment-format");
}
