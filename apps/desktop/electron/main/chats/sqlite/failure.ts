/**
 * [INPUT]: Depends only on Node/node:sqlite error shapes and the ChatDatabaseFailure union
 * [OUTPUT]: Provides ChatSchemaError, the errcode-based SQLite classifier including the domain conflict verdicts, and the worker-level failure projection
 * [POS]: Shared error boundary for repository outcomes and worker protocol failures
 */

import type { ChatDatabaseFailure } from "./database-protocol";

const PRIMARY_MASK = 0xff;

/* Schema verdicts carry their own type. Reading them back out of the message
   text made every future error string a load-bearing API — one reworded
   sentence and a future schema would have been reported as "unknown". */
export class ChatSchemaError extends Error {
  constructor(
    readonly kind: "future-schema" | "corrupt",
    message: string
  ) {
    super(message);
    this.name = "ChatSchemaError";
  }
}

export function sqliteFailureOf(cause: unknown): ChatDatabaseFailure {
  const value = cause as { code?: unknown; errcode?: unknown; errstr?: unknown };
  const message = cause instanceof Error ? cause.message : String(cause);
  const errcode = typeof value.errcode === "number"
    ? value.errcode & PRIMARY_MASK
    : null;
  if (/\b(?:REVISION_STALE|INCARNATION_MISMATCH|HISTORY_SOURCE_MANAGED)\b/.test(message)) {
    return { kind: "conflict", message };
  }
  if (errcode === 5 || errcode === 6 || /database is (?:busy|locked)/i.test(message)) {
    return { kind: "locked", message };
  }
  if (errcode === 13 || /database or disk is full/i.test(message)) {
    return { kind: "disk-full", message };
  }
  if (errcode === 19 || /constraint failed/i.test(message)) {
    return { kind: "constraint", message };
  }
  if (errcode === 11 || errcode === 26 || /malformed|not a database/i.test(message)) {
    return { kind: "corrupt", message };
  }
  return { kind: "unknown", message };
}

export function failureOf(cause: unknown): ChatDatabaseFailure {
  if (cause instanceof ChatSchemaError) {
    return { kind: cause.kind, message: cause.message };
  }
  return sqliteFailureOf(cause);
}
