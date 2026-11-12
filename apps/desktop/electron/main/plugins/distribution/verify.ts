/**
 * [INPUT]: Depends on the full unified distribution contract, canonical/byte digests and bounded descriptor-based filesystem reads.
 * [OUTPUT]: Verifies complete precompiled plugin packages and returns the exact admitted bytes for immutable custody.
 * [POS]: Receiver byte boundary; it imports no compiler, package manager, source Project or authoring runtime.
 */
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { hashCanonical } from "@bottega/contracts/core/canonical-json";
import { unifiedPluginDistributionSchema, unifiedPluginManifestSchema, unifiedPluginRevisionId, UNIFIED_PLUGIN_PACKAGE_LIMITS as LIMITS } from "@bottega/contracts/plugins/platform";
const hash = (value: unknown) => `sha256:${hashCanonical(value)}`;
const bytesHash = (value: Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
export async function verifyUnifiedPluginDistribution(directory: string, target = hostTarget) {
  const root = await realpath(directory);
  if ((await lstat(directory)).isSymbolicLink()) throw new Error("Plugin package directory cannot be a symbolic link");
  const files = new Map<string, Buffer>(); let total = 0;
  async function visit(path: string, depth = 0) {
    if (depth > 16) throw new Error("Plugin package directory depth exceeds budget");
    for (const name of (await readdir(path)).sort()) {
      if (["node_modules", ".git"].includes(name)) throw new Error("Receiver packages cannot depend on a source computer's directories");
      const target = join(path, name), info = await lstat(target), key = relative(root, target).split(sep).join("/");
      if (info.isSymbolicLink()) throw new Error("Plugin package contains a symbolic link");
      if (info.isDirectory()) { await visit(target, depth + 1); continue; }
      if (!info.isFile() || info.nlink !== 1 || (info.mode & 0o111) || info.size > LIMITS.fileBytes || files.size >= LIMITS.files + 1) throw new Error("Plugin package file is invalid");
      const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      let content: Buffer;
      try { const held = await file.stat(); if (held.dev !== info.dev || held.ino !== info.ino) throw new Error("Plugin package changed during admission"); content = await file.readFile(); }
      finally { await file.close(); }
      total += content.length;
      if (content.length !== info.size || total > LIMITS.totalBytes + 1_048_576) throw new Error("Plugin package byte budget exceeded");
      files.set(key, content);
    }
  }
  await visit(root);
  return verifyUnifiedPluginFiles(files, target);
}
const hostTarget = { platform: process.platform, arch: process.arch, nodeMajor: 24, sdkVersion: 1 };
export function verifyUnifiedPluginFiles(files: Map<string, Buffer>, target = hostTarget) {
  const descriptor = files.get("plugin-package.json");
  if (!descriptor || descriptor.length > 1_048_576) throw new Error("Complete plugin distribution metadata is missing");
  const distribution = unifiedPluginDistributionSchema.parse(JSON.parse(descriptor.toString("utf8")));
  if (distribution.target.platform !== target.platform || distribution.target.arch !== target.arch || distribution.target.nodeMajor !== target.nodeMajor || distribution.target.sdkVersion !== target.sdkVersion) throw new Error("Plugin package target is unsupported on this computer");
  if (unifiedPluginRevisionId(distribution) !== distribution.revisionId || distribution.manifestDigest !== hash(distribution.manifest) || distribution.contentDigest !== hash(distribution.files)) throw new Error("Plugin distribution identity changed");
  if (files.size !== distribution.files.length + 1) throw new Error("Plugin package contains missing or unlisted files");
  for (const file of distribution.files) { const content = files.get(file.path); if (!content || content.length !== file.bytes || bytesHash(content) !== file.sha256) throw new Error(`Plugin package file digest changed: ${file.path}`); }
  const manifest = unifiedPluginManifestSchema.parse(JSON.parse(files.get("bottega.plugin.json")?.toString("utf8") ?? "null"));
  if (hash(manifest) !== distribution.manifestDigest) throw new Error("Plugin runtime declaration changed");
  const source = distribution.files.filter(file => file.role === "source").map(({ path, bytes, sha256 }) => ({ path: path.replace(/^source\//, ""), bytes, sha256 }));
  if (hash(source) !== distribution.sourceDigest || bytesHash(files.get("source/pnpm-lock.yaml") ?? Buffer.alloc(0)) !== distribution.lockDigest) throw new Error("Plugin source or lock identity changed");
  return { distribution, files, packageDigest: hash(distribution) };
}
