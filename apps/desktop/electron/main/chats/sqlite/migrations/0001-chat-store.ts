/**
 * [INPUT]: Depends only on SQLite DDL supported by the packaged Electron runtime
 * [OUTPUT]: Provides migration 0001: portable Chat rows, device-local execution facts, immutable imports pinned by generation whose runs outlive the generation they name, mutation receipts, the continuation saga, and position-free FTS5 search
 * [POS]: Initial Chat SQLite schema authority; repositories may depend on it but may not create ad-hoc tables
 */

export const CHAT_STORE_SCHEMA_V1 = String.raw`
CREATE TABLE chat_store_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE chats (
  id TEXT PRIMARY KEY,
  lifecycle_kind TEXT NOT NULL CHECK (lifecycle_kind IN ('native', 'external-readonly', 'external-managed')),
  agent TEXT NOT NULL,
  title TEXT,
  title_source TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  updated_at INTEGER NOT NULL CHECK (updated_at >= created_at),
  archived_at INTEGER,
  -- 每条 Chat 从诞生起就有身份，只读导入也不例外：读侧因此永远不必从
  -- 代际 id 摘一个假 incarnation，续聊也只是沿用它，而不是换一个新的。
  incarnation_id TEXT NOT NULL,
  next_seq INTEGER,
  trimmed_through_seq INTEGER NOT NULL DEFAULT 0 CHECK (trimmed_through_seq >= 0),
  branches_trimmed_through_seq INTEGER NOT NULL DEFAULT 0 CHECK (branches_trimmed_through_seq >= 0),
  core_revision INTEGER NOT NULL CHECK (core_revision >= 0),
  native_message_revision INTEGER NOT NULL CHECK (native_message_revision >= 0),
  CHECK (
    (lifecycle_kind = 'external-readonly' AND next_seq IS NULL)
    OR
    (lifecycle_kind IN ('native', 'external-managed') AND next_seq > 0)
  )
) STRICT;

CREATE INDEX chats_updated_idx ON chats(updated_at DESC, id);
CREATE INDEX chats_lifecycle_archive_idx
  ON chats(lifecycle_kind, archived_at, updated_at DESC, id);

CREATE TABLE chat_local_aggregate_state (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision >= 0),
  timeline_revision INTEGER NOT NULL CHECK (timeline_revision >= 0),
  PRIMARY KEY(chat_id, device_id)
) STRICT;

CREATE TABLE chat_local_memberships (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  local_project_id TEXT,
  visibility_state TEXT NOT NULL CHECK (visibility_state IN ('visible', 'archived', 'unavailable')),
  archived_at INTEGER,
  membership_revision INTEGER NOT NULL CHECK (membership_revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id, device_id)
) STRICT;

CREATE INDEX chat_memberships_project_idx
  ON chat_local_memberships(device_id, local_project_id, visibility_state);

CREATE TABLE chat_device_bindings (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('preparing', 'ready', 'unavailable', 'revoked')),
  home_dir TEXT,
  session_backend TEXT,
  session_id TEXT,
  session_tool_plan_json TEXT,
  start_state_json TEXT NOT NULL,
  binding_revision INTEGER NOT NULL CHECK (binding_revision >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id, device_id),
  CHECK (state <> 'ready' OR home_dir IS NOT NULL),
  CHECK (state NOT IN ('unavailable', 'revoked') OR (session_backend IS NULL AND session_id IS NULL))
) STRICT;

CREATE UNIQUE INDEX chat_bindings_session_idx
  ON chat_device_bindings(device_id, session_backend, session_id)
  WHERE session_backend IS NOT NULL AND session_id IS NOT NULL AND state = 'ready';

CREATE TABLE chat_local_authorities (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  app_role TEXT CHECK (app_role IN ('edit', 'use')),
  context_json TEXT NOT NULL,
  grants_json TEXT NOT NULL,
  grant_revision INTEGER NOT NULL CHECK (grant_revision >= 0),
  read_only_reason TEXT,
  authority_revision INTEGER NOT NULL CHECK (authority_revision >= 0),
  PRIMARY KEY(chat_id, device_id)
) STRICT;

CREATE TABLE chat_title_jobs (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('none', 'pending', 'completed', 'superseded')),
  job_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(chat_id, device_id)
) STRICT;

CREATE INDEX chat_title_jobs_state_idx
  ON chat_title_jobs(device_id, state, updated_at);

CREATE TABLE chat_messages (
  row_id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'notice')),
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL CHECK (created_at >= 0),
  payload_json TEXT NOT NULL,
  UNIQUE(chat_id, message_id),
  UNIQUE(chat_id, seq)
) STRICT;

CREATE INDEX chat_messages_tail_idx ON chat_messages(chat_id, seq DESC);

CREATE TABLE chat_message_attachments (
  message_row_id INTEGER NOT NULL REFERENCES chat_messages(row_id) ON DELETE CASCADE,
  attachment_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  PRIMARY KEY(message_row_id, attachment_id),
  UNIQUE(message_row_id, ordinal)
) STRICT;

CREATE INDEX chat_attachment_identity_idx
  ON chat_message_attachments(attachment_id);

CREATE TABLE chat_subagents (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  agent_thread_id TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  parts_json TEXT NOT NULL,
  PRIMARY KEY(chat_id, agent_thread_id)
) STRICT;

CREATE TABLE chat_superseded_branches (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  intent_id TEXT NOT NULL,
  superseded_at INTEGER NOT NULL,
  supersedes_user_message_id TEXT NOT NULL,
  through_seq_end INTEGER NOT NULL CHECK (through_seq_end > 0),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  PRIMARY KEY(chat_id, intent_id),
  UNIQUE(chat_id, ordinal)
) STRICT;

CREATE TABLE chat_branch_messages (
  chat_id TEXT NOT NULL,
  branch_intent_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  message_json TEXT NOT NULL,
  PRIMARY KEY(chat_id, branch_intent_id, ordinal),
  FOREIGN KEY(chat_id, branch_intent_id)
    REFERENCES chat_superseded_branches(chat_id, intent_id) ON DELETE CASCADE
) STRICT;

CREATE TABLE chat_import_origins (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  source_kind TEXT NOT NULL,
  storage_fingerprint TEXT NOT NULL,
  canonical_native_id TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  resume_alias TEXT NOT NULL,
  original_cwd TEXT NOT NULL,
  source_status TEXT NOT NULL CHECK (source_status IN ('match', 'changed', 'missing')),
  can_resume INTEGER NOT NULL CHECK (can_resume IN (0, 1)),
  adoption_snapshot_id TEXT,
  snapshot_digest TEXT,
  history_revision TEXT NOT NULL,
  source_size INTEGER NOT NULL CHECK (source_size >= 0),
  source_mtime_ns TEXT NOT NULL,
  last_imported_at INTEGER NOT NULL,
  managed_at INTEGER,
  UNIQUE(source_kind, storage_fingerprint, canonical_native_id)
) STRICT;

CREATE TABLE chat_import_generations (
  generation_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  history_revision TEXT NOT NULL,
  source_incarnation TEXT,
  source_size INTEGER NOT NULL CHECK (source_size >= 0),
  source_mtime_ns TEXT NOT NULL,
  incomplete_tail TEXT NOT NULL CHECK (incomplete_tail IN ('true', 'false', 'unknown')),
  state TEXT NOT NULL CHECK (state IN ('building', 'ready', 'superseded', 'abandoned')),
  entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  digest_codec_version INTEGER NOT NULL CHECK (digest_codec_version > 0),
  content_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(chat_id, generation_id),
  UNIQUE(chat_id, history_revision, content_digest)
) STRICT;

CREATE INDEX chat_import_generations_state_idx
  ON chat_import_generations(chat_id, state, created_at DESC);

CREATE TABLE chat_import_entry_versions (
  entry_version_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  source_entry_id TEXT NOT NULL,
  source_message_id TEXT,
  role TEXT NOT NULL,
  created_at INTEGER,
  payload_json TEXT NOT NULL,
  digest_codec_version INTEGER NOT NULL CHECK (digest_codec_version > 0),
  content_digest TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  content_complete INTEGER NOT NULL CHECK (content_complete IN (0, 1)),
  incomplete_reason TEXT,
  UNIQUE(chat_id, entry_version_id),
  UNIQUE(chat_id, source_entry_id, content_digest)
) STRICT;

CREATE TABLE chat_import_entry_version_chunks (
  entry_version_id TEXT NOT NULL REFERENCES chat_import_entry_versions(entry_version_id) ON DELETE CASCADE,
  field_kind TEXT NOT NULL,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  content TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  content_digest TEXT NOT NULL,
  PRIMARY KEY(entry_version_id, field_kind, ordinal)
) STRICT;

CREATE TABLE chat_import_blobs (
  content_digest TEXT PRIMARY KEY,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  local_path TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE chat_import_entry_blobs (
  entry_version_id TEXT NOT NULL REFERENCES chat_import_entry_versions(entry_version_id) ON DELETE CASCADE,
  field_kind TEXT NOT NULL,
  content_digest TEXT NOT NULL REFERENCES chat_import_blobs(content_digest),
  PRIMARY KEY(entry_version_id, field_kind)
) STRICT;

CREATE TABLE chat_import_generation_entries (
  chat_id TEXT NOT NULL,
  generation_id TEXT NOT NULL,
  delivery_seq INTEGER NOT NULL CHECK (delivery_seq > 0),
  entry_version_id TEXT NOT NULL,
  PRIMARY KEY(chat_id, generation_id, delivery_seq),
  UNIQUE(chat_id, generation_id, entry_version_id),
  FOREIGN KEY(chat_id, generation_id)
    REFERENCES chat_import_generations(chat_id, generation_id) ON DELETE CASCADE,
  FOREIGN KEY(chat_id, entry_version_id)
    REFERENCES chat_import_entry_versions(chat_id, entry_version_id)
) STRICT;

CREATE INDEX chat_import_generation_entries_version_idx
  ON chat_import_generation_entries(chat_id, entry_version_id);

CREATE TABLE chat_active_import_generations (
  chat_id TEXT PRIMARY KEY REFERENCES chats(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL,
  activated_at INTEGER NOT NULL,
  FOREIGN KEY(chat_id, generation_id)
    REFERENCES chat_import_generations(chat_id, generation_id)
) STRICT;

CREATE TRIGGER chat_active_generation_ready_insert
BEFORE INSERT ON chat_active_import_generations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM chat_import_generations
    WHERE chat_id = NEW.chat_id
      AND generation_id = NEW.generation_id
      AND state = 'ready'
  ) THEN RAISE(ABORT, 'active import generation must be ready') END;
END;

CREATE TRIGGER chat_active_generation_ready_update
BEFORE UPDATE ON chat_active_import_generations
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM chat_import_generations
    WHERE chat_id = NEW.chat_id
      AND generation_id = NEW.generation_id
      AND state = 'ready'
  ) THEN RAISE(ABORT, 'active import generation must be ready') END;
END;

CREATE TRIGGER chat_generation_active_state_guard
BEFORE UPDATE OF state ON chat_import_generations
WHEN NEW.state <> 'ready'
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM chat_active_import_generations
    WHERE chat_id = OLD.chat_id AND generation_id = OLD.generation_id
  ) THEN RAISE(ABORT, 'active import generation cannot leave ready state') END;
END;

CREATE TABLE chat_operations (
  operation_id TEXT PRIMARY KEY,
  request_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  target_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('committed', 'rejected')),
  result_json TEXT NOT NULL,
  committed_at INTEGER NOT NULL
) STRICT;

CREATE INDEX chat_operations_target_idx
  ON chat_operations(target_id, committed_at DESC);

CREATE TABLE chat_continuation_sagas (
  saga_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  generation_id TEXT,
  device_id TEXT NOT NULL,
  home_intent_id TEXT NOT NULL,
  continuation_input_json TEXT,
  home_receipt_json TEXT,
  home_dir_identity_json TEXT,
  intent_operation_id TEXT NOT NULL UNIQUE,
  finalize_operation_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK (state IN (
    'intent-written', 'home-preparing', 'home-committed', 'finalizing',
    'completed', 'rolling-back-precommit', 'committed-orphan', 'failed'
  )),
  last_error TEXT,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX chat_continuation_sagas_state_idx
  ON chat_continuation_sagas(state, updated_at);

/* generation_id 故意不带外键：一次导入的代际是可回收的物证，run 行是它的
   死亡证明。挂 ON DELETE CASCADE 时，回收一个 abandoned 代际会把那条
   failed 的 run 一并抹掉——于是谁也说不清那次导入为什么没成，GC 只好绕道。
   代际先走，判词留下。 */
CREATE TABLE history_import_runs (
  run_id TEXT PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  generation_id TEXT NOT NULL,
  source_kind TEXT NOT NULL,
  project_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('running', 'completed', 'cancelled', 'failed')),
  source_revision TEXT NOT NULL,
  source_incarnation TEXT NOT NULL,
  source_size INTEGER NOT NULL CHECK (source_size >= 0),
  source_mtime_ns TEXT NOT NULL,
  incomplete_tail TEXT NOT NULL CHECK (incomplete_tail IN ('true', 'false', 'unknown')),
  cursor_json TEXT NOT NULL,
  rolling_digest TEXT NOT NULL,
  committed_entry_count INTEGER NOT NULL CHECK (committed_entry_count >= 0),
  committed_bytes INTEGER NOT NULL CHECK (committed_bytes >= 0),
  last_delivery_seq INTEGER NOT NULL CHECK (last_delivery_seq >= 0),
  stats_json TEXT NOT NULL,
  last_error TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE INDEX history_import_runs_state_idx
  ON history_import_runs(state, updated_at);

CREATE UNIQUE INDEX history_import_runs_chat_running_idx
  ON history_import_runs(chat_id) WHERE state = 'running';

CREATE TABLE chat_search_documents (
  row_id INTEGER PRIMARY KEY,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  document_kind TEXT NOT NULL CHECK (document_kind IN ('title', 'native', 'imported-version')),
  source_row_id TEXT NOT NULL,
  projection_codec_version INTEGER NOT NULL CHECK (projection_codec_version > 0),
  source_semantic_digest TEXT NOT NULL,
  search_text TEXT NOT NULL,
  search_blob_ref TEXT,
  search_text_digest TEXT NOT NULL,
  grams_text TEXT NOT NULL,
  grams_digest TEXT NOT NULL,
  UNIQUE(chat_id, document_kind, source_row_id)
) STRICT;

CREATE INDEX chat_search_documents_chat_idx
  ON chat_search_documents(chat_id, document_kind, source_row_id);

CREATE VIRTUAL TABLE chat_search_fts USING fts5(
  grams_text,
  content='chat_search_documents',
  content_rowid='row_id',
  tokenize='unicode61 remove_diacritics 0',
  detail=none,
  columnsize=0
);

CREATE TRIGGER chat_search_documents_insert
AFTER INSERT ON chat_search_documents BEGIN
  INSERT INTO chat_search_fts(rowid, grams_text) VALUES (NEW.row_id, NEW.grams_text);
END;

CREATE TRIGGER chat_search_documents_delete
AFTER DELETE ON chat_search_documents BEGIN
  INSERT INTO chat_search_fts(chat_search_fts, rowid, grams_text)
  VALUES ('delete', OLD.row_id, OLD.grams_text);
END;

CREATE TRIGGER chat_search_documents_update
AFTER UPDATE ON chat_search_documents BEGIN
  INSERT INTO chat_search_fts(chat_search_fts, rowid, grams_text)
  VALUES ('delete', OLD.row_id, OLD.grams_text);
  INSERT INTO chat_search_fts(rowid, grams_text) VALUES (NEW.row_id, NEW.grams_text);
END;
`;
