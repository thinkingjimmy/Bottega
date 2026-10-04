/**
 * [INPUT]: Depends on Node stdin/stdout, lock edition sharp and codec framing; Only the parent process receives binary flow
 * [OUTPUT]: Outputs bounded frames for an attachment or a PNG thumbnail, decoding four formats in the isolated Sharp process.
 * [POS]: Entry point of the isolated decode subprocess for bases/media-host; touches no filesystem paths or network, and runs under a seatbelt granting only the temp-directory read/write it needs
 */

import sharp from "sharp";
import {
  BASE_ATTACHMENT_BYTE_LIMIT,
} from "../../../../shared/bases/gallery-attachments";
import { decodeCodecFrames, encodeCodecFrames } from "./protocol";

const INPUT_LIMIT = 64 * 1024 * 1024;
const PIXEL_LIMIT = 100_000_000;
const FALLBACK_PIXELS = 12_000_000;
const SUPPORTED_FORMATS = new Set(["jpeg", "png", "webp", "gif"]);

sharp.cache(false);
sharp.concurrency(1);

async function readInput() {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > INPUT_LIMIT + 64) throw new Error("input exceeds codec cap");
    chunks.push(bytes);
  }
  return Buffer.concat(decodeCodecFrames(Buffer.concat(chunks)));
}

async function normalize(input: Buffer, maxEdge?: number) {
  const metadata = await sharp(input, {
    animated: false,
    failOn: "warning",
    limitInputPixels: PIXEL_LIMIT,
    sequentialRead: true,
  }).metadata();
  if (!metadata.format || !SUPPORTED_FORMATS.has(metadata.format)) {
    throw new Error("unsupported image format");
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (!width || !height || width > Math.floor(PIXEL_LIMIT / height)) {
    throw new Error("pixel budget exceeded");
  }
  if (maxEdge !== undefined) return sharp(input, { animated: false, failOn: "warning", limitInputPixels: PIXEL_LIMIT, sequentialRead: true })
    .rotate().resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true }).png().toBuffer();
  return encodeWithinBudget(input, width, height, Boolean(metadata.hasAlpha));
}

async function encodeWithinBudget(
  input: Buffer,
  width: number,
  height: number,
  alpha: boolean
) {
  // 原尺寸先编码一次：字节预算允许时，>12MP 也必须保留分辨率。
  const original = await encode(input, width, height, 1, 82, alpha);
  if (original.length <= BASE_ATTACHMENT_BYTE_LIMIT) return original;

  // Downsample only when the full-resolution output exceeds the attachment budget.
  let scale = Math.min(
    0.9,
    Math.sqrt(FALLBACK_PIXELS / (width * height))
  );
  for (const quality of [78, 68, 58, 48, 42, 36, 32, 28]) {
    const output = await encode(input, width, height, scale, quality, alpha);
    if (output.length <= BASE_ATTACHMENT_BYTE_LIMIT) return output;
    scale *= alpha ? 0.7 : 0.78;
  }
  throw new Error("encoded image exceeds attachment budget");
}

function encode(
  input: Buffer,
  width: number,
  height: number,
  scale: number,
  quality: number,
  alpha: boolean
) {
  let pipeline = sharp(input, {
    animated: false,
    failOn: "warning",
    limitInputPixels: PIXEL_LIMIT,
    sequentialRead: true,
  }).rotate();
  if (scale < 1) {
    pipeline = pipeline.resize({
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale)),
      fit: "inside",
      withoutEnlargement: true,
    });
  }
  return alpha
    ? pipeline
        .png({ compressionLevel: 9, adaptiveFiltering: true, palette: false })
        .toBuffer()
    : pipeline.jpeg({ quality, mozjpeg: true }).toBuffer();
}

async function main() {
  const args = process.argv.slice(2), maxEdge = args.length ? Number(args[1]) : undefined;
  if (args.length && (args.length !== 2 || args[0] !== "--thumbnail" || !Number.isSafeInteger(maxEdge) || maxEdge! < 1 || maxEdge! > 4096)) throw new Error("invalid codec mode");
  const output = await normalize(await readInput(), maxEdge), parts: Buffer[] = [];
  for (let offset = 0; offset < output.length; offset += 8 * 1024 * 1024) parts.push(output.subarray(offset, offset + 8 * 1024 * 1024));
  process.stdout.write(encodeCodecFrames(parts));
}

main().catch((cause) => {
  process.stderr.write(
    `${cause instanceof Error ? cause.message : String(cause)}\n`
  );
  process.exitCode = 2;
});
