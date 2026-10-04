/**
 * [INPUT]: Depends on Node fs/promises readdir and path join
 * [OUTPUT]: Provides listFilesRecursively, the shared bounded-by-predicate JSONL discovery walker (a missing root is empty; an unreadable subfolder is skipped)
 * [POS]: The one directory walker behind every usage source adapter; sources only supply the root and the file predicate, and read lines through persistence/jsonl-lines
 */

import type { Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** A missing root is an empty source, not a failure; any other error on the root propagates. */
export async function listFilesRecursively(
  root: string,
  accept: (name: string) => boolean
): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
  return walk(root, entries, accept);
}

/* A subfolder that cannot be read (its permissions, an Agent moving or deleting it mid-walk) is skipped: one bad folder must
   not hide the rest of an Agent's logs, which a thrown error would, by failing the whole source. */
async function walk(directory: string, entries: Dirent[], accept: (name: string) => boolean): Promise<string[]> {
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isFile()) return accept(entry.name) ? [path] : [];
      if (!entry.isDirectory()) return [];
      const children = await readdir(path, { withFileTypes: true }).catch((cause: NodeJS.ErrnoException) => {
        if (cause.code !== "ENOENT") console.warn("[usage] log folder skipped: %s (%s)", path, cause.code ?? "read failed");
        return null;
      });
      return children ? walk(path, children, accept) : [];
    })
  );
  return nested.flat();
}
