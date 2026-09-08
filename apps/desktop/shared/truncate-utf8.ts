/**
 * [INPUT]: Depends on the UTF-8 byte syntax of the standard TextEncoder/Buffer
 * [OUTPUT]: Provides truncateUtf8, clipping a string to a byte budget without splitting a Unicode code point or surrogate pair
 * [POS]: The only shared implementation of UTF-8 byte truncation; used wherever text crosses a process byte budget, such as tool results and Section snippets
 */

type TruncatedUtf8 = { value: string; truncated: boolean; bytes: number };

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
