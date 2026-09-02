/**
 * [INPUT]: Depends on Node crypto, the connection transaction helper, typed ChatSchemaError, and immutable migration SQL modules
 * [OUTPUT]: Provides forward-only checksum-verified migration execution plus typed application_id/user_version future-version fences
 * [POS]: SQLite schema evolution authority; worker initialization must pass through this runner before any repository query
 */

import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../connection";
import { transaction } from "../connection";
import { ChatSchemaError } from "../failure";
import { CHAT_STORE_SCHEMA_V1 } from "./0001-chat-store";

export const CHAT_STORE_APPLICATION_ID = 0x424f5454;
export const CHAT_STORE_SCHEMA_VERSION = 1;

type Migration = Readonly<{
  version: number;
  name: string;
  sql: string;
}>;

const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: "chat-store", sql: CHAT_STORE_SCHEMA_V1 },
];

const checksum = (migration: Migration) =>
  createHash("sha256")
    .update(`${migration.version}\0${migration.name}\0${migration.sql}`)
    .digest("hex");

const integerPragma = (database: SqliteDatabase, name: string) => {
  const row = database.prepare(`PRAGMA ${name}`).get() as
    | Record<string, unknown>
    | undefined;
  const value = row ? Object.values(row)[0] : undefined;
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`SQLite ${name} is not an integer`);
  }
  return value;
};

export function runMigrations(database: SqliteDatabase, now = Date.now) {
  const applicationId = integerPragma(database, "application_id");
  const userVersion = integerPragma(database, "user_version");
  if (applicationId !== 0 && applicationId !== CHAT_STORE_APPLICATION_ID) {
    throw new ChatSchemaError("corrupt", "SQLite application_id does not belong to Bottega");
  }
  if (userVersion > CHAT_STORE_SCHEMA_VERSION) {
    throw new ChatSchemaError(
      "future-schema",
      `SQLite schema ${userVersion} is newer than this application`
    );
  }

  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT UNIQUE NOT NULL,
      checksum TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    ) STRICT;
  `);
  const rows = database
    .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number; name: string; checksum: string }>;
  for (const row of rows) {
    const migration = MIGRATIONS.find((item) => item.version === row.version);
    if (!migration || migration.name !== row.name) {
      throw new ChatSchemaError(
        "corrupt",
        `Unknown applied Chat migration ${row.version}:${row.name}`
      );
    }
    if (row.checksum !== checksum(migration)) {
      throw new ChatSchemaError(
        "corrupt",
        `Chat migration checksum mismatch at version ${row.version}`
      );
    }
  }

  for (const migration of MIGRATIONS) {
    if (rows.some((row) => row.version === migration.version)) continue;
    transaction(database, () => {
      database.exec(migration.sql);
      database
        .prepare(
          "INSERT INTO schema_migrations(version, name, checksum, applied_at) VALUES (?, ?, ?, ?)"
        )
        .run(
          migration.version,
          migration.name,
          checksum(migration),
          now()
        );
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec(`PRAGMA application_id = ${CHAT_STORE_APPLICATION_ID}`);
    });
  }

  if (integerPragma(database, "user_version") !== CHAT_STORE_SCHEMA_VERSION) {
    throw new Error("Chat schema did not converge to the supported version");
  }
  if (integerPragma(database, "application_id") !== CHAT_STORE_APPLICATION_ID) {
    throw new Error("Chat database application_id was not durably installed");
  }
}
