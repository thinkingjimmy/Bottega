/**
 * [INPUT]: Depends on private Node filesystem publication and Zod's tolerant object parsing.
 * [OUTPUT]: Opens or creates the immutable v1 folder identity without copying installation or account state, and reads an existing one without creating it.
 * [POS]: Portable format admission before any content owner is mounted.
 */
import { randomUUID } from "node:crypto";
import { link, lstat, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { isErrnoCode, syncDirectory } from "../persistence/durable-json";

export const libraryIdentitySchema = z.object({
  libraryId: z.string().uuid(), formatVersion: z.literal(1), createdAt: z.number().int().nonnegative(),
});
export type LibraryIdentity = z.infer<typeof libraryIdentitySchema>;

async function readIdentityFile(path: string) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024) throw new Error("LIBRARY_IDENTITY_INVALID");
  return libraryIdentitySchema.parse(JSON.parse(await readFile(path, "utf8")));
}

/** Reads a folder's identity without creating one; anything unreadable is simply not a Bottega folder. */
export async function readLibraryIdentity(root: string): Promise<LibraryIdentity | null> {
  return readIdentityFile(join(root, ".bottega", "library.json")).catch(() => null);
}

export async function openLibraryIdentity(control: string): Promise<LibraryIdentity> {
  const path = join(control, "library.json");
  const read = () => readIdentityFile(path);
  try { return await read(); } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
  const temporary = join(control, `identity-${randomUUID()}.tmp`);
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify({ libraryId: randomUUID(), formatVersion: 1, createdAt: Date.now() }) + "\n");
    await file.sync();
  } finally { await file.close(); }
  try { await link(temporary, path); await syncDirectory(control); }
  catch (error) { if (!isErrnoCode(error, "EEXIST")) throw error; }
  finally { await unlink(temporary); }
  return read();
}
