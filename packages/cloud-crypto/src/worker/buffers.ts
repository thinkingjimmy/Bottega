/**
 * [INPUT]: Private worker commands and results with exclusively owned byte arrays.
 * [OUTPUT]: Unique transferable ArrayBuffers without traversing unrelated objects.
 * [POS]: Worker transport ownership boundary; callers must opt in for request transfer.
 */
import type { CryptoCommand, CryptoResult } from "./model";

export function ownedBuffers(value: CryptoCommand | CryptoResult): ArrayBuffer[] {
  const buffers = Object.values(value).filter((item): item is Uint8Array => item instanceof Uint8Array)
    .map(item => item.buffer).filter((buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer);
  return [...new Set(buffers)];
}
