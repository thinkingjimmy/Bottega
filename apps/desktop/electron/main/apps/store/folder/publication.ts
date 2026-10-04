/**
 * [INPUT]: Source/destination directories, byte digests and destination-volume durable publication markers.
 * [OUTPUT]: Recoverable directory moves with a resume-only entry point for caller startup reconciliation.
 * [POS]: Shared App workspace delivery leaf for installation, repair and cloud package publication.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, lstat, mkdir, open, readdir, readFile, readlink, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { durableReplaceFile, isErrnoCode, syncDirectory } from "../../../persistence/durable-json";

async function exists(path: string) {
  try { await lstat(path); return true; } catch (error) { if (isErrnoCode(error, "ENOENT")) return false; throw error; }
}
async function fileDigest(path: string) {
  const hash = createHash("sha256"); for await (const bytes of createReadStream(path)) hash.update(bytes); return hash.digest();
}
async function verifyRemainingSource(source: string, target: string) {
  const from = await lstat(source), to = await lstat(target).catch(() => null);
  if (!to || from.mode !== to.mode || from.isDirectory() !== to.isDirectory() || from.isSymbolicLink() !== to.isSymbolicLink()) throw new Error("APP_WORKSPACE_SOURCE_CHANGED");
  if (from.isDirectory()) {
    for (const name of await readdir(source)) await verifyRemainingSource(join(source, name), join(target, name));
  } else if (from.isSymbolicLink()) {
    if (await readlink(source) !== await readlink(target)) throw new Error("APP_WORKSPACE_SOURCE_CHANGED");
  } else if (!from.isFile() || !to.isFile() || !(await fileDigest(source)).equals(await fileDigest(target))) throw new Error("APP_WORKSPACE_SOURCE_CHANGED");
}
async function treeDigest(root: string, durable = false) {
  const digest = createHash("sha256");
  async function visit(path: string, relative: string) {
    const info = await lstat(path), kind = info.isSymbolicLink() ? "link" : info.isDirectory() ? "directory" : info.isFile() ? "file" : null;
    if (!kind || !relative && kind !== "directory") throw new Error("APP_WORKSPACE_FILE_INVALID");
    digest.update(JSON.stringify([relative, kind, info.mode & 0o777]));
    if (kind === "link") digest.update(JSON.stringify(await readlink(path)));
    else if (kind === "file") {
      digest.update(await fileDigest(path));
      if (durable) { const handle = await open(path, "r"); try { await handle.sync(); } finally { await handle.close(); } }
    } else {
      for (const name of (await readdir(path)).sort()) await visit(join(path, name), relative ? `${relative}/${name}` : name);
      if (durable) await syncDirectory(path);
    }
  }
  await visit(root, ""); return digest.digest("hex");
}
export function directoryPublisher(io = { rename, rm }) {
  const markerPath = (source: string, target: string) => join(dirname(target), `.${basename(target)}.move-${createHash("sha256").update(JSON.stringify([source, target])).digest("hex")}`);
  const publish = async (source: string, target: string) => {
    const parent = dirname(target), marker = markerPath(source, target), staged = `${marker}.staged`;
    await mkdir(parent, { recursive: true, mode: 0o700 });
    if (!await exists(marker)) {
      try { await io.rename(source, target); await syncDirectory(parent); await syncDirectory(dirname(source)); return; }
      catch (error) { if (!isErrnoCode(error, "EXDEV")) throw error; }
      const digest = await treeDigest(source);
      await durableReplaceFile(marker, JSON.stringify({ version: 1, digest }) + "\n");
    }
    const proof = JSON.parse(await readFile(marker, "utf8"));
    if (proof.version !== 1 || !/^[a-f0-9]{64}$/.test(proof.digest) || proof.published !== undefined && proof.published !== true) throw new Error("APP_WORKSPACE_MOVE_INVALID");
    const hasSource = await exists(source);
    if (hasSource && !proof.published && await treeDigest(source) !== proof.digest) throw new Error("APP_WORKSPACE_SOURCE_CHANGED");
    if (!await exists(target)) {
      if (!hasSource || proof.published) throw new Error("APP_WORKSPACE_SOURCE_MISSING");
      await rm(staged, { recursive: true, force: true });
      await cp(source, staged, { recursive: true, preserveTimestamps: true, verbatimSymlinks: true, errorOnExist: true, force: false });
      if (await treeDigest(staged, true) !== proof.digest || await treeDigest(source) !== proof.digest) throw new Error("APP_WORKSPACE_SOURCE_CHANGED");
      await io.rename(staged, target); await syncDirectory(parent);
    }
    if (await treeDigest(target) !== proof.digest) throw new Error("APP_WORKSPACE_DESTINATION_CHANGED");
    if (!proof.published) await durableReplaceFile(marker, JSON.stringify({ ...proof, published: true }) + "\n");
    if (hasSource) {
      // A failed recursive removal can leave a subset; only unchanged bytes already present in the verified target may be removed.
      await verifyRemainingSource(source, target); await io.rm(source, { recursive: true }); await syncDirectory(dirname(source));
    }
    await rm(marker); await syncDirectory(parent);
  };
  return Object.assign(publish, { recover: async (source: string, target: string) => {
    if (!await exists(markerPath(source, target))) return false;
    await publish(source, target); return true;
  } });
}
export const publishDirectory = directoryPublisher();
export type DirectoryPublisher = ReturnType<typeof directoryPublisher>;
