/**
 * [INPUT]: Depends on Node filesystem probes and the shared containment test.
 * [OUTPUT]: Provides planLibraryMove and LibraryMoveError: the destination a chosen location resolves to, or the one reason it cannot take the folder.
 * [POS]: Request-time admission in the running app; the next launch re-checks only what can change in between (work in flight, the folder's identity).
 */
import { lstat, mkdtemp, realpath, rmdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { isErrnoCode } from "../../persistence/durable-json";
import { isUnder } from "../paths";

export const LIBRARY_MOVE_ERRORS = ["same-place", "inside", "exists", "unwritable", "project-overlap", "busy"] as const;
export type LibraryMoveErrorCode = (typeof LIBRARY_MOVE_ERRORS)[number];

export class LibraryMoveError extends Error {
  override name = "LibraryMoveError";
  constructor(readonly code: LibraryMoveErrorCode) { super(`LIBRARY_MOVE_${code.replaceAll("-", "_").toUpperCase()}`); }
}

/**
 * The person picks where the folder should live; it keeps its own name there, so a move
 * never silently renames it and a destination that already holds something is refused
 * rather than merged into.
 */
export async function planLibraryMove(input: { root: string; parent: string; projectDirs: Iterable<string> }) {
  const parent = await realpath(input.parent);
  const to = join(parent, basename(input.root));
  if (to === input.root) throw new LibraryMoveError("same-place");
  if (isUnder(to, input.root)) throw new LibraryMoveError("inside");
  const taken = await lstat(to).then(() => true, error => { if (isErrnoCode(error, "ENOENT")) return false; throw error; });
  if (taken) throw new LibraryMoveError("exists");
  /* A Project folder on disk must stay disjoint from the Bottega folder; those inside the folder move with it. */
  for (const directory of input.projectDirs) {
    if (!directory || isUnder(directory, input.root)) continue;
    if (isUnder(to, directory) || isUnder(directory, to)) throw new LibraryMoveError("project-overlap");
  }
  let probe: string | undefined;
  try { probe = await mkdtemp(join(parent, ".bottega-write-")); }
  catch { throw new LibraryMoveError("unwritable"); }
  finally { if (probe) await rmdir(probe).catch(() => undefined); }
  return to;
}
