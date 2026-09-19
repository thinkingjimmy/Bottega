/**
 * [INPUT]: Receives a selected folder, a fixed content collection and an original deletion identity.
 * [OUTPUT]: Moves the complete owned object into portable trash with idempotent, durable directory renames.
 * [POS]: Shared content deletion boundary; receipt and execution-custody decisions belong to callers.
 */
import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import { join } from "node:path";
import { libraryObjectId } from "./paths";
import { isErrnoCode, syncDirectory } from "../persistence/durable-json";
export async function trashLibraryObject(root: string, collection: "apps" | "projects" | "skills", id: string, operation: string) {
  const source = join(root, collection, libraryObjectId(id)), trash = join(root, ".trash");
  await mkdir(trash, { mode: 0o700, recursive: true });
  if (await realpath(trash) !== trash || (await lstat(trash)).isSymbolicLink()) throw new Error("LIBRARY_TRASH_INVALID");
  const target = join(trash, `${collection}-${id}-${libraryObjectId(operation)}`);
  try {
    const info = await lstat(source); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("LIBRARY_DIRECTORY_CHANGED");
    await rename(source, target); await syncDirectory(join(root, collection)); await syncDirectory(trash);
  } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
}
