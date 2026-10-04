/**
 * [INPUT]: Depends on node:sqlite, the Chat database path authority and the connection module's transaction helper.
 * [OUTPUT]: Provides unfinishedSagas and rebaseDatabasePaths: the two relocation facts that live in the Chat database.
 * [POS]: The one sanctioned main-thread connection, and only before the database worker starts; everything later goes through the worker.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { chatDatabasePath } from "../../chats/sqlite/paths";
import { transaction, type SqliteDatabase } from "../../chats/sqlite/connection";

type NodeSqlite = { DatabaseSync: new (path: string, options?: { readOnly?: boolean; timeout?: number }) => SqliteDatabase };

/* Terminal saga states: nothing will ever compare their recorded Home again. */
const SETTLED_SAGAS = ["completed", "failed", "committed-orphan"];

function withDatabase<T>(userData: string, readOnly: boolean, run: (database: SqliteDatabase) => T): T | null {
  const path = chatDatabasePath(userData);
  if (!existsSync(path)) return null;
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as NodeSqlite;
  const database = new DatabaseSync(path, { readOnly, timeout: 5_000 });
  try { return run(database); } finally { database.close(); }
}

export async function unfinishedSagas(userData: string) {
  const row = withDatabase(userData, true, database => database.prepare(
    `SELECT COUNT(*) AS count FROM chat_continuation_sagas WHERE state NOT IN (${SETTLED_SAGAS.map(() => "?").join(", ")})`
  ).get(...SETTLED_SAGAS) as { count: number | bigint } | undefined);
  return Number(row?.count ?? 0) > 0;
}

/**
 * Rewrites the Chat Home and execution directories recorded under `from` to sit under `to`.
 * Exact root or `root/` prefix only, so a sibling such as `/a/Bottega2` is never touched,
 * and running it twice changes nothing the second time.
 */
export async function rebaseDatabasePaths(userData: string, from: string, to: string) {
  return withDatabase(userData, false, database => transaction(database, () => {
    let changed = 0;
    for (const column of ["home_dir", "execution_dir"]) {
      const result = database.prepare(
        `UPDATE chat_device_bindings SET ${column} = ? || substr(${column}, ?) WHERE ${column} = ? OR substr(${column}, 1, ?) = ?`
      ).run(to, from.length + 1, from, from.length + 1, `${from}/`);
      changed += Number(result.changes);
    }
    return changed;
  })) ?? 0;
}
