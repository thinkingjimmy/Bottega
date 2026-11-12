/**
 * [INPUT]: A Main-selected fixture directory, relative asset names, declared sizes and hashes.
 * [OUTPUT]: Bounded cancellable reads of regular catalog files and verified static image URLs.
 * [POS]: Local fixture transport. There is no remote asset or renderer-selected path in this transport.
 */
import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { pluginBytesHash } from "../../../plugins/engineering/snapshot";
import { WIDGET_CATALOG_LIMITS, type WidgetDirectory } from "../../../../../shared/system-dock/widgets/catalog/distribution";

export const localAssetName = (value: string) => /^assets\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,191}$/.test(value);
export async function readWidgetAsset(root: string, path: string, limit: number, signal?: AbortSignal, progress?: (bytes: number) => void) {
  if (path !== "catalog.json" && !localAssetName(path)) throw new Error("Invalid Widget fixture path");
  signal?.throwIfAborted();
  const canonical = await realpath(root);
  const full = join(canonical, path);
  if (await realpath(full) !== full) throw new Error("Widget fixture links are unavailable");
  const file = await open(full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > limit) throw new Error("Invalid Widget asset size");
    const bytes = Buffer.alloc(info.size);
    let offset = 0;
    while (offset < bytes.length) {
      signal?.throwIfAborted();
      const { bytesRead } = await file.read(bytes, offset, Math.min(64 * 1024, bytes.length - offset), offset);
      if (!bytesRead) throw new Error("Widget asset ended early");
      offset += bytesRead;
      progress?.(offset);
    }
    signal?.throwIfAborted();
    if ((await file.stat()).size !== info.size) throw new Error("Widget asset changed during read");
    return bytes;
  } finally { await file.close(); }
}

export async function readPreview(root: string, preview: WidgetDirectory["widgets"][number]["preview"], signal: AbortSignal) {
  try {
    const bytes = await readWidgetAsset(root, preview.url, WIDGET_CATALOG_LIMITS.preview, signal);
    if (bytes.length !== preview.bytes || pluginBytesHash(bytes) !== preview.sha256) return null;
    const valid = preview.format === "png" ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
    return valid ? `data:image/${preview.format};base64,${bytes.toString("base64")}` : null;
  } catch { return null; }
}
