/**
 * [INPUT]: Depends on SQLite STRICT tables and JSON validation.
 * [OUTPUT]: Provides scoped sources, outbox, immutable classification/detached custody, observations, receipts and mirrors in the current Chat schema.
 * [POS]: Fresh-schema source folded into 0001; the independently pinned v6 upgrade lives in migrations.
 */
export const CHAT_CLOUD_SCHEMA = String.raw`
CREATE TABLE cloud_sync_state (
  environment TEXT NOT NULL, user_id TEXT NOT NULL,
  initial_manifest_json TEXT CHECK(initial_manifest_json IS NULL OR json_valid(initial_manifest_json)),
  meta_cursor TEXT, body_backfill_cursor TEXT,
  paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1)), updated_at INTEGER NOT NULL,
  PRIMARY KEY(environment,user_id)
) STRICT;
CREATE TABLE chat_retained_sources (
  source_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, kind TEXT NOT NULL,
  environment TEXT, user_id TEXT, local_device_id TEXT,
  revision INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  digest TEXT NOT NULL, created_at INTEGER NOT NULL,
  CHECK((environment IS NULL) = (user_id IS NULL))
) STRICT;
CREATE INDEX retained_sources_chat ON chat_retained_sources(chat_id,revision);
CREATE TABLE chat_retention_roots (
  root_id TEXT NOT NULL, source_id TEXT NOT NULL REFERENCES chat_retained_sources(source_id),
  PRIMARY KEY(root_id,source_id)
) STRICT;
CREATE TABLE chat_retained_attachments (
  source_id TEXT NOT NULL REFERENCES chat_retained_sources(source_id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL, PRIMARY KEY(source_id,attachment_id)
) STRICT;
CREATE TABLE chat_retained_import_blobs (
  source_id TEXT NOT NULL REFERENCES chat_retained_sources(source_id) ON DELETE CASCADE,
  content_digest TEXT NOT NULL REFERENCES chat_import_blobs(content_digest),
  PRIMARY KEY(source_id,content_digest)
) STRICT;
CREATE INDEX retained_import_digest ON chat_retained_import_blobs(content_digest);
CREATE INDEX retained_attachment_id ON chat_retained_attachments(attachment_id);
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
CREATE TABLE cloud_turn_receipts (
  environment TEXT NOT NULL, user_id TEXT NOT NULL, chat_id TEXT NOT NULL, turn_id TEXT NOT NULL,
  execution_epoch INTEGER NOT NULL, settlement_state TEXT NOT NULL CHECK(settlement_state IN ('open','sealing','settled')),
  receipt_json TEXT NOT NULL CHECK(json_valid(receipt_json)), updated_at INTEGER NOT NULL,
  PRIMARY KEY(environment,user_id,turn_id)
) STRICT;
CREATE INDEX cloud_receipts_chat ON cloud_turn_receipts(environment,user_id,chat_id);
CREATE TABLE cloud_blobs (
  environment TEXT NOT NULL, user_id TEXT NOT NULL, blob_id TEXT NOT NULL,
  sha256 TEXT NOT NULL, bytes INTEGER NOT NULL CHECK(bytes>=0), mime TEXT NOT NULL,
  local_path TEXT NOT NULL, last_used_at INTEGER NOT NULL,
  PRIMARY KEY(environment,user_id,blob_id)
) STRICT;
CREATE TABLE cloud_chat_mirrors (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  environment TEXT NOT NULL, user_id TEXT NOT NULL,
  portable_json TEXT NOT NULL CHECK(json_valid(portable_json)),
  preparation_json TEXT CHECK(preparation_json IS NULL OR json_valid(preparation_json))
) STRICT;
CREATE TABLE chat_classification_candidates (
  operation_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, environment TEXT, user_id TEXT,
  expected_revision INTEGER NOT NULL, old_classification_json TEXT NOT NULL,
  previous_json TEXT NOT NULL, candidate_json TEXT NOT NULL, candidate_hash TEXT NOT NULL,
  operation_json TEXT CHECK(operation_json IS NULL OR json_valid(operation_json)),
  receipt_json TEXT, state TEXT NOT NULL CHECK(state IN ('pending','conflicted','confirmed','committed','discarded','detached'))
) STRICT;
CREATE INDEX classification_candidates_chat ON chat_classification_candidates(chat_id,state);
CREATE TABLE chat_deletion_custody (
  operation_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, incarnation_id TEXT NOT NULL,
  classification_json TEXT NOT NULL, source_ids_json TEXT NOT NULL, created_at INTEGER NOT NULL
) STRICT;
CREATE TABLE cloud_tombstones (
  environment TEXT NOT NULL, user_id TEXT NOT NULL, chat_id TEXT NOT NULL,
  incarnation_id TEXT NOT NULL, deleted_at INTEGER NOT NULL,
  PRIMARY KEY(environment,user_id,chat_id)
) STRICT;
`;
