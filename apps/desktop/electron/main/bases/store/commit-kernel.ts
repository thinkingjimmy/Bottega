/**
 * [INPUT]: Depends on Node fs/path/crypto; receives a target path and the exact bytes to publish
 * [OUTPUT]: Provides durableAtomicWrite (tmp → fsync → rename → parent fsync) and fsyncParent
 * [POS]: The single durable-write point of bases/store; every generation and meta file goes through here, and a failed write leaves the target untouched
 */

import { randomUUID } from "node:crypto";
import { open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export type DurableWriteDependencies = {
  write?: (path: string, content: string) => Promise<void>;
};

export async function durableAtomicWrite(
  path: string,
  content: string,
  dependencies: DurableWriteDependencies = {}
) {
  if (dependencies.write) {
    await dependencies.write(path, content);
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
    if (!isCode(cause, "EINVAL") && !isCode(cause, "ENOTSUP")) throw cause;
  } finally {
    await directory.close();
  }
}

function isCode(cause: unknown, code: string) {
  return (
    cause instanceof Error &&
    "code" in cause &&
    (cause as NodeJS.ErrnoException).code === code
  );
}
