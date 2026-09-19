/**
 * [INPUT]: Depends on Node path/fs and untrusted portable object identifiers.
 * [OUTPUT]: Provides contained object paths and non-symlink directory admission.
 * [POS]: Shared folder path boundary for content owners; never accepts renderer-authored relative paths.
 */
import { lstat, mkdir, realpath } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";

export function libraryObjectId(value: string) {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error("LIBRARY_INVALID_OBJECT_ID");
  return value;
}

export const libraryChatPath = (root: string, chatId: string) => join(root, "chats", libraryObjectId(chatId));
export const libraryHomePath = (root: string, chatId: string) => join(libraryChatPath(root, chatId), "home");

export async function libraryDirectory(root: string, ...parts: string[]) {
  if (!isAbsolute(root)) throw new Error("LIBRARY_ROOT_NOT_ABSOLUTE");
  let directory = await realpath(root);
  if (directory !== root) throw new Error("LIBRARY_ROOT_CHANGED");
  for (const part of parts) {
    libraryObjectId(part);
    directory = join(directory, part);
    await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST") throw error; });
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error("LIBRARY_DIRECTORY_CHANGED");
  }
  if (relative(root, directory).startsWith("..")) throw new Error("LIBRARY_PATH_ESCAPE");
  return directory;
}
