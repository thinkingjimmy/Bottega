/**
 * [INPUT]: Depends on Node crypto, the SQLite transaction owner and the current schema.
 * [OUTPUT]: Installs v9 on an empty database; every other identity is refused unchanged so startup recovery can rebuild from the folder.
 * [POS]: SQLite schema gate before repository reads; there is no upgrade path, because there is no data to migrate.
 */

import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../connection";
import { transaction } from "../connection";
import { ChatSchemaError } from "../failure";
import { CHAT_STORE_SCHEMA } from "./0001-chat-store";

export const CHAT_STORE_APPLICATION_ID = 0x424f5454;
export const CHAT_STORE_SCHEMA_VERSION = 9;
const CHAT_STORE_SCHEMA_NAME = "chat-store";

const CHAT_STORE_SCHEMA_CHECKSUM = createHash("sha256")
  .update(`${CHAT_STORE_SCHEMA_VERSION}\0${CHAT_STORE_SCHEMA_NAME}\0${CHAT_STORE_SCHEMA}`)
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

export function ensureChatSchema(database: SqliteDatabase, now = Date.now) {
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

  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name: string}>;
  if (!tables.some(table => table.name === "schema_migrations")) {
    if (tables.length || userVersion !== 0 || applicationId !== 0) {
      throw new ChatSchemaError("corrupt", "Existing database has no Chat schema identity");
    }
    transaction(database, () => {
      database.exec(`CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL,
        checksum TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT`);
      database.exec(CHAT_STORE_SCHEMA);
      database.prepare("INSERT INTO schema_migrations(version,name,checksum,applied_at) VALUES(?,?,?,?)")
        .run(CHAT_STORE_SCHEMA_VERSION, CHAT_STORE_SCHEMA_NAME, CHAT_STORE_SCHEMA_CHECKSUM, now());
      database.exec(`PRAGMA user_version = ${CHAT_STORE_SCHEMA_VERSION}`);
      database.exec(`PRAGMA application_id = ${CHAT_STORE_APPLICATION_ID}`);
    });
    return;
  }
  const rows = database
    .prepare("SELECT version, name, checksum FROM schema_migrations ORDER BY version")
    .all() as Array<{ version: number; name: string; checksum: string }>;

  if (rows.length === 0) throw new ChatSchemaError("corrupt", "Existing Chat database has no schema identity row");
  const [row] = rows;
  if (rows.length !== 1 || row!.version !== CHAT_STORE_SCHEMA_VERSION || row!.name !== CHAT_STORE_SCHEMA_NAME) {
    const recorded = rows.map((item) => `${item.version}:${item.name}`).join(",");
    throw new ChatSchemaError("corrupt", `Chat schema ${recorded} is not this version; original data is unchanged`);
  }
  if (row!.checksum !== CHAT_STORE_SCHEMA_CHECKSUM) {
    throw new ChatSchemaError("corrupt", "Chat schema checksum mismatch");
  }

  if (integerPragma(database, "user_version") !== CHAT_STORE_SCHEMA_VERSION) {
    throw new Error("Chat schema did not converge to the supported version");
  }
  if (integerPragma(database, "application_id") !== CHAT_STORE_APPLICATION_ID) {
    throw new Error("Chat database application_id was not durably installed");
  }
}
