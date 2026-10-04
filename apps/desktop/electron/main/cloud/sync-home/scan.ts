/**
 * [INPUT]: Depends on verified Chat Home ownership and exact Node filesystem metadata reads.
 * [OUTPUT]: Enumerates bounded files, nanosecond reuse evidence and explicit omissions, excluding build/worktree data and internal restore temporaries.
 * [POS]: Shared Home scanner for first-sync review and snapshot capture; repository worktrees never enter its file list.
 */
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";
import { MAX_BLOB_BYTES } from "@ai-chat/cloud-protocol";
import { HOME_RESTORE_TEMP_PREFIX, MAX_HOME_BYTES, MAX_HOME_ENTRIES } from "@ai-chat/cloud-protocol/chats/home/model";
import { fileFingerprint, preciseFileIdentity, supportsFileIdentity } from "./incremental/identity";
export { MAX_HOME_BYTES, MAX_HOME_ENTRIES } from "@ai-chat/cloud-protocol/chats/home/model";
const excluded = new Set(["node_modules", ".git", ".venv", "__pycache__", "dist", "build", "target", ".ai-chat-home.json"]);
export type HomeFile = { path: string; bytes: number; identity: string; reusable: boolean; mode: 420 | 493 };
type HomeOmission = { path: string; reason: "file-too-large" | "home-too-large" | "unsupported-file" | "unreadable" };
export async function scanHomeFiles(root: string, worktree: string | undefined, signal: AbortSignal) {
  signal.throwIfAborted();
  const original = await lstat(root, { bigint: true });
  if (!original.isDirectory() || original.isSymbolicLink()) throw new Error("HOME_IDENTITY_CHANGED");
  root = await realpath(root);
  const reusable = await supportsFileIdentity(root).catch(() => false);
  const files: HomeFile[] = [], omitted: HomeOmission[] = [];
  let bytes = 0, visited = 0;
  const verify = async () => { const current = await lstat(root, { bigint: true });
    if (current.dev !== original.dev || current.ino !== original.ino || current.isSymbolicLink()) throw new Error("HOME_IDENTITY_CHANGED"); };
  const walk = async (relative: string) => {
    signal.throwIfAborted(); await verify();
    const directory = join(root, relative);
    if (await realpath(directory) !== directory) throw new Error("HOME_IDENTITY_CHANGED");
    const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of entries) {
      signal.throwIfAborted();
      const path = relative ? `${relative}/${entry.name}` : entry.name;
      if (excluded.has(entry.name.toLowerCase()) || entry.name.toLowerCase().endsWith(".log") || entry.name.toLowerCase().startsWith(HOME_RESTORE_TEMP_PREFIX) || path === worktree) continue;
      if (++visited > MAX_HOME_ENTRIES || path.length > 1024 || path.split("/").length > 32) throw new Error("HOME_INVENTORY_LIMIT");
      if (entry.isSymbolicLink() || !entry.isDirectory() && !entry.isFile()) { omitted.push({ path, reason: "unsupported-file" }); continue; }
      if (entry.isDirectory()) { await walk(path); continue; }
      try {
        const metadata = await lstat(join(root, path), { bigint: true });
        if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1n) { omitted.push({ path, reason: "unsupported-file" }); continue; }
        if (metadata.size > BigInt(MAX_BLOB_BYTES)) { omitted.push({ path, reason: "file-too-large" }); continue; }
        const size = Number(metadata.size);
        if (bytes + size > MAX_HOME_BYTES) { omitted.push({ path, reason: "home-too-large" }); continue; }
        files.push({ path, bytes: size, identity: fileFingerprint(metadata), reusable: reusable && preciseFileIdentity(metadata),
          mode: metadata.mode & 0o111n ? 493 : 420 }); bytes += size;
      } catch (error) {
        if (!["ENOENT", "EACCES", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        omitted.push({ path, reason: "unreadable" });
      }
    }
  };
  await walk(""); await verify(); signal.throwIfAborted(); return { files, bytes, omitted };
}
