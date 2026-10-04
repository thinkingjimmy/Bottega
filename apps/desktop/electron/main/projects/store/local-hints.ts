/**
 * [INPUT]: Depends on Node fs/os/path, Zod, the folder object path helpers, the folder ownership marker, the workspace containment guard and durable publication.
 * [OUTPUT]: Provides readLocalHint / writeLocalHint / resolveHintedDirectory / folderPublishedElsewhere over `projects/<id>/local-hints.json`.
 * [POS]: A sibling of `project.json` keyed by machine, deliberately outside the portable schema, the content hash, `contentRevision` and every upload; the hint is content, the validation is the grant.
 */
import { lstat, readFile, realpath } from "node:fs/promises";
import { hostname } from "node:os";
import { isAbsolute, join } from "node:path";
import { z } from "zod";
import { durableReplaceFile } from "../../persistence/durable-json";
import { readPublisher } from "../../library/publisher";
import { libraryDirectory, libraryObjectId } from "../../library/paths";
import { assertWorkspaceDisjoint } from "../fs-utils";

const HINTS_FILE = "local-hints.json";
/* A folder open is not a reason to fsync one file per Project: the directory is rewritten when it moves,
   and otherwise only often enough for `seenAt` to stay meaningful. */
const REFRESH_MS = 24 * 60 * 60 * 1000;
const machineKey = z.string().regex(/^[a-f0-9]{64}$/);
// Another build's extra fields belong to whoever wrote them; this machine only ever replaces its own key.
const hintSchema = z.object({ dir: z.string().min(1), host: z.string().max(255), seenAt: z.number().int().nonnegative() }).catchall(z.unknown());
const fileSchema = z.object({ version: z.literal(1), hints: z.record(machineKey, hintSchema) });
export type LocalHint = z.infer<typeof hintSchema>;

async function readJson(path: string, limit = 256 * 1024) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error("PROJECT_HINTS_FILE_INVALID");
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}
const hintsPath = (root: string, projectId: string) => join(root, "projects", libraryObjectId(projectId), HINTS_FILE);
async function readFileHints(root: string, projectId: string) {
  try { return fileSchema.parse(await readJson(hintsPath(root, projectId))); }
  catch { return null; }
}

export async function readLocalHint(root: string, projectId: string, machineIdHash: string) {
  return (await readFileHints(root, projectId))?.hints[machineIdHash] ?? null;
}

export async function writeLocalHint(root: string, projectId: string, machineIdHash: string, dir: string, now = Date.now()) {
  const current = await readFileHints(root, projectId), previous = current?.hints[machineIdHash];
  if (previous?.dir === dir && now - previous.seenAt < REFRESH_MS) return;
  const next = { version: 1 as const, hints: { ...current?.hints, [machineIdHash]: { ...previous, dir, host: hostname(), seenAt: now } } };
  const directory = await libraryDirectory(root, "projects", projectId);
  await durableReplaceFile(join(directory, HINTS_FILE), JSON.stringify(next, null, 2) + "\n");
}

/**
 * The hint says where this computer last kept the Project; only these checks turn it into a binding.
 * Anything short of all of them leaves the Project exactly where it was — folderless, asking for a folder.
 */
export async function resolveHintedDirectory(hint: LocalHint, gate: { root: string; taken: ReadonlySet<string> }) {
  const dir = hint.dir;
  if (!isAbsolute(dir) || gate.taken.has(dir)) return null;
  try {
    const info = await lstat(dir);
    // A path that has become a link, or now resolves elsewhere, is a different directory than the one that was granted.
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(dir) !== dir) return null;
    assertWorkspaceDisjoint(dir, [gate.root]);
  } catch { return null; }
  return dir;
}

/** The folder step refuses such a folder outright; this is the same question asked one layer down, so a hint never outlives a marker naming another computer. */
export async function folderPublishedElsewhere(root: string, machineIdHash: string) {
  const publisher = await readPublisher(root);
  return publisher !== null && publisher.machineIdHash !== machineIdHash;
}
