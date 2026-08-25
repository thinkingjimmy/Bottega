/**
 * [INPUT]: Accepts Freeze the front-end bytes and file size of the copied product
 * [OUTPUT]: Provides PNG/JPEG/WebP/GIF header size resolution, Gallery 12MP and attachment 100MP two-tier boundaries
 * [POS]: Gallery: The purest analyzer of media pipes; The caller decodes the host by selecting the boundary, prohibiting attachment to the old synchronized Gallery decoder
 */

export type GalleryImageHeader = {
  extension: "png" | "jpg" | "webp" | "gif";
  mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  width: number;
  height: number;
};

const MAX_EDGE = 8192;
const MAX_PIXELS = 12_000_000;
const ATTACHMENT_MAX_EDGE = 32_768;
const ATTACHMENT_MAX_PIXELS = 100_000_000;

export function parseGalleryImageHeader(
  buffer: Buffer,
  limits: { maxEdge: number; maxPixels: number } = {
    maxEdge: MAX_EDGE,
    maxPixels: MAX_PIXELS,
  }
): GalleryImageHeader {
  const header =
    parsePng(buffer) ??
    parseJpeg(buffer) ??
    parseGif(buffer) ??
    parseWebp(buffer);
  if (!header) throw galleryHeaderError("UNSUPPORTED_FORMAT");
  if (
    header.width < 1 ||
    header.height < 1 ||
    header.width > limits.maxEdge ||
    header.height > limits.maxEdge ||
    header.width > Math.floor(limits.maxPixels / header.height)
  ) {
    throw galleryHeaderError("TOO_LARGE");
  }
  return header;
}

export const parseAttachmentImageHeader = (buffer: Buffer) =>
  parseGalleryImageHeader(buffer, {
    maxEdge: ATTACHMENT_MAX_EDGE,
    maxPixels: ATTACHMENT_MAX_PIXELS,
  });

function parsePng(buffer: Buffer): GalleryImageHeader | null {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    )
  ) {
    return null;
  }
  return image("png", "image/png", buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

function parseGif(buffer: Buffer): GalleryImageHeader | null {
  if (buffer.length < 10 || !/^GIF8[79]a$/.test(buffer.toString("ascii", 0, 6))) {
    return null;
  }
  return image("gif", "image/gif", buffer.readUInt16LE(6), buffer.readUInt16LE(8));
}

function parseJpeg(buffer: Buffer): GalleryImageHeader | null {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 8 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1]!;
    if (marker === 0xd9 || marker === 0xda) break;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2 || offset + 2 + length > buffer.length) break;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)) {
      return image(
        "jpg",
        "image/jpeg",
        buffer.readUInt16BE(offset + 7),
        buffer.readUInt16BE(offset + 5)
      );
    }
    offset += length + 2;
  }
  throw galleryHeaderError("INVALID_IMAGE");
}

function parseWebp(buffer: Buffer): GalleryImageHeader | null {
  if (
    buffer.length < 30 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return null;
  }
  const kind = buffer.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    return image(
      "webp",
      "image/webp",
      1 + buffer.readUIntLE(24, 3),
      1 + buffer.readUIntLE(27, 3)
    );
  }
  if (kind === "VP8 " && buffer.length >= 30) {
    return image(
      "webp",
      "image/webp",
      buffer.readUInt16LE(26) & 0x3fff,
      buffer.readUInt16LE(28) & 0x3fff
    );
  }
  if (kind === "VP8L" && buffer.length >= 25 && buffer[20] === 0x2f) {
    const bits = buffer.readUInt32LE(21);
    return image(
      "webp",
      "image/webp",
      (bits & 0x3fff) + 1,
      ((bits >>> 14) & 0x3fff) + 1
    );
  }
  throw galleryHeaderError("INVALID_IMAGE");
}

function image(
  extension: GalleryImageHeader["extension"],
  mediaType: GalleryImageHeader["mediaType"],
  width: number,
  height: number
): GalleryImageHeader {
  return { extension, mediaType, width, height };
}

export function galleryHeaderError(
  code: "UNSUPPORTED_FORMAT" | "INVALID_IMAGE" | "TOO_LARGE"
) {
  return Object.assign(new Error(code), { code });
}
