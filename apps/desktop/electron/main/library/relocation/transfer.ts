/**
 * [INPUT]: Depends on Node filesystem rename/copy/walk primitives and an injected "move to Trash" port.
 * [OUTPUT]: Provides transferFolder (carries a folder to a new path by rename, or by a verified copy across volumes, resuming wherever an earlier launch stopped) and copyAcross, its cross-volume half: it stops at the next file when cancelled (abandonCopy then removes its own claimed staging copy), removes only its own claimed staging copy, unseals before cleanup without masking the real error, and retires the identity of an old copy the Trash refused.
 * [POS]: Relocation's only file-moving step; it never deletes a source outright, it hands it to the system Trash.
 */
import { chmod, cp, lstat, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { isErrnoCode } from "../../persistence/durable-json";

export type TransferPorts = {
  /** True when the folder at this path is the one being moved; nothing is retired on the word of a stranger. */
  verify(path: string): Promise<boolean>;
  /** Moves the old copy to the system Trash; resolves false when it could not, which leaves it in place. */
  trash(path: string): Promise<boolean>;
  progress?(completed: number, total: number): void;
  /** The person cancelled: a copy across volumes stops at the next file and removes its own staging copy (F-24). */
  signal?: AbortSignal;
};

export const MOVE_CANCELLED = "LIBRARY_MOVE_CANCELLED";

export type TransferResult = { kind: "renamed" | "copied" | "already-moved"; sourceLeft: boolean };

const staging = (to: string) => `${to}.bottega-moving`;
/* Names the source a staging copy belongs to, so a later launch removes only its own half-finished copy. */
const claim = (to: string) => `${staging(to)}.claim`;
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
    const sourceLeft = source && !await ports.trash(from);
    if (sourceLeft) await retireIdentity(from);
    return { kind: "already-moved", sourceLeft };
  }
  if (!source) throw new Error("LIBRARY_MOVE_SOURCE_MISSING");
  try { await rename(from, to); return { kind: "renamed", sourceLeft: false }; }
  catch (error) { if (!isErrnoCode(error, "EXDEV")) throw error; }
  return copyAcross(from, to, ports);
}

/* Sealed App output is read-only, and a failed rm used to replace the mismatch that caused it (F-43). */
async function unseal(path: string): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (!info || info.isSymbolicLink()) return;
  await chmod(path, info.isDirectory() ? 0o700 : 0o600).catch(() => undefined);
  if (info.isDirectory()) for (const name of await readdir(path).catch(() => [])) await unseal(join(path, name));
}
async function discard(copy: string) {
  try { await unseal(copy); await rm(copy, { recursive: true, force: true }); }
  catch (error) { console.warn(`[library] staging copy left behind: ${copy}: ${error instanceof Error ? error.message : String(error)}`); }
}

/* An old copy the Trash would not take must stop claiming the moved folder's identity, or two folders answer to one Library (F-43). */
async function retireIdentity(from: string) {
  await rename(join(from, ".bottega", "library.json"), join(from, ".bottega", "library.moved.json")).catch(error => {
    console.warn(`[library] old copy keeps its identity: ${from}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/** The cross-volume half, exported so it can be exercised without two real volumes. */
export async function copyAcross(from: string, to: string, ports: TransferPorts): Promise<TransferResult> {
  const copy = staging(to);
  if (await exists(copy)) {
    // Only this move's own interrupted copy is removed; a folder someone else put there is left alone.
    if (await readFile(claim(to), "utf8").catch(() => null) !== from) throw new Error("LIBRARY_MOVE_STAGING_OCCUPIED");
    await discard(copy);
    if (await exists(copy)) throw new Error("LIBRARY_MOVE_STAGING_OCCUPIED");
  }
  await writeFile(claim(to), from, { mode: 0o600 });
  // Counting a large folder takes a while too; the window opens now rather than after it (F-24).
  ports.progress?.(0, 0);
  /* Cancelling ends the copy at the next file; only this move's own staging copy goes, the source is never touched. */
  const stopIfCancelled = async () => {
    if (!ports.signal?.aborted) return;
    await abandonCopy(from, to);
    throw new Error(MOVE_CANCELLED);
  };
  const expected = await inventory(from);
  await stopIfCancelled();
  let completed = 0;
  ports.progress?.(0, expected.size);
  try {
    await cp(from, copy, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true, verbatimSymlinks: true,
      filter: () => {
        if (ports.signal?.aborted) throw new Error(MOVE_CANCELLED);
        ports.progress?.(Math.min(++completed, expected.size), expected.size); return true;
      } });
  } catch (error) { await stopIfCancelled(); throw error; }
  await stopIfCancelled();
  const actual = await inventory(copy);
  for (const [path, size] of expected) {
    if (actual.get(path) !== size) { await discard(copy); throw new Error(`LIBRARY_MOVE_COPY_MISMATCH: ${path}`); }
  }
  if (!await ports.verify(copy)) { await discard(copy); throw new Error("LIBRARY_MOVE_COPY_MISMATCH"); }
  // Past this rename the folder has moved; a cancel that arrives now is too late and the move completes.
  await stopIfCancelled();
  await rename(copy, to);
  await rm(claim(to), { force: true });
  const sourceLeft = !await ports.trash(from);
  if (sourceLeft) await retireIdentity(from);
  return { kind: "copied", sourceLeft };
}

/** Removes this move's own staging copy and its claim, if any; a copy someone else put there stays. */
export async function abandonCopy(from: string, to: string) {
  if (await readFile(claim(to), "utf8").catch(() => null) !== from) return;
  await discard(staging(to));
  await rm(claim(to), { force: true });
}
