/**
 * [INPUT]: Depends on the UTF-8 byte syntax of the standard TextEncoder/Buffer
 * [OUTPUT]: Provides truncate Utf8, in the total byte budget, in full Unicode standard size
 * [POS]: UTF-8 interrupts shared only implementation, cross-process border replication, such as tooling results, Section snippets, and more
 */

export type TruncatedUtf8 = { value: string; truncated: boolean; bytes: number };

export function truncateUtf8(
  value: string,
  byteLimit: number,
  suffix = ""
): TruncatedUtf8 {
  const limit = Math.max(0, Math.floor(byteLimit));
  const sourceBytes = Buffer.byteLength(value, "utf8");
  if (sourceBytes <= limit) return { value, truncated: false, bytes: sourceBytes };

  const suffixBytes = Buffer.byteLength(suffix, "utf8");
  if (suffixBytes >= limit) {
    const clipped = sliceUtf8(suffix, limit);
    return {
      value: clipped,
      truncated: true,
      bytes: Buffer.byteLength(clipped, "utf8"),
    };
  }
  const prefix = sliceUtf8(value, limit - suffixBytes);
  const output = `${prefix}${suffix}`;
  return {
    value: output,
    truncated: true,
    bytes: Buffer.byteLength(output, "utf8"),
  };
}

function sliceUtf8(value: string, byteLimit: number) {
  if (byteLimit <= 0) return "";
  let output = "";
  let bytes = 0;
  for (const scalar of value) {
    const next = Buffer.byteLength(scalar, "utf8");
    if (bytes + next > byteLimit) break;
    output += scalar;
    bytes += next;
  }
  return output;
}
