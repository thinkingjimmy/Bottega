/**
 * [INPUT]: One main-selected file path and cancellation, bounded by the project transfer limit.
 * [OUTPUT]: Fixed bytes from one no-follow regular-file handle, with exact size and change checks.
 * [POS]: Project import byte boundary; no renderer-supplied filesystem path reaches this function.
 */
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { PROJECT_ZIP_LIMITS } from "./zip";
export async function readProjectFile(path: string, signal: AbortSignal): Promise<Buffer> {
  signal.throwIfAborted();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size < 1 || before.size > PROJECT_ZIP_LIMITS.transfer) throw new Error("Choose a nonempty regular project ZIP up to 50 MB");
    const bytes = Buffer.alloc(before.size); let offset = 0;
    while (offset < bytes.length) {
      signal.throwIfAborted(); const result = await handle.read(bytes, offset, Math.min(512 * 1024, bytes.length - offset), offset);
      if (!result.bytesRead) throw new Error("The selected project file changed during capture"); offset += result.bytesRead;
    }
    const after = await handle.stat(); signal.throwIfAborted();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error("The selected project file changed during capture");
    return bytes;
  } finally { await handle.close(); }
}
