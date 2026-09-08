/**
 * [INPUT]: Depends on one canonical source root, portable relative paths and bounded file handles
 * [OUTPUT]: Provides no-link, identity-stable source bytes without reading an unbounded file
 * [POS]: Shared file admission for author manifests and explicitly frozen scripts
 */

import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { isContained } from "../support";
import { portableCommandPath } from "./schema";

export async function readCommandSource(root: string, relative: string, maximum: number) {
  portableCommandPath.parse(relative);
  const canonicalRoot = await realpath(root);
  const path = resolve(canonicalRoot, relative);
  if (!isContained(canonicalRoot, path) || await realpath(path) !== path) throw changed();
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > maximum) throw changed();
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    if (identity(before) !== identity(opened)) throw changed();
    const bytes = Buffer.alloc(before.size + 1);
    let read = 0;
    while (read < bytes.length) {
      const result = await handle.read(bytes, read, bytes.length - read, read);
      if (result.bytesRead === 0) break;
      read += result.bytesRead;
    }
    if (read !== before.size || identity(await handle.stat()) !== identity(before) ||
        identity(await lstat(path)) !== identity(before) || await realpath(path) !== path) throw changed();
    return { path, bytes: bytes.subarray(0, read) };
  } finally { await handle.close(); }
}

function identity(info: Awaited<ReturnType<typeof lstat>>) {
  return `${info.dev}:${info.ino}:${info.nlink}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
}
function changed() { return Object.assign(new Error("APP_COMMAND_SOURCE_CHANGED"), { code: "APP_COMMAND_SOURCE_CHANGED" }); }
