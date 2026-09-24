/**
 * [INPUT]: Depends on the relocation journal, the unfinished-work check, folder transfer, the Chat Home and database rewrites, folder identity and an injected settings/Trash/Git port set.
 * [OUTPUT]: Provides completeRelocation: performs a pending move or adopt before the folder is opened and reports one outcome.
 * [POS]: Startup step that runs before LibraryService.initialize, so a folder mid-move is never mistaken for a deleted one.
 */
import { lstat } from "node:fs/promises";
import { readLibraryIdentity } from "../identity";
import { clearRelocation, readRelocation, type Relocation } from "./journal";
import { unfinishedWork } from "./work";
import { transferFolder } from "./transfer";
import { managedWorktrees, rebaseChatHomes } from "./homes";
import { rebaseDatabasePaths } from "./database";

export type RelocationPorts = {
  userData: string;
  settings: { setTrusted(patch: { libraryRoot?: string | null; libraryId?: string | null; chatHomesRoot?: string | null }): Promise<unknown> };
  trash(path: string): Promise<boolean>;
  /** Runs `git worktree repair` inside one managed worktree; failures are the caller's to log. */
  repairWorktree(path: string): Promise<void>;
  progress?(completed: number, total: number): void;
};

export type RelocationOutcome =
  | { status: "none" }
  | { status: "moved"; root: string; sourceLeft: string | null }
  | { status: "deferred"; reasons: string[] }
  /** `root` is where the folder is now: `from` when it never left, `to` when only the rewrites are left to retry. */
  | { status: "failed"; error: string; root: string };

const present = (path: string) => lstat(path).then(() => true, () => false);

export async function completeRelocation(ports: RelocationPorts): Promise<RelocationOutcome> {
  const journal = await readRelocation(ports.userData);
  if (!journal) return { status: "none" };
  const verify = async (path: string) => {
    const identity = await readLibraryIdentity(path);
    return !!identity && (journal.libraryId === null || identity.libraryId === journal.libraryId);
  };

  let sourceLeft: string | null = null;
  if (journal.kind === "move") {
    /* Work still in flight is finished by its owner at its old address. A move that has not
       started yet waits for a later launch; one that already started must be carried through. */
    if (!await present(journal.to)) {
      const reasons = await unfinishedWork(ports.userData);
      if (reasons.length) { await clearRelocation(ports.userData); return { status: "deferred", reasons }; }
    }
    try {
      const result = await transferFolder(journal.from, journal.to, { verify, trash: ports.trash, progress: ports.progress });
      if (result.sourceLeft) sourceLeft = journal.from;
    } catch (error) {
      // Only retiring the old copy failed: the folder already stands at `to`, so its records follow it.
      if (await verify(journal.to)) return follow(journal, ports, await present(journal.from) ? journal.from : null);
      // Otherwise the folder never left `from`, and nothing else has to follow it.
      await clearRelocation(ports.userData);
      return { status: "failed", error: describe(error), root: journal.from };
    }
  } else if (!await verify(journal.to)) {
    await clearRelocation(ports.userData);
    return { status: "failed", error: "LIBRARY_ADOPT_IDENTITY_MISMATCH", root: journal.from };
  }
  return follow(journal, ports, sourceLeft);
}

/* From here the folder lives at `to`. Settings point there first, so even an interrupted rewrite
   leaves a folder this profile opens, and the journal stays until every rewrite has landed:
   each of them is idempotent, so the next launch simply runs them again. */
async function follow(journal: Relocation, ports: RelocationPorts, sourceLeft: string | null): Promise<RelocationOutcome> {
  const identity = await readLibraryIdentity(journal.to);
  await ports.settings.setTrusted({ libraryRoot: journal.to, chatHomesRoot: journal.to, libraryId: identity?.libraryId ?? journal.libraryId });
  try {
    await rebaseChatHomes(ports.userData, journal.from, journal.to);
    await rebaseDatabasePaths(ports.userData, journal.from, journal.to);
  } catch (error) { return { status: "failed", error: describe(error), root: journal.to }; }
  for (const worktree of await managedWorktrees(ports.userData, journal.to)) {
    await ports.repairWorktree(worktree).catch(error => console.warn(`[library] worktree repair failed: ${worktree}: ${describe(error)}`));
  }
  await clearRelocation(ports.userData);
  return { status: "moved", root: journal.to, sourceLeft };
}

const describe = (error: unknown) => error instanceof Error ? error.message : String(error);
