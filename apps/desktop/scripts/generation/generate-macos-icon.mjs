/**
 * [INPUT]: Depends on sharp, Apple's iconutil/actool, Node filesystem/process APIs, resources/icon.png and macos-icon/appearance.json.
 * [OUTPUT]: Generates or checks the native ICNS, named macOS icon catalog and its source-bound digest manifest.
 * [POS]: Desktop asset generation; packaging consumes checked macOS resources without automatic image conversion.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
const catalogDirectory = join(desktop, "resources/macos-icon");
const appearancePath = join(catalogDirectory, "appearance.json");
const catalogPath = join(catalogDirectory, "Assets.car");
const manifestPath = join(catalogDirectory, "manifest.json");
const sourceBytes = await readFile(source);
const appearanceBytes = await readFile(appearancePath);
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const metadata = await sharp(sourceBytes).metadata();
assert(metadata.width === 1024 && metadata.height === 1024 && metadata.hasAlpha,
  "The source icon must be a transparent 1024x1024 PNG");
const temporary = await mkdtemp(join(tmpdir(), "bottega-macos-icon-"));
const pending = [];

try {
  const iconset = join(temporary, "Bottega.iconset");
  await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) {
    for (const scale of [1, 2]) {
      const name = `icon_${size}x${size}${scale === 2 ? "@2x" : ""}.png`;
      await sharp(sourceBytes).resize(size * scale, size * scale).png().toFile(join(iconset, name));
    }
  }
  const generated = join(temporary, "icon.icns");
  // Apple's encoder writes the small frames in the formats used by Finder.
  execFileSync("/usr/bin/iconutil", ["--convert", "icns", "--output", generated, iconset],
    { stdio: "pipe" });
  const bytes = await readFile(generated);
  if (args[0] === "--check") {
    assert(bytes.equals(await readFile(target)), "macOS icon is stale; run assets:macos-icon on macOS");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    assert.equal(manifest.version, 1, "Unsupported macOS catalog manifest");
    assert.equal(manifest.iconName, "Bottega", "Unexpected macOS catalog icon name");
    assert.equal(manifest.sourceSha256, digest(sourceBytes), "macOS catalog source is stale");
    assert.equal(manifest.appearanceSha256, digest(appearanceBytes), "macOS catalog appearance is stale");
    assert.equal(manifest.catalogSha256, digest(await readFile(catalogPath)), "macOS catalog bytes changed");
  } else {
    const composer = join(temporary, "Bottega.icon");
    const compiled = join(temporary, "compiled");
    await mkdir(join(composer, "Assets"), { recursive: true });
    await mkdir(compiled);
    await writeFile(join(composer, "Assets/icon.png"), sourceBytes);
    await writeFile(join(composer, "icon.json"), appearanceBytes);
    // The system applies its enclosure once; the source artwork keeps its original pixels.
    execFileSync("/usr/bin/xcrun", ["actool", composer, "--compile", compiled,
      "--output-format", "human-readable-text", "--output-partial-info-plist", join(compiled, "icon.plist"),
      "--app-icon", "Bottega", "--include-all-app-icons", "--target-device", "mac",
      "--minimum-deployment-target", "15.0", "--platform", "macosx"], { stdio: "pipe" });
    const catalogBytes = await readFile(join(compiled, "Assets.car"));
    const manifest = {
      version: 1,
      iconName: "Bottega",
      sourceSha256: digest(sourceBytes),
      appearanceSha256: digest(appearanceBytes),
      catalogSha256: digest(catalogBytes),
      compiler: execFileSync("/usr/bin/xcodebuild", ["-version"], { encoding: "utf8" }).trim(),
    };
    assert(sourceBytes.equals(await readFile(source)), "Source changed during icon generation");
    assert(appearanceBytes.equals(await readFile(appearancePath)), "Appearance changed during icon generation");
    for (const [path, content] of [[target, bytes], [catalogPath, catalogBytes],
      [manifestPath, `${JSON.stringify(manifest, null, 2)}\n`]]) {
      const pathPending = `${path}.${process.pid}.tmp`;
      pending.push(pathPending);
      await writeFile(pathPending, content);
    }
    for (const [index, path] of [target, catalogPath, manifestPath].entries()) {
      await rename(pending[index], path);
    }
  }
  process.stdout.write(`${args[0] === "--check" ? "verified" : "generated"} macOS ICNS and Bottega catalog\n`);
} finally {
  for (const path of pending) await rm(path, { force: true });
  await rm(temporary, { recursive: true, force: true });
}
