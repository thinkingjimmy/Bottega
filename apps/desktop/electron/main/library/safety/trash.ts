/**
 * [INPUT]: Receives a selected folder, a fixed content collection and an original deletion identity; depends on folder admission.
 * [OUTPUT]: Provides libraryTrashDirectory (the folder's own `.trash`, verified by real path before anything is moved into or removed from it) and trashLibraryObject (moves a complete owned object there with idempotent, durable directory renames).
 * [POS]: Shared content deletion boundary; receipt and execution-custody decisions belong to callers.
 */
import { lstat, mkdir, realpath, rename } from "node:fs/promises";
import { join } from "node:path";
import { libraryObjectId } from "../paths";
import { isErrnoCode, syncDirectory } from "../../persistence/durable-json";
import { assertAdmissibleLibraryRoot } from "./admission";

/**
 * `<root>/.trash`, only while it is really that directory. On a case-insensitive disk a folder
 * at the home folder would resolve `.trash` to the person's own `~/.Trash`; a symlink could point
 * anywhere. Either way nothing may be moved in or aged out, so this throws instead.
 * `create: false` answers null for a folder that has never trashed anything.
 */
export async function libraryTrashDirectory(root: string, options: { create: boolean } = { create: true }) {
  await assertAdmissibleLibraryRoot(root);
  const trash = join(root, ".trash");
  if (options.create) await mkdir(trash, { mode: 0o700, recursive: true });
  const info = await lstat(trash).catch(error => { if (!options.create && isErrnoCode(error, "ENOENT")) return null; throw error; });
  if (!info) return null;
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(trash) !== trash) throw new Error("LIBRARY_TRASH_INVALID");
  return trash;
}

export async function trashLibraryObject(root: string, collection: "apps" | "chats" | "projects" | "skills", id: string, operation: string) {
  const source = join(root, collection, libraryObjectId(id));
  const trash = (await libraryTrashDirectory(root))!;
  const target = join(trash, `${collection}-${id}-${libraryObjectId(operation)}`);
  try {
    const info = await lstat(source); if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("LIBRARY_DIRECTORY_CHANGED");
    await rename(source, target); await syncDirectory(join(root, collection)); await syncDirectory(trash);
  } catch (error) { if (!isErrnoCode(error, "ENOENT")) throw error; }
}
