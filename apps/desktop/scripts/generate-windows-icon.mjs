/**
 * [INPUT]: Depends on sharp, Node buffers/fs/path, and resources/icon.png
 * [OUTPUT]: Deterministically writes a multi-size PNG-backed resources/icon.ico
 * [POS]: Reproducible Windows icon asset generator; electron-builder consumes only its checked output
 */

import { Buffer } from "node:buffer";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const desktop = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = join(desktop, "resources", "icon.png");
const target = join(desktop, "resources", "icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];
const images = await Promise.all(
  sizes.map((size) =>
    sharp(source)
      .resize(size, size, { fit: "contain" })
      .png()
      .toBuffer()
  )
);
const header = Buffer.alloc(6 + images.length * 16);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
for (let index = 0; index < images.length; index += 1) {
  const entry = 6 + index * 16;
  const size = sizes[index];
  const image = images[index];
  header.writeUInt8(size === 256 ? 0 : size, entry);
  header.writeUInt8(size === 256 ? 0 : size, entry + 1);
  header.writeUInt8(0, entry + 2);
  header.writeUInt8(0, entry + 3);
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(image.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += image.length;
}
await writeFile(target, Buffer.concat([header, ...images]));
process.stdout.write(`generated ${target} (${sizes.join(",")}px)\n`);
