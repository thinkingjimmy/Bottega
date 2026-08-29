/**
 * [INPUT]: Depends on Node filesystem/path, canonical coordinator hashes, read-only snapshot removal, and the type-only PreparedManualTurn contract
 * [OUTPUT]: Provides staged-byte reservation/release, prepared hash verification, idempotent staging disposal, usage accounting, and startup reconciliation
 * [POS]: Prepared admission custody primitive statically shared by the write-side stager and read-side hydrator without importing either at runtime
 */

import { mkdir, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { removeReadonlySnapshot } from "../../../../agent-input";
import { canonicalHash } from "../../coordinator-values";
import type { PreparedManualTurn } from "../prepared-manual-turn";

const STAGED_BLOB_QUOTA = 2 * 1024 * 1024 * 1024;

let stagedBytes = 0;
let quotaTail = Promise.resolve();

const withQuotaLock = async <T>(task: () => T | Promise<T>) => {
  const previous = quotaTail;
  let release!: () => void;
  quotaTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await task();
  } finally {
    release();
  }
};

export async function reservePreparedStagingBytes(bytes: number) {
  await withQuotaLock(() => {
    if (stagedBytes + bytes > STAGED_BLOB_QUOTA) {
      throw new Error("staged blob 磁盘额度已满");
    }
    stagedBytes += bytes;
  });
}

export const releasePreparedStagingBytes = (bytes: number) =>
  withQuotaLock(() => {
    stagedBytes = Math.max(0, stagedBytes - bytes);
  });

export function assertPreparedContentHash(prepared: PreparedManualTurn) {
  const { contentHash, ...body } = prepared;
  if (contentHash !== canonicalHash(body)) {
    throw new Error("PreparedManualTurn content hash 冲突");
  }
}

export async function discardPreparedStaging(directory: string) {
  if (!directory) return;
  await withQuotaLock(async () => {
    const bytes = await directoryBytes(directory);
    await removeReadonlySnapshot(directory);
    stagedBytes = Math.max(0, stagedBytes - bytes);
  });
}

export async function releasePreparedStaging(prepared: PreparedManualTurn) {
  assertPreparedContentHash(prepared);
  await discardPreparedStaging(prepared.stagingDir);
}

export const preparedStagingUsageBytes = () => stagedBytes;

export async function reconcilePreparedStaging(
  root: string,
  liveOwners: ReadonlySet<string>
) {
  await withQuotaLock(async () => {
    await mkdir(root, { recursive: true, mode: 0o700 });
    stagedBytes = 0;
    const entries = await readdir(root, { withFileTypes: true });
    for (const entry of entries) {
      const path = join(root, entry.name);
      if (!entry.isDirectory() || !liveOwners.has(entry.name)) {
        await removeReadonlySnapshot(path);
        continue;
      }
      stagedBytes += await directoryBytes(path);
    }
    if (stagedBytes > STAGED_BLOB_QUOTA) {
      throw new Error("staged blob 存量超过磁盘额度");
    }
  });
}

async function directoryBytes(directory: string): Promise<number> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const sizes = await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory()
          ? directoryBytes(path)
          : entry.isFile()
            ? stat(path).then((value) => value.size)
            : 0;
      })
    );
    return sizes.reduce((total, size) => total + size, 0);
  } catch {
    return 0;
  }
}
