/**
 * [INPUT]: Depends on a local update-feed directory, expected release version, explicit channel, platform metadata, and immutable assets
 * [OUTPUT]: Provides strict feed verification for top-level version, plain filenames, optional sizes, existence, and base64 SHA512 identity
 * [POS]: Feed integrity oracle shared by staging rehearsal and final release verification
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export function verifyUpdateFeed({
  root,
  expectedVersion,
  channel = "latest",
  platform = process.platform,
}) {
  if (!expectedVersion) throw new Error("expected update-feed version is required");
  if (!/^[a-z][a-z0-9-]*$/.test(channel)) throw new Error("invalid update channel");
  const names = {
    darwin: `${channel}-mac.yml`,
    win32: `${channel}.yml`,
    linux: `${channel}-linux.yml`,
  };
  const metadataName = names[platform];
  if (!metadataName) throw new Error(`unsupported feed platform ${platform}`);
  const metadata = join(root, metadataName);
  if (!existsSync(metadata)) throw new Error(`missing update metadata ${metadata}`);
  const source = readFileSync(metadata, "utf8");
  const version = unquote(field(source, "version"));
  if (version !== expectedVersion) {
    throw new Error(`update feed version mismatch: expected ${expectedVersion}, got ${version}`);
  }

  /* 只验 legacy `path` 是假绿：mac feed 的 `files:` 同时列 zip 与 dmg，而
     `path` 只指其中一个——另一个缺失或被换字节都能整轮通过。逐条验。 */
  const referenced = feedFiles(source);
  const legacy = { url: field(source, "path"), sha512: field(source, "sha512") };
  if (!referenced.some((file) => file.url === legacy.url && file.sha512 === legacy.sha512)) {
    throw new Error(`legacy path/sha512 is not backed by any files: entry (${legacy.url})`);
  }
  for (const file of [...referenced, legacy]) {
    const name = feedAssetName(file.url);
    const asset = join(root, name);
    if (!existsSync(asset)) throw new Error(`metadata asset is missing: ${asset}`);
    const actualSize = statSync(asset).size;
    if (file.size !== undefined && actualSize !== file.size) {
      throw new Error(`size mismatch for ${name}: expected ${file.size}, got ${actualSize}`);
    }
    const actual = createHash("sha512").update(readFileSync(asset)).digest("base64");
    if (actual !== file.sha512) throw new Error(`SHA512 mismatch for ${name}`);
  }
  return {
    metadataName,
    version,
    assets: referenced.map((file) => feedAssetName(file.url)),
  };
}

/**
 * `files:` 是缩进块，顶层 `path`/`sha512` 与块内同名键靠缩进区分：块内恒有
 * 前导空白，顶层恒无——因此遇到任何顶层键就结束当前条目。
 */
export function feedFiles(text) {
  const files = [];
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    if (/^\S/.test(line)) {
      current = null;
      continue;
    }
    const url = line.match(/^\s+-\s+url:\s*(.+?)\s*$/);
    if (url) {
      current = { url: unquote(url[1]) };
      files.push(current);
      continue;
    }
    const sha512 = line.match(/^\s+sha512:\s*(.+?)\s*$/);
    if (sha512 && current && !current.sha512) current.sha512 = unquote(sha512[1]);
    const size = line.match(/^\s+size:\s*(.*?)\s*$/);
    if (size && current && current.size === undefined) {
      const value = unquote(size[1]);
      if (!/^(?:0|[1-9]\d*)$/.test(value)) {
        throw new Error(`feed entry size is invalid: ${size[1]}`);
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) throw new Error(`feed entry size is invalid: ${value}`);
      current.size = parsed;
    }
  }
  if (!files.length) throw new Error("feed metadata lists no files");
  const incomplete = files.find((file) => !file.url || !file.sha512);
  if (incomplete) throw new Error(`feed entry is missing url or sha512: ${incomplete.url ?? "?"}`);
  return files;
}

export function feedAssetName(value) {
  const name = value.trim();
  if (
    !name ||
    name === "." ||
    name === ".." ||
    name !== basename(name) ||
    /[\\/:?#%]/.test(name)
  ) {
    throw new Error(`feed asset URL must be a plain relative filename: ${value}`);
  }
  return name;
}

function unquote(value) {
  return value.trim().replace(/^['"]|['"]$/g, "");
}

function field(source, name) {
  const match = source.match(new RegExp(`^${name}:\\s*['"]?([^'"\\n]+)`, "m"));
  if (!match?.[1]?.trim()) throw new Error(`metadata field ${name} is missing`);
  return match[1].trim();
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = verifyUpdateFeed({
    root: resolve(process.argv[2] ?? "release"),
    channel: process.argv[3] ?? "latest",
    platform: process.argv[4] ?? process.platform,
    expectedVersion: process.argv[5],
  });
  process.stdout.write(
    `${result.metadataName} -> ${result.assets.length} asset(s) SHA512 verified: ${result.assets.join(", ")}\n`
  );
}
