/**
 * [INPUT]: Depends on Node private temporary files, rename, the persistence directory fsync, and LedgerState
 * [OUTPUT]: Provides persistLedgerState (write-temp/fsync/rename/dir-sync atomic commit) and LedgerAmbiguousCommitError for a commit whose on-disk outcome could not be confirmed
 * [POS]: Durable-persistence boundary of coordinator/state; owns all ledger file IO, while RelayLedger only decides when to commit
 */

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { syncDirectory } from "../../../persistence/durable-json";
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
    await syncDirectory(dirname(path));
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
