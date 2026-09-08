/**
 * [INPUT]: Depends on Node fs/path/crypto; receives a target path and the exact bytes to publish
 * [OUTPUT]: Provides durableAtomicWrite (tmp → fsync → rename → parent fsync), fsyncParent, and the isErrnoCode guard shared by the store leaves
 * [POS]: The single durable-write point of bases/store; every generation and meta file goes through here, and a failed write leaves the target untouched
 */

import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export async function durableAtomicWrite(
  path: string,
  content: string | Buffer,
  write?: (path: string, content: string) => Promise<void>
) {
  if (write) {
    await write(path, content.toString());
    return;
  }
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  try {
    await file.writeFile(content);
    await file.sync();
  } catch (cause) {
    await file.close().catch(() => undefined);
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
  await file.close();
  try {
    await rename(temporary, path);
    await fsyncParent(path);
  } catch (cause) {
    // 只允许清理尚未 rename 的 tmp；候选世代与目标文件一律保留。
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }
}

export async function fsyncParent(path: string) {
  const directory = await open(dirname(path), "r");
  try {
    await directory.sync();
  } catch (cause) {
    if (!isErrnoCode(cause, "EINVAL") && !isErrnoCode(cause, "ENOTSUP")) throw cause;
  } finally {
    await directory.close();
  }
}

export function isErrnoCode(cause: unknown, code: string) {
  return (cause as NodeJS.ErrnoException | null)?.code === code;
}
