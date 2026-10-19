/**
 * [INPUT]: Depends on bounded file-header reads, Gallery header validation, Electron native thumbnails and the out-of-process AppKit icon port.
 * [OUTPUT]: Provides loadDownloadVisual: bounded PNG image previews with native file icons as the fallback.
 * [POS]: system-dock/entries visual adapter; DownloadsEntry owns identity checks, concurrency and visibility-scoped caching.
 */

import { nativeImage, type NativeImage } from "electron";
import { open } from "node:fs/promises";
import { extname } from "node:path";
import type { DownloadVisual, DownloadVisualRequest } from "../../../../shared/system-dock/ipc";
import type { NativePort } from "../native/bridge";
import { parseAttachmentImageHeader } from "../../gallery/image-header";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".heic", ".heif", ".tif", ".tiff", ".bmp", ".ico", ".svg"]);
const GALLERY_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);

async function hasImageHeader(path: string) {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(256 * 1024);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const header = buffer.subarray(0, bytesRead);
    const extension = extname(path).toLowerCase();
    // macOS may return a file icon for non-image bytes; do not present that as an image thumbnail.
    if (GALLERY_EXTENSIONS.has(extension)) { parseAttachmentImageHeader(header); return true; }
    if (extension === ".svg") return /<svg(?:\s|>)/i.test(header.toString("utf8"));
    if (extension === ".bmp") return header.toString("ascii", 0, 2) === "BM";
    if (extension === ".ico") return header.length >= 6 && header.readUInt32LE(0) === 0x00010000 && header.readUInt16LE(4) > 0;
    if (extension === ".tif" || extension === ".tiff") return ["49492a00", "49492b00", "4d4d002a", "4d4d002b"].includes(header.toString("hex", 0, 4));
    return header.toString("ascii", 4, 8) === "ftyp" && /(?:avif|avis|heic|heix|hevc|hevx|mif1|msf1)/.test(header.toString("ascii", 8, 64));
  } finally { await handle.close(); }
}

function encode(image: NativeImage, size: DownloadVisualRequest["size"]) {
  if (image.isEmpty()) return null;
  let bytes = image.toPNG();
  const limit = size === "preview" ? 768 * 1024 : 64 * 1024;
  if (bytes.length > limit) {
    const edge = size === "preview" ? 384 : 64;
    const dimensions = image.getSize();
    const scale = Math.min(1, edge / Math.max(dimensions.width, dimensions.height));
    bytes = image.resize({ width: Math.max(1, Math.round(dimensions.width * scale)), height: Math.max(1, Math.round(dimensions.height * scale)) }).toPNG();
  }
  return bytes.length <= limit ? `data:image/png;base64,${bytes.toString("base64")}` : null;
}

export async function loadDownloadVisual(native: NativePort, path: string, size: DownloadVisualRequest["size"], regularFile: boolean): Promise<DownloadVisual | null> {
  if (regularFile && IMAGE_EXTENSIONS.has(extname(path).toLowerCase())) {
    try {
      if (!await hasImageHeader(path)) throw new Error("DOWNLOAD_IMAGE_HEADER_INVALID");
      const edge = size === "preview" ? 640 : 96;
      const image = await nativeImage.createThumbnailFromPath(path, { width: edge, height: edge });
      const dataUrl = encode(image, size);
      if (dataUrl) return { kind: "thumbnail", dataUrl };
    } catch { /* An unsupported or incomplete image keeps its real system file icon. */ }
  }
  try {
    // Keep file icon extraction in the established AppKit helper: Electron's API can crash its main process on macOS.
    const data = await native.request({ op: "icons", paths: [path], size: size === "preview" ? 128 : 48 });
    const dataUrl = data[path];
    const limit = size === "preview" ? 768 * 1024 : 64 * 1024;
    return dataUrl?.startsWith("data:image/png;base64,") && dataUrl.length <= limit ? { kind: "icon", dataUrl } : null;
  } catch { return null; }
}
