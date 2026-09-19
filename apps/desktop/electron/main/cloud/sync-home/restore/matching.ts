/**
 * [INPUT]: Authenticated manifest entries and an owned Home target.
 * [OUTPUT]: Read-only content/mode equality evidence with a final inode and parent identity check.
 * [POS]: Incremental restore policy; cached equality never bypasses current Home or filesystem authority.
 */
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join } from "node:path";
import { homeEntrySchema, type HomeEntry } from "@ai-chat/cloud-protocol/chats/home/model";
import type { HomeTarget } from "./files";
const same = (left: Stats, right: Stats) => left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
  left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs && left.mode === right.mode && right.nlink === 1;
export async function matchingHomeFile(target: HomeTarget, raw: Extract<HomeEntry, { kind: "file" }>, signal: AbortSignal): Promise<null | (() => Promise<void>)> {
  const entry = homeEntrySchema.parse(raw);
  if (entry.kind !== "file") throw new Error("HOME_RESTORE_INVALID_ENTRY");
  signal.throwIfAborted(); await target.verify();
  if (target.worktree && (entry.path === target.worktree || entry.path.startsWith(target.worktree + "/"))) throw new Error("HOME_WORKTREE_PROTECTED");
  const parents: { path: string; stat: Stats }[] = [];
  let path = target.root;
  try {
    for (const segment of entry.path.split("/").slice(0, -1)) {
      path = join(path, segment); const stat = await lstat(path);
      if (stat.isFile() && stat.nlink === 1) return null;
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error("HOME_RESTORE_UNSAFE_PATH");
      parents.push({ path, stat });
    }
    path = join(target.root, entry.path);
    const before = await lstat(path);
    if (before.isDirectory() && !before.isSymbolicLink()) return null;
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("HOME_RESTORE_UNSAFE_PATH");
    if (before.size !== entry.blob.bytes || (before.mode & 0o777) !== entry.mode) return null;
    const verify = async () => {
      signal.throwIfAborted(); await target.verify();
      for (const parent of parents) {
        const now = await lstat(parent.path);
        if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== parent.stat.dev || now.ino !== parent.stat.ino || await realpath(parent.path) !== parent.path) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
      }
      if (!same(before, await lstat(path))) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
    };
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      if (!same(before, await file.stat())) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
      await verify(); const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, before.size)));
      for (let offset = 0; offset < before.size;) {
        signal.throwIfAborted(); const { bytesRead } = await file.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
        if (!bytesRead) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
        hash.update(buffer.subarray(0, bytesRead)); offset += bytesRead;
      }
      if (!same(before, await file.stat())) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
      await verify(); return hash.digest("hex") === entry.blob.sha256 ? verify : null;
    } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
