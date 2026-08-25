/**
 * [INPUT]: Depends on Node fs/path/crypto, performs lstat scanning on the target tree that does not follow the symbol link
 * [OUTPUT]: Provides scanTree/treeSha256/assertSameTree, detects changes such as commit/ignored/mode/link
 * [POS]: Conformity core of install/repair, providing a stable length summary for S0/S1/S2
 */

import { createHash } from "node:crypto";
import { lstat, opendir, readlink } from "node:fs/promises";
import { join, relative } from "node:path";

export type TreeEntry = {
  path: string;
  type: "file" | "directory" | "symlink" | "other";
  mode: number;
  size: string;
  mtimeNs: string;
  ctimeNs: string;
  target?: string;
};

export async function scanTree(root: string) {
  const entries: TreeEntry[] = [];
  async function visit(path: string) {
    const info = await lstat(path, { bigint: true });
    const type = info.isFile()
      ? "file"
      : info.isDirectory()
        ? "directory"
        : info.isSymbolicLink()
          ? "symlink"
          : "other";
    const entry: TreeEntry = {
      path: relative(root, path) || ".",
      type,
      mode: Number(info.mode),
      size: String(info.size),
      mtimeNs: String(info.mtimeNs),
      ctimeNs: String(info.ctimeNs),
    };
    if (type === "symlink") entry.target = await readlink(path);
    entries.push(entry);
    if (type !== "directory") return;
    const directory = await opendir(path);
    const children: string[] = [];
    for await (const child of directory) children.push(child.name);
    for (const name of children.sort()) await visit(join(path, name));
  }
  await visit(root);
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

export function treeSha256(entries: TreeEntry[]) {
  const normalized = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

export async function snapshotTree(root: string) {
  return treeSha256(await scanTree(root));
}

export function assertSameTree(left: string, right: string, message: string) {
  if (left !== right) throw new Error(message);
}
