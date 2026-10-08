/**
 * [INPUT]: Depends on sharp, macOS iconutil, Node filesystem/process APIs, and resources/icon.png.
 * [OUTPUT]: Atomically generates or checks resources/icon.icns with all standard and Retina icon frames.
 * [POS]: Desktop asset generation; the macOS builder consumes the checked ICNS without PNG conversion.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const args = process.argv.slice(2);
assert(args.length === 0 || (args.length === 1 && args[0] === "--check"),
  "Usage: generate-macos-icon.mjs [--check]");
assert.equal(process.platform, "darwin", "macOS icon generation requires Apple's iconutil");
const desktop = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(desktop, "resources/icon.png");
const target = join(desktop, "resources/icon.icns");
const pending = `${target}.${process.pid}.tmp`;
const metadata = await sharp(source).metadata();
assert(metadata.width === 1024 && metadata.height === 1024 && metadata.hasAlpha,
  "The source icon must be a transparent 1024x1024 PNG");
const temporary = await mkdtemp(join(tmpdir(), "bottega-macos-icon-"));

try {
  const iconset = join(temporary, "Bottega.iconset");
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
      await sharp(source).resize(size * scale, size * scale).png().toFile(join(iconset, name));
    }
  }
  const generated = join(temporary, "icon.icns");
  // Apple's encoder writes the small frames in the formats used by Finder.
  execFileSync("/usr/bin/iconutil", ["--convert", "icns", "--output", generated, iconset],
    { stdio: "pipe" });
  const bytes = await readFile(generated);
  if (args[0] === "--check") {
    assert(bytes.equals(await readFile(target)), "macOS icon is stale; run assets:macos-icon on macOS");
  } else {
    await writeFile(pending, bytes);
    await rename(pending, target);
  }
  process.stdout.write(`${args[0] === "--check" ? "verified" : "generated"} ${target}\n`);
} finally {
  await rm(pending, { force: true });
  await rm(temporary, { recursive: true, force: true });
}
