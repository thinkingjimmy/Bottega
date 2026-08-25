/**
 * [INPUT]: Depends on Node Private Temporary Files, Rename, fsync with LedgerState
 * [OUTPUT]: Provides Section ledger Atomic release and release results unknown errors
 * [POS]: The coordinator/state's perpetuated boundaries; Pure mutation does not touch the file system, and RelayLedger is only responsible for submitting the status
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { LedgerState } from "./ledger-schema";

export class LedgerAmbiguousCommitError extends Error {
  readonly code = "LEDGER_FROZEN";

  constructor(
    readonly path: string,
    readonly cause: unknown
  ) {
    super(`Section ledger 发布结果不明确，已冻结：${path}`);
  }
}

export async function persistLedgerState(path: string, state: LedgerState) {
  await mkdir(dirname(path), { recursive: true });
  const content = JSON.stringify(state);
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, "wx", 0o600);
  let renamed = false;
  try {
    await file.writeFile(content);
    await file.sync();
  } finally {
    await file.close();
  }
  try {
    await rename(temporary, path);
    renamed = true;
    await syncParent(path);
  } catch (cause) {
    const actual = await readFile(path, "utf8").catch(() => null);
    if (actual === content) return;
    if (!renamed) await rm(temporary, { force: true }).catch(() => undefined);
    if (renamed || actual === null) {
      throw new LedgerAmbiguousCommitError(path, cause);
    }
    throw cause;
  }
}

async function syncParent(path: string) {
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
