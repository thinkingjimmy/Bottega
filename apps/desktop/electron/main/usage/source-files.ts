/**
 * [INPUT]: Depends on Node fs/promises readdir and path join
 * [OUTPUT]: Provides listFilesRecursively, the shared bounded-by-predicate JSONL discovery walker
 * [POS]: The one directory walker behind every usage source adapter; sources only supply the root and the file predicate
 */

import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** A missing root is an empty source, not a failure; every other fs error propagates. */
export async function listFilesRecursively(
  root: string,
  accept: (name: string) => boolean
): Promise<string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) => {
        const path = join(root, entry.name);
        if (entry.isDirectory()) return listFilesRecursively(path, accept);
        return Promise.resolve(entry.isFile() && accept(entry.name) ? [path] : []);
      })
    );
    return nested.flat();
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw cause;
  }
}
