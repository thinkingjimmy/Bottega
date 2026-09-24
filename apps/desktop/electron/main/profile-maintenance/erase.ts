/**
 * [INPUT]: Depends on Node filesystem primitives only, so the entry files can import it before Electron opens anything in userData.
 * [OUTPUT]: Provides ERASE_MARKER, wipeRequestedProfile and finishErase: the halves of "erase all data on this computer" that run after the restart.
 * [POS]: Profile lifetime boundary; request.ts writes the marker in the running app, the wipe runs in the next process before the single-instance lock (renaming entries out of userData, never throwing), and the folder is retired once Electron is ready.
 */
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

export const ERASE_MARKER = "erase-requested.json";

/* What the wipe leaves: Chromium's process-singleton files (the lock the next step takes), the
   request itself until the folder has been retired, and the cloud development root's sibling
   profiles, which are other profiles rather than this one's data. */
const kept = (name: string) => name === ERASE_MARKER || name.startsWith("Singleton") || name === "profiles";

type EraseRequest = { version: 1; folder: string | null; requestedAt: number };

function readRequest(userData: string): EraseRequest | null {
  const path = join(userData, ERASE_MARKER);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<EraseRequest>;
    return { version: 1, folder: typeof value.folder === "string" && value.folder.startsWith("/") ? value.folder : null, requestedAt: Number(value.requestedAt) || 0 };
  } catch {
    // The request exists, so erasing is still what the person asked for; only the folder is unknown.
    return { version: 1, folder: null, requestedAt: 0 };
  }
}

const ERASED_SUFFIX = ".erased-";

/* App generations are sealed read-only (0500 directories), which a plain recursive delete cannot
   enter. Only real directories are reopened; a symlink is never followed out of the tree. */
function unseal(path: string) {
  if (!lstatSync(path).isDirectory()) return;
  chmodSync(path, 0o700);
  for (const name of readdirSync(path)) unseal(join(path, name));
}

function removeTree(path: string) {
  try { rmSync(path, { recursive: true, force: true, maxRetries: 3 }); return; } catch { /* Sealed or still being written. */ }
  try { unseal(path); rmSync(path, { recursive: true, force: true, maxRetries: 3 }); }
  catch (cause) { console.warn(`[erase] left for the next pass: ${path}`, cause); }
}

/**
 * Runs synchronously from the entry file, before the compile cache, the single-instance lock or any
 * store touches userData. Each entry is first renamed out into a sibling directory — atomic, and
 * immune to a straggling process still writing into it — so the new profile can never read the old
 * one even when the delete that follows cannot finish; finishErase sweeps what it leaves.
 * It never throws: a launch that cannot erase must still open, not die before its first window.
 */
export function wipeRequestedProfile(userData: string) {
  if (!readRequest(userData)) return false;
  try {
    const erased = `${userData}${ERASED_SUFFIX}${Date.now()}`;
    mkdirSync(erased, { mode: 0o700 });
    for (const name of readdirSync(userData)) {
      if (kept(name)) continue;
      try { renameSync(join(userData, name), join(erased, name)); }
      catch (cause) { console.warn(`[erase] could not remove ${name}`, cause); }
    }
    removeTree(erased);
  } catch (cause) { console.warn("[erase] this profile could not be erased", cause); }
  return true;
}

/** Retiring the folder needs the Trash, which needs Electron; a folder that cannot be moved stays where it is. */
export async function finishErase(userData: string, trash: (path: string) => Promise<boolean>) {
  const request = readRequest(userData);
  if (!request) return;
  const prefix = `${basename(userData)}${ERASED_SUFFIX}`;
  for (const name of await readdir(dirname(userData)).catch(() => [] as string[])) {
    if (name.startsWith(prefix)) removeTree(join(dirname(userData), name));
  }
  if (request.folder && existsSync(request.folder) && !await trash(request.folder)) {
    console.warn(`[erase] the Bottega folder could not be moved to the Trash: ${request.folder}`);
  }
  await rm(join(userData, ERASE_MARKER), { force: true });
}
