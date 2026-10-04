/**
 * [INPUT]: Depends on verified Home ownership, immutable cache descriptors and bounded filesystem operations.
 * [OUTPUT]: Restores files atomically and prunes empty managed parent directories while rejecting links, worktrees and changed identities.
 * [POS]: Home write boundary; only same-name manifest files are replaced, and extra local files remain intact.
 */
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import { lstat, mkdir, open, realpath, rename, rmdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { HOME_RESTORE_TEMP_PREFIX, homePathSchema, homeEntrySchema, type HomeEntry } from "@ai-chat/cloud-protocol/chats/home/model";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { syncDirectory } from "../../../persistence/durable-json";
export type HomeTarget = { root: string; worktree?: string; verify(): Promise<void> };
const same = (a: Stats, b: Stats) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
async function optionalStat(path: string) { try { return await lstat(path); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; return null; } }
async function parents(target: HomeTarget, relative: string) {
  let path = target.root;
  const identities: { path: string; stat: Stats }[] = [];
  for (const segment of relative.split("/").slice(0, -1)) {
    await target.verify(); path = join(path, segment);
    let created = true;
    await mkdir(path, { mode: 0o700 }).catch(error => { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; created = false; });
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error("HOME_RESTORE_UNSAFE_PATH");
    if (created) await syncDirectory(dirname(path));
    identities.push({ path, stat });
  }
  return async () => {
    await target.verify();
    for (const parent of identities) {
      const now = await lstat(parent.path);
      if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== parent.stat.dev || now.ino !== parent.stat.ino ||
        await realpath(parent.path) !== parent.path) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
    }
  };
}
export async function restoreHomeFile(target: HomeTarget, snapshotId: string, entry: Extract<HomeEntry, { kind: "file" }>,
  sourcePath: string, signal: AbortSignal) {
  entry = homeEntrySchema.parse(entry) as Extract<HomeEntry, { kind: "file" }>;
  if (entry.kind !== "file") throw new Error("HOME_RESTORE_INVALID_ENTRY");
  signal.throwIfAborted(); await target.verify();
  if (target.worktree && (entry.path === target.worktree || entry.path.startsWith(target.worktree + "/"))) throw new Error("HOME_WORKTREE_PROTECTED");
  const verify = await parents(target, entry.path), destination = join(target.root, entry.path), before = await optionalStat(destination);
  if (before && (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1)) throw new Error("HOME_RESTORE_UNSAFE_PATH");
  const directory = dirname(destination), temporary = join(directory, HOME_RESTORE_TEMP_PREFIX + hashChatContent([snapshotId, entry]));
  // The reserved temporary namespace is excluded from both upload scans and portable manifests.
  const orphan = await optionalStat(temporary);
  if (orphan) {
    if (!orphan.isFile() || orphan.isSymbolicLink() || orphan.nlink !== 1) throw new Error("HOME_RESTORE_UNSAFE_PATH");
    await verify(); await unlink(temporary);
  }
  const source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  let output: Awaited<ReturnType<typeof open>> | null = null, created = false;
  try {
    const sourceBefore = await source.stat();
    if (!sourceBefore.isFile() || sourceBefore.size !== entry.blob.bytes) throw new Error("HOME_RESTORE_SOURCE_CHANGED");
    await verify(); output = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); created = true;
    const hash = createHash("sha256"), buffer = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, entry.blob.bytes)));
    for (let offset = 0; offset < entry.blob.bytes;) {
      signal.throwIfAborted();
      const { bytesRead } = await source.read(buffer, 0, Math.min(buffer.length, entry.blob.bytes - offset), offset);
      if (!bytesRead) throw new Error("HOME_RESTORE_SOURCE_CHANGED"); hash.update(buffer.subarray(0, bytesRead));
      for (let written = 0; written < bytesRead;) { const part = await output.write(buffer, written, bytesRead - written); if (!part.bytesWritten) throw new Error("HOME_RESTORE_WRITE_FAILED"); written += part.bytesWritten; }
      offset += bytesRead;
    }
    if (!same(sourceBefore, await source.stat()) || hash.digest("hex") !== entry.blob.sha256) throw new Error("HOME_RESTORE_SOURCE_CHANGED");
    await output.chmod(entry.mode); await output.sync(); await output.close(); output = null;
    signal.throwIfAborted(); await verify();
    const now = await optionalStat(destination);
    if (before ? !now || !same(before, now) || now.isSymbolicLink() || now.nlink !== 1 : now !== null) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
    await rename(temporary, destination); created = false; await syncDirectory(directory); await verify();
  } finally {
    await source.close(); await output?.close();
    if (created && await verify().then(() => true, () => false)) {
      await unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
    }
  }
}

/** Delete only a previously managed regular file after revalidating every existing parent. */
export async function removeManagedHomeFile(target: HomeTarget, relative: string, signal: AbortSignal, retainedParent = false) {
  relative = homePathSchema.parse(relative); signal.throwIfAborted(); await target.verify();
  if (target.worktree && (relative === target.worktree || relative.startsWith(target.worktree + "/"))) throw new Error("HOME_WORKTREE_PROTECTED");
  const path = join(target.root, relative);
  let parent = target.root;
  for (const segment of relative.split("/").slice(0, -1)) {
    parent = join(parent, segment); const stat = await optionalStat(parent);
    if (!stat) return;
    if (stat.isFile() && stat.nlink === 1) return; // A completed parent-file replacement makes this old descendant absent.
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(parent) !== parent) throw new Error("HOME_RESTORE_UNSAFE_PATH");
  }
  const before = await optionalStat(path); if (!before) return;
  if (retainedParent && before.isDirectory() && !before.isSymbolicLink() && await realpath(path) === path) return;
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw new Error("HOME_RESTORE_UNSAFE_PATH");
  const verify = await parents(target, relative);
  signal.throwIfAborted(); await verify();
  const current = await optionalStat(path);
  if (!current || !same(before, current)) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
  await unlink(path); await syncDirectory(dirname(path)); await verify();
}

/** Only empty ancestors of removed managed files may be pruned; never recurse into local extras. */
export async function pruneManagedHomeDirectories(target: HomeTarget, removed: string[], signal: AbortSignal) {
  const candidates = new Set(removed.flatMap(relative => {
    const parts = homePathSchema.parse(relative).split("/");
    return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
  }));
  for (const relative of [...candidates].sort((a, b) => b.split("/").length - a.split("/").length)) {
    signal.throwIfAborted(); await target.verify();
    if (target.worktree && (relative === target.worktree || relative.startsWith(target.worktree + "/"))) throw new Error("HOME_WORKTREE_PROTECTED");
    let path = target.root, directory = true;
    const identities: { path: string; stat: Stats }[] = [];
    for (const segment of relative.split("/")) {
      path = join(path, segment); const stat = await optionalStat(path);
      if (!stat || stat.isFile() && stat.nlink === 1) { directory = false; break; }
      if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(path) !== path) throw new Error("HOME_RESTORE_UNSAFE_PATH");
      identities.push({ path, stat });
    }
    if (!directory) continue;
    signal.throwIfAborted(); await target.verify();
    for (const item of identities) {
      const now = await lstat(item.path);
      if (!now.isDirectory() || now.isSymbolicLink() || now.dev !== item.stat.dev || now.ino !== item.stat.ino || await realpath(item.path) !== item.path) throw new Error("HOME_RESTORE_DESTINATION_CHANGED");
    }
    await rmdir(path).then(() => syncDirectory(dirname(path)), error => {
      if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    });
  }
}
