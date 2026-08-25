/**
 * [INPUT]: Depends on Node fs/path/crypto; Receive unchanged generated files with the only meta release records
 * [OUTPUT]: Provides durableAtomicWrite, publishMeta threefold release (previous=null table created)
 * [POS]: The only documents released by bases/store are kernels; Any rename/fsync exception will retain the file and fail-closed, and the caller may not guess or delete the candidate generation
 */

import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

export type CommitPublishState =
  | "not-published"
  | "published"
  | "ambiguous";

export class BaseAmbiguousCommitError extends Error {
  readonly status = 503;
  readonly code = "BASE_FROZEN";

  constructor(
    readonly path: string,
    readonly cause: unknown
  ) {
    super(`Base 发布结果不明确，已冻结：${path}`);
  }
}

export class BaseNotPublishedCommitError extends Error {
  readonly status = 503;
  readonly code = "BASE_RETRY";
  readonly retryable = true;

  constructor(readonly path: string) {
    super(`Base meta 确认未发布，可安全重试：${path}`);
  }
}

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

/** previous 为 null 表示创建发布：目标 ENOENT 即可证明未发布。 */
async function classifyPublish(
  path: string,
  previous: string | null,
  candidate: string
): Promise<CommitPublishState> {
  let actual: string;
  try {
    actual = await readFile(path, "utf8");
  } catch (cause) {
    return previous === null && isCode(cause, "ENOENT")
      ? "not-published"
      : "ambiguous";
  }
  if (actual === candidate) return "published";
  if (previous !== null && actual === previous) return "not-published";
  return "ambiguous";
}

export async function publishMeta(
  path: string,
  previous: string | null,
  candidate: string,
  dependencies: DurableWriteDependencies = {}
): Promise<CommitPublishState> {
  try {
    await durableAtomicWrite(path, candidate, dependencies);
    return "published";
  } catch (cause) {
    const state = await classifyPublish(path, previous, candidate);
    if (state === "not-published") return state;
    throw new BaseAmbiguousCommitError(path, cause);
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
