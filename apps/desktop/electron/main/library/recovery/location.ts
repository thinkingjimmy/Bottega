/**
 * [INPUT]: Private profile storage, Node filesystem/device metadata and the admitted folder identity.
 * [OUTPUT]: Remembers the last successfully opened path and volume, and identifies a disconnected volume without modifying it.
 * [POS]: Local recovery context outside portable content; updated only after normal folder admission succeeds.
 */
import { lstat, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";
import { z } from "zod";
import { durableReplaceFile } from "../../persistence/durable-json";

const locationSchema = z.object({ version: z.literal(1), libraryId: z.string().uuid(), root: z.string().refine(isAbsolute),
  volume: z.object({ path: z.string().refine(isAbsolute), name: z.string().min(1).max(255), device: z.string().optional() }) });
export type LibraryLocation = z.infer<typeof locationSchema>;
const file = (userData: string) => join(userData, "library-location.json");

export async function readLibraryLocation(userData: string): Promise<LibraryLocation | null> {
  try {
    const info = await lstat(file(userData));
    if (!info.isFile() || info.isSymbolicLink() || info.size > 16_384) return null;
    return locationSchema.parse(JSON.parse(await readFile(file(userData), "utf8")));
  } catch { return null; }
}

export async function rememberLibraryLocation(userData: string, root: string, libraryId: string) {
  const previous = await readLibraryLocation(userData);
  let path = resolve(root), device = (await stat(path)).dev;
  // The first ancestor with another device identifies the mounted volume; the filesystem root is the internal fallback.
  while (dirname(path) !== path) {
    const parent = dirname(path), parentDevice = (await stat(parent)).dev;
    if (parentDevice !== device) break;
    path = parent; device = parentDevice;
  }
  const value: LibraryLocation = { version: 1, libraryId, root, volume: { path, name: basename(path) || parse(path).root, device: String(device) } };
  if (JSON.stringify(previous) !== JSON.stringify(value)) await durableReplaceFile(file(userData), JSON.stringify(value) + "\n");
}

export async function disconnectedLibraryVolume(userData: string, root: string | null | undefined, libraryId: string | null | undefined) {
  const location = await readLibraryLocation(userData);
  if (!location || location.root !== root || location.libraryId !== libraryId) return null;
  const present = await stat(location.volume.path).catch(() => null);
  return present?.isDirectory() && (!location.volume.device || String(present.dev) === location.volume.device) ? null : location.volume.name;
}
