/**
 * [INPUT]: Depends on Node fs/os/path, folder identity, canonical profile paths, containment and LibraryError.
 * [OUTPUT]: Provides folder selection, protected-root and userData overlap admission, suggestions and foreign-entry detection.
 * [POS]: The single folder admission rule for first selection, Locate, Start New, moves and every open; destructive paths re-check it before they act.
 */
import { lstat, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, parse, resolve } from "node:path";
import { isErrnoCode } from "../../persistence/durable-json";
import { LibraryError } from "../errors";
import { readLibraryIdentity } from "../identity";
import { isUnder } from "../paths";

/* Folders people already keep their own files in. Taking one over would put Bottega's `.trash`
   and deletion paths next to (or, on a case-insensitive disk, onto) the person's data. */
const STANDARD_FOLDERS = new Set([
  "applications", "desktop", "documents", "downloads", "library", "movies", "music", "pictures", "public",
  "sites", "videos", "templates", "dropbox", "onedrive", "google drive", "icloud drive", "creative cloud files",
]);
const TRASH_SEGMENTS = new Set([".trash", ".trashes", "$recycle.bin"]);
const VOLUME_PARENT = /^(?:\/Volumes|\/media(?:\/[^/]+)?|\/mnt|\/run\/media\/[^/]+)$/;
/* Written by the OS or Bottega itself; they do not make a folder "someone else's". */
const INCIDENTAL = new Set([".DS_Store", ".localized", "Icon\r", "desktop.ini", "Thumbs.db"]);
const LIBRARY_ENTRIES = new Set([".bottega", ".trash", "apps", "bases", "chats", "projects", "plugins", "skills", ...INCIDENTAL]);

export type LibraryChoice = Readonly<{ root: string; subfolder: boolean }>;

const fold = (value: string) => value.normalize("NFC").toLowerCase();

/** Resolve existing ancestors too: a new destination may be reached through a linked parent. */
async function canonicalDestination(path: string): Promise<string> {
  const absolute = resolve(path);
  try { return await realpath(absolute); }
  catch (error) {
    if (!isErrnoCode(error, "ENOENT")) throw error;
    const parent = dirname(absolute);
    if (parent === absolute) throw error;
    return join(await canonicalDestination(parent), basename(absolute));
  }
}

export async function assertLibraryOutsideUserData(root: string, userData?: string) {
  if (!userData) return;
  const [folder, profile] = await Promise.all([canonicalDestination(root), canonicalDestination(userData)]);
  const left = process.platform === "darwin" ? fold(folder) : folder;
  const right = process.platform === "darwin" ? fold(profile) : profile;
  if (isUnder(left, right) || isUnder(right, left)) {
    throw new LibraryError("unsafe-folder", "LIBRARY_USER_DATA_OVERLAP: Choose a folder outside Bottega settings and runtime data.");
  }
}

async function canonicalHome() {
  return realpath(homedir()).catch(() => homedir());
}

function insideTrash(path: string) {
  return path.split(/[\\/]/).some(segment => TRASH_SEGMENTS.has(fold(segment)));
}

async function mountPoint(path: string) {
  const parent = dirname(path);
  if (VOLUME_PARENT.test(parent)) return true;
  const [own, above] = await Promise.all([stat(path).catch(() => null), stat(parent).catch(() => null)]);
  return !!own && !!above && own.dev !== above.dev;
}

/** A folder no one may take over directly: a volume or system root, the home folder or above it, or a standard user folder. */
async function protectedFolder(path: string, home: string) {
  const root = parse(path).root;
  if (path === root || dirname(path) === root) return true;
  if (fold(path) === fold(home) || isUnder(fold(home), fold(path))) return true;
  if (fold(dirname(path)) === fold(home) && STANDARD_FOLDERS.has(fold(basename(path)))) return true;
  return mountPoint(path);
}

async function directoryState(path: string): Promise<"missing" | "empty" | "library" | "foreign"> {
  const info = await lstat(path).catch(error => { if (isErrnoCode(error, "ENOENT")) return null; throw error; });
  if (!info) return "missing";
  if (!info.isDirectory() || info.isSymbolicLink()) return "foreign";
  if (await readLibraryIdentity(path)) return "library";
  const names = await readdir(path);
  return names.every(name => INCIDENTAL.has(name)) ? "empty" : "foreign";
}

/** Throws unless `root` (already canonical) may be the Bottega folder. */
export async function assertAdmissibleLibraryRoot(root: string, userData?: string) {
  await assertLibraryOutsideUserData(root, userData);
  if (insideTrash(root) || await protectedFolder(root, await canonicalHome())) {
    throw new LibraryError("unsafe-folder", `LIBRARY_UNSAFE_FOLDER: ${root}`);
  }
}

/**
 * The folder a picked directory resolves to. A Bottega folder or an empty folder is used as picked;
 * anything else — a protected folder, or one that already holds someone's files — is offered a new
 * `Bottega` folder inside it, which the caller confirms before it is created.
 */
export async function resolveLibraryChoice(picked: string, userData?: string): Promise<LibraryChoice> {
  const canonical = await realpath(picked);
  await assertLibraryOutsideUserData(canonical, userData);
  const home = await canonicalHome();
  if (insideTrash(canonical)) throw new LibraryError("unsafe-folder", `LIBRARY_UNSAFE_FOLDER: ${canonical}`);
  if (!await protectedFolder(canonical, home)) {
    const state = await directoryState(canonical);
    if (state === "library" || state === "empty") return { root: canonical, subfolder: false };
  }
  const nested = join(canonical, "Bottega");
  await assertLibraryOutsideUserData(nested, userData);
  if (await protectedFolder(nested, home) || await directoryState(nested) === "foreign") {
    throw new LibraryError("unsafe-folder", `LIBRARY_UNSAFE_FOLDER: ${canonical}`);
  }
  return { root: nested, subfolder: true };
}

export type LibrarySuggestion = Readonly<{ path: string; name: string; kind: "fresh" | "occupied" | "found" }>;

/* A cloned repository or any other folder of the person's can already sit at ~/Bottega; the offer
   moves to the next free name instead of opening someone else's folder or nesting inside it. */
const SUGGESTED_NAMES = ["Bottega", "Bottega Library", ...[2, 3, 4, 5].map(n => `Bottega Library ${n}`)];

/** The folder onboarding offers in one click: an existing Bottega folder, else the first missing or empty name. */
export async function suggestLibraryFolder(): Promise<LibrarySuggestion | null> {
  const home = await canonicalHome();
  for (const [index, name] of SUGGESTED_NAMES.entries()) {
    const path = join(home, name);
    const state = await directoryState(path).catch(() => "foreign" as const);
    if (state === "foreign") continue;
    return { path, name, kind: state === "library" ? "found" : index === 0 ? "fresh" : "occupied" };
  }
  return null;
}

/** True when the folder holds entries Bottega did not create, so moving it to the Trash would take them too. */
export async function holdsForeignEntries(root: string) {
  const names = await readdir(root).catch(error => { if (isErrnoCode(error, "ENOENT")) return [] as string[]; throw error; });
  return names.some(name => !LIBRARY_ENTRIES.has(name));
}
