/**
 * [INPUT]: Depends on Node filesystem rename/copy/walk primitives and an injected "move to Trash" port.
 * [OUTPUT]: Provides transferFolder (carries a folder to a new path by rename, or by a verified copy across volumes, resuming wherever an earlier launch stopped) and copyAcross, its cross-volume half.
 * [POS]: Relocation's only file-moving step; it never deletes a source outright, it hands it to the system Trash.
 */
import { cp, lstat, readdir, rename, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { isErrnoCode } from "../../persistence/durable-json";

export type TransferPorts = {
  /** True when the folder at this path is the one being moved; nothing is retired on the word of a stranger. */
  verify(path: string): Promise<boolean>;
  /** Moves the old copy to the system Trash; resolves false when it could not, which leaves it in place. */
  trash(path: string): Promise<boolean>;
  progress?(completed: number, total: number): void;
};

export type TransferResult = { kind: "renamed" | "copied" | "already-moved"; sourceLeft: boolean };

const staging = (to: string) => `${to}.bottega-moving`;
const exists = (path: string) => lstat(path).then(() => true, error => { if (isErrnoCode(error, "ENOENT")) return false; throw error; });

/** Relative path → byte size for regular files, `-1` for directories and symlinks; enough to prove a copy is whole. */
async function inventory(root: string) {
  const entries = new Map<string, number>();
  const walk = async (directory: string) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) { entries.set(relative(root, path), -1); await walk(path); }
      else entries.set(relative(root, path), entry.isFile() ? (await lstat(path)).size : -1);
    }
  };
  await walk(root);
  return entries;
}

/* The source is only ever retired once `to` exists, and `to` only ever appears by the final
   rename of a copy that already matched the source file for file. So a launch that finds
   both paths knows the copy is complete and only the source's retirement is left. */
export async function transferFolder(from: string, to: string, ports: TransferPorts): Promise<TransferResult> {
  const [source, target] = await Promise.all([exists(from), exists(to)]);
  if (target) {
    if (!await ports.verify(to)) throw new Error("LIBRARY_MOVE_TARGET_FOREIGN");
    return { kind: "already-moved", sourceLeft: source && !await ports.trash(from) };
  }
  if (!source) throw new Error("LIBRARY_MOVE_SOURCE_MISSING");
  try { await rename(from, to); return { kind: "renamed", sourceLeft: false }; }
  catch (error) { if (!isErrnoCode(error, "EXDEV")) throw error; }
  return copyAcross(from, to, ports);
}

/** The cross-volume half, exported so it can be exercised without two real volumes. */
export async function copyAcross(from: string, to: string, ports: TransferPorts): Promise<TransferResult> {
  const copy = staging(to);
  await rm(copy, { recursive: true, force: true });
  const expected = await inventory(from);
  let completed = 0;
  ports.progress?.(0, expected.size);
  await cp(from, copy, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true,
    filter: () => { ports.progress?.(Math.min(++completed, expected.size), expected.size); return true; } });
  const actual = await inventory(copy);
  for (const [path, size] of expected) {
    if (actual.get(path) !== size) { await rm(copy, { recursive: true, force: true }); throw new Error(`LIBRARY_MOVE_COPY_MISMATCH: ${path}`); }
  }
  if (!await ports.verify(copy)) { await rm(copy, { recursive: true, force: true }); throw new Error("LIBRARY_MOVE_COPY_MISMATCH"); }
  await rename(copy, to);
  return { kind: "copied", sourceLeft: !await ports.trash(from) };
}
