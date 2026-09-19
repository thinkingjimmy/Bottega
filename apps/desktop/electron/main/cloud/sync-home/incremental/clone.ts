/**
 * [INPUT]: Depends on verified private source files and native filesystem cloning facilities.
 * [OUTPUT]: Creates an independent, synced retained copy without reading payload bytes through JavaScript.
 * [POS]: Optional Home reuse primitive; unsupported cloning falls back to the original hash-and-freeze path.
 */
import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { copyFile, lstat, open, realpath, statfs, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { fileFingerprint } from "./identity";

const unsupported = new Set(["ENOSYS", "ENOTSUP", "EOPNOTSUPP", "EXDEV", "EINVAL", "ENOENT", "EACCES", "EPERM"]);

export async function cloneHomeBytes(source: string, target: string, expected: string, signal: AbortSignal) {
  signal.throwIfAborted();
  const sourceDirectory = dirname(source), destinationDirectory = dirname(target);
  const fromDirectory = await lstat(sourceDirectory, { bigint: true }), toDirectory = await lstat(destinationDirectory, { bigint: true });
  if (!fromDirectory.isDirectory() || fromDirectory.isSymbolicLink() || !toDirectory.isDirectory() || toDirectory.isSymbolicLink()) throw new Error("HOME_SOURCE_DIRECTORY_CHANGED");
  const parent = await realpath(destinationDirectory), sourceParent = await realpath(sourceDirectory);
  source = join(sourceParent, basename(source)); target = join(parent, basename(target));
  const original = await lstat(source, { bigint: true });
  if (fileFingerprint(original) !== expected) return false;
  try {
    if (process.platform === "darwin") {
      const volume = await statfs(sourceParent, { bigint: true }), destination = await lstat(parent, { bigint: true });
      if (volume.type !== 26n || destination.dev !== original.dev) return false;
      // Node's forced reflink is unavailable on Darwin. The fixed system executable uses clonefile on this APFS volume.
      await new Promise<void>((resolve, reject) => execFile("/bin/cp", ["-c", "-R", "-P", "-n", source, target], { signal },
        error => error ? reject(error) : resolve()));
    } else {
      await copyFile(source, target, constants.COPYFILE_FICLONE_FORCE | constants.COPYFILE_EXCL);
    }
    const output = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const copied = await output.stat({ bigint: true }), current = await lstat(source, { bigint: true });
      const from = await lstat(sourceDirectory, { bigint: true }), to = await lstat(destinationDirectory, { bigint: true });
      if (fileFingerprint(current) !== expected || !copied.isFile() || copied.nlink !== 1n || copied.size !== original.size ||
        from.dev !== fromDirectory.dev || from.ino !== fromDirectory.ino || to.dev !== toDirectory.dev || to.ino !== toDirectory.ino ||
        copied.dev === original.dev && copied.ino === original.ino || await realpath(sourceDirectory) !== sourceParent || await realpath(destinationDirectory) !== parent) {
        throw new Error("HOME_SOURCE_CHANGED");
      }
      signal.throwIfAborted(); await output.sync();
    } finally { await output.close(); }
    return true;
  } catch (error) {
    await unlink(target).catch(cause => { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; });
    signal.throwIfAborted();
    const code = (error as NodeJS.ErrnoException).code;
    if (unsupported.has(code ?? "") || typeof code === "number") return false;
    throw error;
  }
}
