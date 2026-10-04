/**
 * [INPUT]: A digest-verified gzip tar archive and the pinned executable expansion budget.
 * [OUTPUT]: extractExecutable, accepting exactly one regular cloudflared member.
 * [POS]: Tunnel supply archive boundary; no archive path is written to disk.
 */
import { gunzipSync } from "node:zlib";
export function extractExecutable(archive: Uint8Array, maximumBytes: number): Buffer {
  const tar = gunzipSync(archive, { maxOutputLength: maximumBytes + 16_384 });
  let result: Buffer | null = null, offset = 0;
  const octal = (bytes: Buffer) => {
    const value = bytes.toString("ascii").replace(/\0/g, "").trim();
    if (!/^[0-7]+$/.test(value)) throw new Error("tunnel-archive-invalid");
    return parseInt(value, 8);
  };
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      if (!tar.subarray(offset).every(byte => byte === 0)) throw new Error("tunnel-archive-invalid");
      break;
    }
    const expected = octal(header.subarray(148, 156));
    const actual = header.reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0);
    const name = header.subarray(0, 100).toString("utf8").replace(/\0.*$/s, "");
    const prefix = header.subarray(345, 500).toString("utf8").replace(/\0.*$/s, "");
    const size = octal(header.subarray(124, 136));
    if (expected !== actual || name !== "cloudflared" || prefix || ![0, 48].includes(header[156]!) || result ||
        size < 1 || size > maximumBytes || offset + 512 + size > tar.length) throw new Error("tunnel-archive-invalid");
    result = Buffer.from(tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  if (!result) throw new Error("tunnel-archive-invalid");
  return result;
}
