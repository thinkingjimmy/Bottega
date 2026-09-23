/**
 * [INPUT]: Raw image bytes only; no DOM, canvas or network.
 * [OUTPUT]: sniffImage (real format, dimensions — HEIF/AVIF from `ispe` — EXIF orientation of JPEG/PNG/WebP, alpha/animation), metadata stripping for JPEG/PNG/GIF/WebP and hasImageMagic.
 * [POS]: Pure byte layer of the shared image input pipeline; pipeline.ts decides, canvas.ts re-encodes.
 */
export type ImageFormat = "jpeg" | "png" | "gif" | "webp" | "heif" | "avif";
export type ImageSniff = { format: ImageFormat; width: number | null; height: number | null; orientation: number; animated: boolean; alpha: boolean };
export const IMAGE_MIME: Record<ImageFormat, string> = { jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp", heif: "image/heic", avif: "image/avif" };
const ascii = (bytes: Uint8Array, offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length));
const u16be = (b: Uint8Array, o: number) => (b[o]! << 8) | b[o + 1]!;
const u32be = (b: Uint8Array, o: number) => ((b[o]! << 24) >>> 0) + (b[o + 1]! << 16) + (b[o + 2]! << 8) + b[o + 3]!;
const u16le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u24le = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32le = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16)) + (b[o + 3]! << 24 >>> 0);
function invalid(): never { throw new Error("attachment-format"); }
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const HEIF_BRANDS = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]), AVIF_BRANDS = new Set(["avif", "avis"]);
export function hasImageMagic(bytes: Uint8Array, mime: string) {
  const format = sniffFormat(bytes);
  return format !== null && IMAGE_MIME[format] === mime;
}
function sniffFormat(b: Uint8Array): ImageFormat | null {
  if (b.length >= 8 && PNG_SIGNATURE.every((value, index) => b[index] === value)) return "png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 6 && (ascii(b, 0, 6) === "GIF87a" || ascii(b, 0, 6) === "GIF89a")) return "gif";
  if (b.length >= 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") return "webp";
  if (b.length >= 12 && ascii(b, 4, 4) === "ftyp") {
    const size = Math.min(u32be(b, 0), b.length), brands = [ascii(b, 8, 4)];
    for (let offset = 16; offset + 4 <= size; offset += 4) brands.push(ascii(b, offset, 4));
    if (brands.some(brand => AVIF_BRANDS.has(brand))) return "avif";
    if (brands.some(brand => HEIF_BRANDS.has(brand))) return "heif";
  }
  return null;
}
/** ISO BMFF (HEIF/AVIF): the largest `ispe` extent under meta/iprp/ipco, so a huge grid is refused before any decode. */
function bmffSniff(b: Uint8Array, base: ImageSniff): ImageSniff {
  let width = 0, height = 0;
  const walk = (from: number, to: number, depth: number) => {
    for (let offset = from; offset + 8 <= to;) {
      let size = u32be(b, offset), header = 8;
      if (size === 1) { if (offset + 16 > to || u32be(b, offset + 8)) invalid(); size = u32be(b, offset + 12); header = 16; }
      else if (size === 0) size = to - offset;
      const type = ascii(b, offset + 4, 4), end = offset + size; if (size < header || end > to) invalid();
      if (type === "meta" && depth === 0) walk(offset + header + 4, end, 1);
      else if (type === "iprp" && depth === 1 || type === "ipco" && depth === 2) walk(offset + header, end, depth + 1);
      else if (type === "ispe" && depth === 3 && end >= offset + header + 12) {
        const w = u32be(b, offset + header + 4), h = u32be(b, offset + header + 8);
        if (w * h > width * height) { width = w; height = h; }
      }
      offset = end;
    }
  };
  walk(0, b.length, 0);
  return width && height ? { ...base, width, height } : base;
}
/** Reads only headers: the real format, pixel size before any decode, and what a byte-level copy would carry over. */
export function sniffImage(bytes: Uint8Array): ImageSniff | null {
  const format = sniffFormat(bytes); if (!format) return null;
  const base: ImageSniff = { format, width: null, height: null, orientation: 1, animated: false, alpha: false };
  try {
    if (format === "png") {
      if (ascii(bytes, 12, 4) !== "IHDR") return null;
      const colorType = bytes[25]!, chunks = pngChunks(bytes), exif = chunks.find(chunk => chunk.type === "eXIf");
      return { ...base, width: u32be(bytes, 16), height: u32be(bytes, 20), alpha: colorType === 4 || colorType === 6 || chunks.some(chunk => chunk.type === "tRNS"),
        animated: chunks.some(chunk => chunk.type === "acTL"), orientation: exif ? exifOrientation(bytes.subarray(exif.start + 8, exif.end - 4)) ?? 1 : 1 };
    }
    if (format === "gif") return { ...base, width: u16le(bytes, 6), height: u16le(bytes, 8), animated: true, alpha: true };
    if (format === "webp") return webpSniff(bytes, base);
    if (format === "jpeg") return jpegSniff(bytes, base);
    return bmffSniff(bytes, base);
  } catch { return null; }
  return base;
}
type Segment = { marker: number; start: number; end: number };
/** Walks JPEG markers through every scan to EOI; entropy-coded data is copied, never interpreted. */
function jpegSegments(b: Uint8Array) {
  const segments: Segment[] = []; let offset = 2;
  while (offset < b.length) {
    if (b[offset] !== 0xff) invalid();
    let marker = b[offset + 1]!; let start = offset;
    while (marker === 0xff) { start++; marker = b[start + 1]!; }
    if (marker === 0xd9) { segments.push({ marker, start, end: start + 2 }); return segments; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { segments.push({ marker, start, end: start + 2 }); offset = start + 2; continue; }
    if (start + 4 > b.length) invalid();
    let end = start + 2 + u16be(b, start + 2); if (end > b.length) invalid();
    if (marker === 0xda) {
      while (end < b.length - 1 && !(b[end] === 0xff && b[end + 1] !== 0x00 && !(b[end + 1]! >= 0xd0 && b[end + 1]! <= 0xd7))) end++;
      if (end >= b.length - 1) invalid();
    }
    segments.push({ marker, start, end }); offset = end;
  }
  invalid();
}
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
function jpegSniff(b: Uint8Array, base: ImageSniff): ImageSniff {
  let width: number | null = null, height: number | null = null, orientation = 1;
  for (const segment of jpegSegments(b)) {
    if (SOF.has(segment.marker) && width === null) { height = u16be(b, segment.start + 5); width = u16be(b, segment.start + 7); }
    if (segment.marker === 0xe1 && ascii(b, segment.start + 4, 6) === "Exif\0\0") orientation = exifOrientation(b.subarray(segment.start + 10, segment.end)) ?? orientation;
  }
  return { ...base, width, height, orientation };
}
function exifOrientation(tiff: Uint8Array): number | null {
  const little = ascii(tiff, 0, 2) === "II"; if (!little && ascii(tiff, 0, 2) !== "MM") return null;
  const u16 = (o: number) => little ? u16le(tiff, o) : u16be(tiff, o), u32 = (o: number) => little ? u32le(tiff, o) : u32be(tiff, o);
  const ifd = u32(4); if (ifd + 2 > tiff.length) return null;
  for (let index = 0, count = u16(ifd); index < count; index++) {
    const entry = ifd + 2 + index * 12; if (entry + 12 > tiff.length) return null;
    if (u16(entry) === 0x0112) { const value = u16(entry + 8); return value >= 1 && value <= 8 ? value : null; }
  }
  return null;
}
/* JFIF, ICC colour and Adobe colour-transform segments change how pixels render; every other APPn and COM is metadata. */
const keepJpeg = (b: Uint8Array, segment: Segment) => segment.marker === 0xfe ? false : segment.marker < 0xe0 || segment.marker > 0xef ? true :
  segment.marker === 0xe0 || segment.marker === 0xee || segment.marker === 0xe2 && ascii(b, segment.start + 4, 12) === "ICC_PROFILE\0";
/** Drops EXIF/XMP/IPTC/comments and any bytes after EOI (maker trailers); pixels are copied verbatim, so orientation must already be 1. */
export function stripJpeg(bytes: Uint8Array) { return join([bytes.subarray(0, 2), ...jpegSegments(bytes).filter(segment => keepJpeg(bytes, segment)).map(segment => bytes.subarray(segment.start, segment.end))]); }
type Chunk = { type: string; start: number; end: number };
function pngChunks(b: Uint8Array) {
  const chunks: Chunk[] = [];
  for (let offset = 8; offset < b.length;) {
    if (offset + 12 > b.length) invalid();
    const end = offset + 12 + u32be(b, offset); if (end > b.length) invalid();
    const type = ascii(b, offset + 4, 4); chunks.push({ type, start: offset, end }); offset = end;
    if (type === "IEND") return chunks;
  }
  invalid();
}
/* A big-endian TIFF whose only entry is Orientation (0x0112, SHORT): all an animation keeps of its EXIF, since frames cannot be redrawn upright. */
const orientationTiff = (value: number) => Uint8Array.from([0x4d, 0x4d, 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, value, 0, 0, 0, 0, 0, 0]);
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(bytes: Uint8Array) { let c = 0xffffffff; for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function pngChunk(type: string, data: Uint8Array) {
  const body = join([new TextEncoder().encode(type), data]), out = new Uint8Array(body.length + 8), view = new DataView(out.buffer);
  view.setUint32(0, data.length); out.set(body, 4); view.setUint32(body.length + 4, crc32(body)); return out;
}
const PNG_KEEP = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "gAMA", "cHRM", "sRGB", "iCCP", "sBIT", "bKGD", "pHYs", "acTL", "fcTL", "fdAT"]);
/**
 * Keeps only chunks that affect rendering (APNG included); text, eXIf, tIME and private chunks go and kept chunks keep their CRCs.
 * A non-upright `orientation` (an animation's) comes back as a fresh eXIf holding nothing else, right after IHDR.
 */
export function stripPng(bytes: Uint8Array, orientation = 1) {
  const kept = pngChunks(bytes).filter(chunk => PNG_KEEP.has(chunk.type)).map(chunk => bytes.subarray(chunk.start, chunk.end));
  if (orientation !== 1) kept.splice(1, 0, pngChunk("eXIf", orientationTiff(orientation)));
  return join([bytes.subarray(0, 8), ...kept]);
}
/** Removes comment and application extensions except the NETSCAPE2.0 loop block; frames, palettes and timing stay byte-identical. */
export function stripGif(b: Uint8Array) {
  if (sniffFormat(b) !== "gif" || b.length < 13) invalid();
  const parts: Uint8Array[] = []; let offset = 13;
  if (b[10]! & 0x80) offset += 3 * (1 << ((b[10]! & 0x07) + 1));
  parts.push(b.subarray(0, offset));
  const blocks = (from: number) => { let at = from; while (true) { if (at >= b.length) invalid(); const size = b[at]!; at += 1 + size; if (size === 0) return at; } };
  while (true) {
    if (offset >= b.length) invalid();
    const kind = b[offset]!;
    if (kind === 0x3b) { parts.push(b.subarray(offset, offset + 1)); return join(parts); }
    if (kind === 0x2c) {
      let at = offset + 10; if (at > b.length) invalid();
      if (b[offset + 9]! & 0x80) at += 3 * (1 << ((b[offset + 9]! & 0x07) + 1));
      const end = blocks(at + 1); parts.push(b.subarray(offset, end)); offset = end; continue;
    }
    if (kind !== 0x21) invalid();
    const label = b[offset + 1]!, end = blocks(offset + 2);
    const loop = label === 0xff && b[offset + 2] === 11 && ascii(b, offset + 3, 11) === "NETSCAPE2.0";
    if (label === 0xf9 || label === 0x01 || loop) parts.push(b.subarray(offset, end));
    offset = end;
  }
}
function webpChunks(b: Uint8Array) {
  const chunks: Chunk[] = [], total = Math.min(b.length, 8 + u32le(b, 4));
  for (let offset = 12; offset < total;) {
    if (offset + 8 > total) invalid();
    const size = u32le(b, offset + 4), end = offset + 8 + size + (size & 1); if (offset + 8 + size > total) invalid();
    chunks.push({ type: ascii(b, offset, 4), start: offset, end: Math.min(end, total) }); offset = end;
  }
  return chunks;
}
function webpSniff(b: Uint8Array, image: ImageSniff): ImageSniff {
  const chunks = webpChunks(b), first = chunks[0]; if (!first) return image;
  const exif = chunks.find(chunk => chunk.type === "EXIF"), data = exif ? b.subarray(exif.start + 8, exif.end) : null;
  // Some writers keep the JPEG APP1 "Exif\0\0" prefix inside the chunk.
  const tiff = data && ascii(data, 0, 6) === "Exif\0\0" ? data.subarray(6) : data;
  const base = { ...image, orientation: tiff ? exifOrientation(tiff) ?? 1 : 1 }, o = first.start + 8;
  if (first.type === "VP8X") return { ...base, width: u24le(b, o + 4) + 1, height: u24le(b, o + 7) + 1, alpha: Boolean(b[o]! & 0x10), animated: Boolean(b[o]! & 0x02) };
  if (first.type === "VP8L") { const bits = u32le(b, o + 1); return { ...base, width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alpha: Boolean((bits >>> 28) & 1) }; }
  if (first.type === "VP8 ") return { ...base, width: u16le(b, o + 6) & 0x3fff, height: u16le(b, o + 8) & 0x3fff };
  return base;
}
/**
 * Drops EXIF and XMP chunks and clears their VP8X flags; image and animation chunks are copied verbatim.
 * A non-upright `orientation` (an animation's) comes back as a trailing EXIF chunk holding nothing else, with its flag set.
 */
export function stripWebp(bytes: Uint8Array, orientation = 1) {
  const kept = webpChunks(bytes).filter(chunk => chunk.type !== "EXIF" && chunk.type !== "XMP ").map(chunk => {
    if (chunk.type !== "VP8X") return bytes.subarray(chunk.start, chunk.end);
    const copy = bytes.slice(chunk.start, chunk.end); copy[8] = copy[8]! & ~0x0c | (orientation !== 1 ? 0x08 : 0); return copy;
  });
  if (orientation !== 1) { const tiff = orientationTiff(orientation), size = new Uint8Array(4); new DataView(size.buffer).setUint32(0, tiff.length, true); kept.push(join([new TextEncoder().encode("EXIF"), size, tiff])); }
  const body = join([new TextEncoder().encode("WEBP"), ...kept]), header = new Uint8Array(8);
  header.set(new TextEncoder().encode("RIFF")); new DataView(header.buffer).setUint32(4, body.length, true);
  return join([header, body]);
}
function join(parts: readonly Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
