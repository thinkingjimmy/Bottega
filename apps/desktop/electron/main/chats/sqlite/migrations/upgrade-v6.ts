/**
 * [INPUT]: Depends on the SQLite transaction owner and the exact published v0.1.4 schema identity.
 * [OUTPUT]: Upgrades the released v6 cloud tables to v8, including nullable chats.sort_key, while retaining every original row and payload.
 * [POS]: Published v0.1.4 upgrade beside the known-v7 upgrade; invoked before repository reads or WAL configuration.
 */
import { transaction, type SqliteDatabase } from "../connection";
import { ChatSchemaError } from "../failure";

export const RELEASED_V6_CHECKSUM = "36372167a523d710eedd0ab90304ea0496923b953d4d126290500f060eaa0af2";

const UPGRADE_SQL = String.raw`
ALTER TABLE cloud_outbox RENAME TO cloud_outbox_v6;
CREATE TABLE cloud_outbox (
  id TEXT PRIMARY KEY, environment TEXT NOT NULL, user_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL CHECK(entity_kind IN ('chat','message','turn','attachment','generation','home-snapshot','tombstone')),
  entity_id TEXT NOT NULL, kind TEXT NOT NULL, seq_or_revision INTEGER NOT NULL,
  execution_epoch INTEGER, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  payload_digest TEXT NOT NULL, created_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts>=0), last_error TEXT,
  metadata_intent_json TEXT CHECK(metadata_intent_json IS NULL OR json_valid(metadata_intent_json)),
  metadata_status TEXT CHECK(metadata_status IN ('queued','blocked','applied','converged','conflicted','deleted','discarded')),
  CHECK((metadata_intent_json IS NULL) = (metadata_status IS NULL)),
  FOREIGN KEY(environment,user_id) REFERENCES cloud_sync_state(environment,user_id)
) STRICT;
INSERT INTO cloud_outbox(id,environment,user_id,entity_kind,entity_id,kind,seq_or_revision,
  execution_epoch,payload_json,payload_digest,created_at,attempts,last_error)
SELECT id,environment,user_id,entity_kind,entity_id,kind,seq_or_revision,
  execution_epoch,payload_json,payload_digest,created_at,attempts,last_error FROM cloud_outbox_v6;
DROP TABLE cloud_outbox_v6;
CREATE INDEX cloud_outbox_scope ON cloud_outbox(environment,user_id,created_at,id);
CREATE INDEX cloud_outbox_metadata ON cloud_outbox(environment,user_id,metadata_status,seq_or_revision,id);
CREATE TABLE cloud_chat_metadata_state (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  environment TEXT NOT NULL, user_id TEXT NOT NULL,
  confirmed_json TEXT CHECK(confirmed_json IS NULL OR json_valid(confirmed_json)),
  observed_json TEXT NOT NULL CHECK(json_valid(observed_json)), tail_operation_id TEXT,
  execution_observed_json TEXT CHECK(execution_observed_json IS NULL OR json_valid(execution_observed_json)),
  remote_initial_json TEXT CHECK(remote_initial_json IS NULL OR json_valid(remote_initial_json)),
  conflicted INTEGER NOT NULL DEFAULT 0 CHECK(conflicted IN (0,1)),
  deleted INTEGER NOT NULL DEFAULT 0 CHECK(deleted IN (0,1))
) STRICT;
CREATE TABLE cloud_outbox_checkpoints (
  outbox_id TEXT NOT NULL REFERENCES cloud_outbox(id) ON DELETE CASCADE,
  checkpoint_key TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES chat_retained_sources(source_id),
  digest TEXT NOT NULL, PRIMARY KEY(outbox_id,checkpoint_key)
) STRICT;
ALTER TABLE chat_classification_candidates RENAME TO chat_classification_candidates_v6;
CREATE TABLE chat_classification_candidates (
  operation_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, environment TEXT, user_id TEXT,
  expected_revision INTEGER NOT NULL, old_classification_json TEXT NOT NULL,
  previous_json TEXT NOT NULL, candidate_json TEXT NOT NULL, candidate_hash TEXT NOT NULL,
  operation_json TEXT CHECK(operation_json IS NULL OR json_valid(operation_json)),
  receipt_json TEXT, state TEXT NOT NULL CHECK(state IN ('pending','conflicted','confirmed','committed','discarded','detached'))
) STRICT;
INSERT INTO chat_classification_candidates(operation_id,chat_id,environment,user_id,expected_revision,
  old_classification_json,previous_json,candidate_json,candidate_hash,operation_json,receipt_json,state)
SELECT operation_id,chat_id,environment,user_id,expected_revision,old_classification_json,'null',
  candidate_json,candidate_hash,NULL,receipt_json,state FROM chat_classification_candidates_v6;
DROP TABLE chat_classification_candidates_v6;
CREATE INDEX classification_candidates_chat ON chat_classification_candidates(chat_id,state);
ALTER TABLE chats ADD COLUMN sort_key REAL;
`;

function assertReleasedColumns(database: SqliteDatabase) {
  const tables = {
    cloud_outbox: ["id", "environment", "user_id", "entity_kind", "entity_id", "kind", "seq_or_revision", "execution_epoch",
      "payload_json", "payload_digest", "created_at", "attempts", "last_error"],
    chat_classification_candidates: ["operation_id", "chat_id", "environment", "user_id", "expected_revision",
      "old_classification_json", "candidate_json", "candidate_hash", "receipt_json", "state"],
  };
  for (const [table, expected] of Object.entries(tables)) {
    const actual = (database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(column => column.name);
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new ChatSchemaError("corrupt", "Released Chat table shape differs from its recorded identity");
    }
  }
}

export function upgradeReleasedV6(database: SqliteDatabase, checksum: string, now: () => number) {
  transaction(database, () => {
    const rows = database.prepare("SELECT version,name,checksum FROM schema_migrations").all() as
      Array<{ version: number; name: string; checksum: string }>;
    if (rows.length !== 1 || rows[0]?.version !== 6 || rows[0].name !== "chat-store" ||
        rows[0].checksum !== RELEASED_V6_CHECKSUM) throw new ChatSchemaError("corrupt", "Released Chat schema identity changed");
    assertReleasedColumns(database);
    const integrity = database.prepare("PRAGMA quick_check").all() as Array<Record<string, unknown>>;
    if (integrity.length !== 1 || Object.values(integrity[0]!)[0] !== "ok" ||
        database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new ChatSchemaError("corrupt", "Released Chat database failed upgrade integrity checks");
    }
    // v6 never saved complete before-facts. JSON null preserves that absence instead of inventing a baseline.
    database.exec(UPGRADE_SQL);
    if (database.prepare("PRAGMA foreign_key_check").all().length) {
      throw new ChatSchemaError("corrupt", "Chat upgrade did not preserve references");
    }
    database.prepare("UPDATE schema_migrations SET version=8,checksum=?,applied_at=? WHERE version=6")
      .run(checksum, now());
    database.exec("PRAGMA user_version = 8");
  });
}
