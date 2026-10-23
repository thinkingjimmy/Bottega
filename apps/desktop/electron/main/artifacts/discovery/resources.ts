/**
 * [INPUT]: Canonical entry/root paths and guarded artifact source reads.
 * [OUTPUT]: Collects resource occurrences independently of navigation links and rewrites site-root URLs inside bounded archives.
 * [POS]: Discovery narrows workspace access; a single resource never authorizes a whole workspace tree.
 */
import { ArtifactFailure } from "../storage/failure";
import { lstat, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { MAX_BLOB_BYTES } from "@ai-chat/cloud-protocol";
import type { ArtifactFile } from "@ai-chat/cloud-protocol/artifacts/archive";
import { readArtifactSource } from "../storage/guarded-read";
export const ignoredArtifactName = (name: string) => name.startsWith(".") || ["node_modules", "__pycache__"].includes(name);
export const designDocumentSource = (workspace: string, path: string) =>
  /^design\/[a-z0-9][a-z0-9_-]{0,63}\//.test(relative(workspace, resolve(workspace, path)).split(sep).join("/"));
export function resourceReferences(text: string, includeNavigation = false): string[] {
  if (!includeNavigation) text = text.replace(/<(?:a|area)\b[^>]*>/gi, tag => tag.replace(/\bhref\s*=\s*["'][^"']*["']/gi, ""));
  const values: string[] = [];
  for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]!);
  for (const match of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) values.push(...match[1]!.split(",").map(value => value.trim().split(/\s+/, 1)[0]!));
  for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) values.push(match[1]!);
  for (const match of text.matchAll(/(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?|@import\s*)["']([^"']+)["']/g)) values.push(match[1]!);
  return [...new Set(values.filter(value => value && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(value)))];
}
export function resourcePath(root: string, from: string, reference: string): string | null {
  let clean: string;
  try { clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]!); } catch { return null; }
  if (!clean || /[\\\p{Cc}]/u.test(clean)) return null;
  if (clean.startsWith("//") || clean.startsWith("/") && clean.split("/").includes("..")) return null;
  const target = clean.startsWith("/") ? resolve(root, "." + clean) : resolve(dirname(from), clean), name = relative(root, target);
  if (isAbsolute(name) || name.startsWith(".." + sep) || name === ".." || name.split(sep).some(ignoredArtifactName)) return null;
  if (name.split(sep).length > 4) throw new ArtifactFailure("too-large", "read");
  return target;
}
export async function collectArtifactResources(root: string, entry: string, tree: boolean): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = [], queued = new Set<string>(), queue = [entry];
  let total = 0;
  async function walk(directory: string, depth: number) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (ignoredArtifactName(item.name) || item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        if (depth >= 3) throw new ArtifactFailure("too-large", "read");
        await walk(join(directory, item.name), depth + 1);
      } else if (item.isFile()) {
        queue.push(join(directory, item.name));
        if (queue.length > 201) throw new ArtifactFailure("too-large", "read");
      }
    }
  }
  if (tree) await walk(root, 0);
  while (queue.length) {
    const path = queue.shift()!;
    if (queued.has(path)) continue;
    queued.add(path);
    if (files.length >= 200) throw new ArtifactFailure("too-large", "read");
    const bytes = await readArtifactSource(path, MAX_BLOB_BYTES - total);
    total += bytes.length;
    if (total > MAX_BLOB_BYTES - 104_448) throw new ArtifactFailure("too-large", "read");
    files.push({ path: relative(root, path).split(sep).join("/"), data: bytes });
    if (!tree && /\.(?:html?|css|[cm]?js|svg)$/i.test(extname(path))) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      for (const reference of resourceReferences(text)) {
        const target = resourcePath(root, path, reference);
        if (!target) throw new ArtifactFailure("path-denied", "resources");
        if (queued.has(target)) continue;
        const info = await lstat(target);
        if (info.isSymbolicLink()) throw new ArtifactFailure("symlink", "resources");
        if (!info.isFile()) throw new ArtifactFailure("unsupported", "resources");
        queue.push(target);
      }
    }
  }
  return files.map(file => {
    if (!/\.(?:html?|css|[cm]?js|svg)$/i.test(file.path)) return file;
    let text = new TextDecoder("utf-8", { fatal: true }).decode(file.data);
    for (const url of resourceReferences(text, true)) {
      if (!url.startsWith("/")) continue;
      const from = join(root, file.path), target = resourcePath(root, from, url);
      if (!target) throw new ArtifactFailure("path-denied", "resources");
      const suffix = url.slice(url.search(/[?#]/) < 0 ? url.length : url.search(/[?#]/));
      const mapped = relative(dirname(from), target).split(sep).map(segment => segment === ".." ? segment : encodeURIComponent(segment)).join("/") + suffix;
      text = text.split(url).join(mapped.startsWith(".") ? mapped : "./" + mapped);
    }
    return { ...file, data: new TextEncoder().encode(text) };
  });
}
