/**
 * [INPUT]: Canonical entry/root paths and guarded artifact source reads.
 * [OUTPUT]: Bounded static resource closures and explicit artifact-directory trees.
 * [POS]: Discovery narrows workspace access; a single resource never authorizes a whole workspace tree.
 */
import { lstat, readdir } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { MAX_BLOB_BYTES } from "@ai-chat/cloud-protocol";
import type { ArtifactFile } from "@ai-chat/cloud-protocol/artifacts/archive";
import { readArtifactSource } from "../storage/guarded-read";
export const ignoredArtifactName = (name: string) => name.startsWith(".") || ["node_modules", "__pycache__"].includes(name);
export function resourceReferences(text: string): string[] {
  const values: string[] = [];
  for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) values.push(match[1]!);
  for (const match of text.matchAll(/\bsrcset\s*=\s*["']([^"']+)["']/gi)) values.push(...match[1]!.split(",").map(value => value.trim().split(/\s+/, 1)[0]!));
  for (const match of text.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)) values.push(match[1]!);
  for (const match of text.matchAll(/(?:\b(?:import|export)\s+(?:[^;\n]*?\s+from\s*)?|@import\s*)["']([^"']+)["']/g)) values.push(match[1]!);
  return [...new Set(values.filter(value => value && !/^(?:[a-z][a-z0-9+.-]*:|\/|#)/i.test(value)))];
}
export function resourcePath(root: string, from: string, reference: string): string | null {
  let clean: string;
  try { clean = decodeURIComponent(reference.split(/[?#]/, 1)[0]!); } catch { return null; }
  if (!clean || /[\\\p{Cc}]/u.test(clean)) return null;
  const target = resolve(dirname(from), clean), name = relative(root, target);
  if (isAbsolute(name) || name.startsWith(".." + sep) || name === ".." || name.split(sep).some(ignoredArtifactName)) return null;
  if (name.split(sep).length > 4) throw new Error("too-large");
  return target;
}
export async function collectArtifactResources(root: string, entry: string, tree: boolean): Promise<ArtifactFile[]> {
  const files: ArtifactFile[] = [], queued = new Set<string>(), queue = [entry];
  let total = 0;
  async function walk(directory: string, depth: number) {
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (ignoredArtifactName(item.name) || item.isSymbolicLink()) continue;
      if (item.isDirectory()) {
        if (depth >= 3) throw new Error("too-large");
        await walk(join(directory, item.name), depth + 1);
      } else if (item.isFile()) {
        queue.push(join(directory, item.name));
        if (queue.length > 201) throw new Error("too-large");
      }
    }
  }
  if (tree) await walk(root, 0);
  while (queue.length) {
    const path = queue.shift()!;
    if (queued.has(path)) continue;
    queued.add(path);
    if (files.length >= 200) throw new Error("too-large");
    const bytes = await readArtifactSource(path, MAX_BLOB_BYTES - total);
    total += bytes.length;
    if (total > MAX_BLOB_BYTES - 104_448) throw new Error("too-large");
    files.push({ path: relative(root, path).split(sep).join("/"), data: bytes });
    if (!tree && /\.(?:html?|css|[cm]?js|svg)$/i.test(extname(path))) {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      for (const reference of resourceReferences(text)) {
        const target = resourcePath(root, path, reference);
        if (!target || queued.has(target)) continue;
        const info = await lstat(target).catch(() => null);
        if (info?.isFile() && !info.isSymbolicLink()) queue.push(target);
      }
    }
  }
  return files;
}
