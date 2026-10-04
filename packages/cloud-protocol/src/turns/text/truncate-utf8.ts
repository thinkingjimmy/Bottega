/**
 * [INPUT]: Uses standard strings and TextEncoder only.
 * [OUTPUT]: Provides portable Unicode and Markdown boundary operations.
 * [POS]: Shared text boundary consumed by desktop commits and cloud sealing.
 */
type TruncatedUtf8 = { value: string; truncated: boolean; bytes: number };

export function truncateUtf8(
  value: string,
  byteLimit: number,
  suffix = ""
): TruncatedUtf8 {
  const limit = Math.max(0, Math.floor(byteLimit));
  const sourceBytes = new TextEncoder().encode(value).byteLength;
  if (sourceBytes <= limit) return { value, truncated: false, bytes: sourceBytes };

  const suffixBytes = new TextEncoder().encode(suffix).byteLength;
  if (suffixBytes >= limit) {
    const clipped = sliceUtf8(suffix, limit);
    return {
      value: clipped,
      truncated: true,
      bytes: new TextEncoder().encode(clipped).byteLength,
    };
  }
  const prefix = sliceUtf8(value, limit - suffixBytes);
  const output = `${prefix}${suffix}`;
  return {
    value: output,
    truncated: true,
    bytes: new TextEncoder().encode(output).byteLength,
  };
}

function sliceUtf8(value: string, byteLimit: number) {
  if (byteLimit <= 0) return "";
  let end = 0, bytes = 0;
  while (end < value.length) {
    const scalar = value.codePointAt(end)!;
    const next = scalar <= 0x7f ? 1 : scalar <= 0x7ff ? 2 : scalar <= 0xffff ? 3 : 4;
    if (bytes + next > byteLimit) break;
    bytes += next; end += scalar > 0xffff ? 2 : 1;
  }
  return value.slice(0, end);
}
