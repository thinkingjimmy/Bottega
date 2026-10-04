/**
 * [INPUT]: Depends on exact Node filesystem identities and no-follow file handles.
 * [OUTPUT]: Provides nanosecond file fingerprints and handles fenced against source-path replacement.
 * [POS]: Local-only Home capture evidence; these values never enter portable manifests or cloud operations.
 */
import { constants, type BigIntStats } from "node:fs";
import { lstat, open, realpath, statfs } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HomeFile } from "../scan";

export function fileFingerprint(stat: BigIntStats) {
  if (!stat.isFile() || stat.nlink !== 1n) throw new Error("HOME_SOURCE_CHANGED");
  return [stat.dev, stat.ino, stat.size, stat.mode, stat.mtimeNs, stat.ctimeNs, stat.birthtimeNs].join(":");
}

export function preciseFileIdentity(stat: BigIntStats) {
  return stat.dev > 0n && stat.ino > 0n && stat.ctimeNs > 0n && stat.birthtimeNs > 0n && stat.ctimeNs % 1_000_000n !== 0n;
}

export async function supportsFileIdentity(root: string) {
  const type = (await statfs(root, { bigint: true })).type;
  // Network and coarse-timestamp filesystems cannot establish local unchanged-byte evidence.
  return process.platform === "darwin" && type === 26n || process.platform === "linux" && [0xef53n, 0x58465342n, 0x9123683en].includes(type);
}

export async function openHomeFile(root: string, file: HomeFile) {
  const path = join(root, file.path), parent = dirname(path);
  if (await realpath(parent) !== parent) throw new Error("HOME_IDENTITY_CHANGED");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  const verify = async () => {
    const stat = await handle.stat({ bigint: true }), current = await lstat(path, { bigint: true });
    if (fileFingerprint(stat) !== file.identity || fileFingerprint(current) !== file.identity || await realpath(parent) !== parent) {
      throw new Error("HOME_SOURCE_CHANGED");
    }
  };
  try { await verify(); return { handle, verify }; }
  catch (error) { await handle.close(); throw error; }
}
