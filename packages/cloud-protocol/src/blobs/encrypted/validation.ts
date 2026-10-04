/**
 * [INPUT]: Depends on a bounded content prefix/tail, verified length and incremental UTF-8 validation.
 * [OUTPUT]: Checks claimed MIME against file signatures and the declared business use.
 * [POS]: Client verification helper; signature recognition does not replace the consumer's image/archive decoder.
 */

const starts = (bytes: Uint8Array, values: readonly number[]) => values.every((value, index) => bytes[index] === value);
const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
function verifiedMime(input: { prefix: Uint8Array; tail: Uint8Array; bytes: number; utf8: boolean; declared: string; contentKind: string }) {
  const { prefix, tail, bytes, utf8, declared, contentKind } = input;
  let detected: string | null = null;
  if (prefix.length >= 24 && starts(prefix, [137, 80, 78, 71, 13, 10, 26, 10]) && ascii(prefix, 12, 16) === "IHDR" &&
    tail.length >= 12 && ascii(tail, tail.length - 8, tail.length - 4) === "IEND") detected = "image/png";
  else if (bytes >= 4 && starts(prefix, [255, 216, 255]) && starts(tail.subarray(tail.length - 2), [255, 217])) detected = "image/jpeg";
  else if (bytes >= 14 && ["GIF87a", "GIF89a"].includes(ascii(prefix, 0, 6)) && tail[tail.length - 1] === 59) detected = "image/gif";
  else if (prefix.length >= 16 && ascii(prefix, 0, 4) === "RIFF" && ascii(prefix, 8, 12) === "WEBP" &&
    ["VP8 ", "VP8L", "VP8X"].includes(ascii(prefix, 12, 16)) && new DataView(prefix.buffer, prefix.byteOffset, prefix.byteLength).getUint32(4, true) === bytes - 8) detected = "image/webp";
  else if (ascii(prefix, 0, 5) === "%PDF-") detected = "application/pdf";
  else if (starts(prefix, [80, 75, 3, 4]) || starts(prefix, [80, 75, 5, 6])) detected = "application/zip";
  else if (bytes >= 1024 && ascii(prefix, 257, 263) === "ustar\0" && bytes % 512 === 0) detected = "application/x-tar";
  const image = contentKind === "gallery" || contentKind === "thumbnail";
  if (image && (!detected?.startsWith("image/") || detected !== declared)) throw new Error("file-type-mismatch");
  if (declared === "application/octet-stream" && !image) return declared;
  if (detected === declared) return declared;
  if (!image && detected === "application/zip" && ["application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/vnd.openxmlformats-officedocument.presentationml.presentation"].includes(declared)) return declared;
  if (!image && utf8 && !detected && declared === "image/svg+xml" && /<svg\b/i.test(new TextDecoder().decode(prefix))) return declared;
  if (utf8 && !detected && ["text/plain", "text/markdown", "text/csv", "text/html", "application/json"].includes(declared) && !image) return declared;
  throw new Error("file-type-mismatch");
}

export class PlaintextFileValidator {
  private readonly prefix = new Uint8Array(65_536);
  private prefixBytes = 0;
  private tail = new Uint8Array();
  private bytes = 0;
  private utf8 = true;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  constructor(private readonly mime: string) {}
  write(value: Uint8Array) {
    const copied = Math.min(value.byteLength, this.prefix.length - this.prefixBytes);
    this.prefix.set(value.subarray(0, copied), this.prefixBytes); this.prefixBytes += copied; this.bytes += value.byteLength;
    const tail = new Uint8Array(this.tail.byteLength + Math.min(16, value.byteLength));
    tail.set(this.tail); tail.set(value.subarray(Math.max(0, value.byteLength - 16)), this.tail.byteLength);
    this.tail = tail.slice(-16);
    if (this.utf8) { try { this.decoder.decode(value, { stream: true }); } catch { this.utf8 = false; } }
  }
  finish() {
    if (this.utf8) { try { this.decoder.decode(); } catch { this.utf8 = false; } }
    return verifiedMime({ prefix: this.prefix.subarray(0, this.prefixBytes), tail: this.tail, bytes: this.bytes,
      utf8: this.utf8, declared: this.mime, contentKind: this.mime.startsWith("image/") && this.mime !== "image/svg+xml" ? "gallery" : "chat-attachment" });
  }
  clear() { this.prefix.fill(0); this.tail.fill(0); }
}
