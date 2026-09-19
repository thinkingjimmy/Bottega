/**
 * [INPUT]: Depends on the SQLite transaction owner and independently pinned encrypted v7 identities before/after sort_key.
 * [OUTPUT]: Upgrades known v7 databases to v8 atomically, adding missing sort positions without changing existing content.
 * [POS]: Recovery path for the unversioned manual-sort schema change; unknown identities remain closed.
 */
import { transaction, type SqliteDatabase } from "../connection";
import { ChatSchemaError } from "../failure";

// Captured from main 1cddd2c0 and b28d9ae0, with independent historical SQL fixtures.
const PRE_SORT_V7_CHECKSUM = "41350140dea4a2c3ce45de226fc3ed3b7b4b7a4deb2ab9bd5740f5fbfde59222";
const SORTED_V7_CHECKSUM = "cce9639f5a8bd69da0a8baf9948817c9a73a7b938799cae7f2be326d6214cb5d";
const V7_CHAT_COLUMNS = [
  "id", "lifecycle_kind", "agent", "agent_revision", "options_json", "conversation_kind",
  "portable_app_id", "portable_project_id", "cloud_state", "cloud_environment", "cloud_user_id",
  "cloud_executor_device_id", "cloud_execution_epoch", "cloud_last_committed_executor_device_id",
  "cloud_native_session_device_id", "cloud_revision", "cloud_home_snapshot_id", "fork_agent", "title",
  "title_source", "created_at", "updated_at", "archived_at", "incarnation_id", "next_seq",
  "trimmed_through_seq", "branches_trimmed_through_seq", "core_revision", "native_message_revision",
  "parent_chat_id", "parent_incarnation_id", "parent_message_id", "inherited_through_seq",
];

function assertV7Columns(database: SqliteDatabase, sorted: boolean) {
  const columns = database.prepare("PRAGMA table_info(chats)").all() as Array<{
    name: string; type: string; notnull: number; dflt_value: unknown; pk: number;
  }>;
  const names = columns.filter(column => column.name !== "sort_key").map(column => column.name);
  const sort = columns.find(column => column.name === "sort_key");
  // Fresh sorted v7 puts the column in the middle; the v6 upgrade appends it.
  if (JSON.stringify(names) !== JSON.stringify(V7_CHAT_COLUMNS) || Boolean(sort) !== sorted ||
      (sort && (sort.type !== "REAL" || sort.notnull !== 0 || sort.dflt_value !== null || sort.pk !== 0))) {
    throw new ChatSchemaError("corrupt", "Chat v7 table shape differs from its recorded identity");
  }
}

export function upgradeKnownV7(database: SqliteDatabase, checksum: string, now: () => number) {
  transaction(database, () => {
    const rows = database.prepare("SELECT version,name,checksum FROM schema_migrations").all() as
      Array<{ version: number; name: string; checksum: string }>;
    const row = rows[0];
    if (rows.length !== 1 || row?.version !== 7 || row.name !== "chat-store" ||
        (row.checksum !== PRE_SORT_V7_CHECKSUM && row.checksum !== SORTED_V7_CHECKSUM)) {
      throw new ChatSchemaError("corrupt", "Chat v7 schema checksum or identity mismatch");
    }
    const sorted = row.checksum === SORTED_V7_CHECKSUM;
    assertV7Columns(database, sorted);
    const integrity = database.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
    if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== "ok" ||
        database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new ChatSchemaError("corrupt", "Chat v7 database failed upgrade integrity checks");
    }
    if (!sorted) database.exec("ALTER TABLE chats ADD COLUMN sort_key REAL");
    database.prepare("UPDATE schema_migrations SET version=8,checksum=?,applied_at=? WHERE version=7")
      .run(checksum, now());
    database.exec("PRAGMA user_version = 8");
  });
}
