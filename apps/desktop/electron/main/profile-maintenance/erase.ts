/**
 * [INPUT]: Depends on Node filesystem primitives only, so the entry files can import it before Electron opens anything in userData.
 * [OUTPUT]: Provides ERASE_MARKER, wipeRequestedProfile, finishErase and sweepErasedProfile: the parts of "erase all data on this computer" that run after the restart.
 * [POS]: Profile lifetime boundary; request.ts writes the marker in the running app, the wipe runs in the next process before the single-instance lock (renaming entries out of userData, never throwing, skipped while another live process holds the profile), the folder is retired once Electron is ready, and the renamed data is deleted in the background before the marker goes.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, writeFileSync } from "node:fs";
import { chmod, lstat, readdir, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join } from "node:path";

export const ERASE_MARKER = "erase-requested.json";

/* What the wipe leaves: Chromium's process-singleton files (the lock the next step takes), the
   request itself until the folder has been retired, and the cloud development root's sibling
   profiles, which are other profiles rather than this one's data. */
const kept = (name: string) => name === ERASE_MARKER || name.startsWith("Singleton") || name === "profiles";

/* `wiped` and `folderAttempted` make the marker two-phase: the wipe and the folder retirement each run once,
   while the marker itself stays until the renamed data is really gone (F-23). */
type EraseRequest = { version: 1; folder: string | null; requestedAt: number; wiped?: boolean; folderAttempted?: boolean; failed?: string[] };

function readRequest(userData: string): EraseRequest | null {
  const path = join(userData, ERASE_MARKER);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<EraseRequest>;
    return { version: 1, folder: typeof value.folder === "string" && isAbsolute(value.folder) ? value.folder : null, requestedAt: Number(value.requestedAt) || 0,
      wiped: value.wiped === true, folderAttempted: value.folderAttempted === true,
      failed: Array.isArray(value.failed) ? value.failed.filter((name): name is string => typeof name === "string") : [] };
  } catch {
    // The request exists, so erasing is still what the person asked for; only the folder is unknown.
    return { version: 1, folder: null, requestedAt: 0 };
  }
}

const ERASED_SUFFIX = ".erased-";
const writeRequest = (userData: string, request: EraseRequest) => writeFileSync(join(userData, ERASE_MARKER), JSON.stringify(request) + "\n", { mode: 0o600 });

/* Chromium's SingletonLock names `host-pid`; a live Bottega still using this profile must not have it renamed away (F-42). */
function heldByAnotherProcess(userData: string) {
  try {
    const pid = Number(readlinkSync(join(userData, "SingletonLock")).split("-").at(-1));
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

/* App generations are sealed read-only (0500 directories), which a plain recursive delete cannot
   enter. Only real directories are reopened; a symlink is never followed out of the tree. */
async function unsealAsync(path: string): Promise<void> {
  const info = await lstat(path).catch(() => null);
  if (!info?.isDirectory()) return;
  await chmod(path, 0o700).catch(() => undefined);
  for (const name of await readdir(path).catch(() => [] as string[])) await unsealAsync(join(path, name));
}
async function removeTreeAsync(path: string) {
  try { await rm(path, { recursive: true, force: true, maxRetries: 3 }); return; } catch { /* Sealed or still being written. */ }
  try { await unsealAsync(path); await rm(path, { recursive: true, force: true, maxRetries: 3 }); }
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
  const request = readRequest(userData);
  if (!request || request.wiped || heldByAnotherProcess(userData)) return false;
  const failed: string[] = [];
  try {
    const erased = `${userData}${ERASED_SUFFIX}${Date.now()}`;
    mkdirSync(erased, { mode: 0o700 });
    for (const name of readdirSync(userData)) {
      if (kept(name)) continue;
      try { renameSync(join(userData, name), join(erased, name)); }
      catch (cause) { failed.push(name); console.warn(`[erase] could not remove ${name}`, cause); }
    }
    /* Renaming is instant; deleting a large profile is not, so it happens in finishErase once the window is up. */
  } catch (cause) { console.warn("[erase] this profile could not be erased", cause); }
  try { writeRequest(userData, { ...request, wiped: true, failed }); }
  catch (cause) { console.warn("[erase] erase progress not recorded", cause); }
  return true;
}

/**
 * Retiring the folder needs the Trash, which needs Electron; it is tried once, so a folder the person
 * picks again later is never sent to the Trash by a stale request. The renamed profile is deleted in
 * the background by sweepErasedProfile, and the marker goes only when nothing of it is left (F-23).
 */
export async function finishErase(userData: string, trash: (path: string) => Promise<boolean>) {
  const request = readRequest(userData);
  if (!request || !request.wiped) return;
  if (!request.folderAttempted) {
    if (request.folder && existsSync(request.folder) && !await trash(request.folder)) {
      console.warn(`[erase] the Bottega folder could not be moved to the Trash: ${request.folder}`);
    }
    try { writeRequest(userData, { ...request, folderAttempted: true }); } catch { /* Tried again next launch. */ }
  }
}

/** Deletes the renamed profile; the caller starts it after the window opens instead of waiting on it. */
export async function sweepErasedProfile(userData: string) {
  const request = readRequest(userData);
  if (!request?.wiped) return;
  const prefix = `${basename(userData)}${ERASED_SUFFIX}`;
  const parent = dirname(userData);
  for (const name of await readdir(parent).catch(() => [] as string[])) {
    if (name.startsWith(prefix)) await removeTreeAsync(join(parent, name));
  }
  const left = (await readdir(parent).catch(() => [] as string[])).some(name => name.startsWith(prefix));
  if (!left) await rm(join(userData, ERASE_MARKER), { force: true });
}
