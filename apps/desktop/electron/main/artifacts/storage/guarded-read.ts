/**
 * [INPUT]: Admitted canonical paths, file metadata and Node filesystem primitives.
 * [OUTPUT]: Returns bounded inode-stable bytes and typed symlink, changed, size and format refusals.
 * [POS]: Artifact source read boundary; generated pages never read live workspace bytes.
 */
import { ArtifactFailure } from "./failure";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
export async function readArtifactSource(path: string, limit: number): Promise<Uint8Array> {
  const before = await lstat(path);
  if (before.isSymbolicLink() || await realpath(path) !== path) throw new ArtifactFailure("symlink", "read");
  if (!before.isFile()) throw new ArtifactFailure("unsupported", "read");
  if (before.size > limit) throw new ArtifactFailure("too-large", "read");
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat();
    const same = (value: typeof opened) => value.dev === before.dev && value.ino === before.ino &&
      value.size === before.size && value.mtimeMs === before.mtimeMs && value.ctimeMs === before.ctimeMs;
    if (!same(opened)) throw new ArtifactFailure("changed", "read");
    // The open handle is the admitted inode: reading it cannot follow a later path swap.
    const buffer = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const data: Uint8Array = buffer.subarray(0, length);
    if (data.length !== before.size || !same(await handle.stat()) || !same(await lstat(path)) || await realpath(path) !== path) throw new ArtifactFailure("changed", "read");
    return data;
  } finally { await handle.close(); }
}
