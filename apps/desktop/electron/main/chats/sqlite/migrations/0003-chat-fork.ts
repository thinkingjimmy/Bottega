/**
 * [INPUT]: Depends only on SQLite DDL supported by the packaged Electron runtime
 * [OUTPUT]: Provides migration 0003 for atomic fork lineage and device-local managed-worktree execution bindings
 * [POS]: Forward-only Chat fork schema step after the immutable v1/v2 migrations
 */

export const CHAT_STORE_SCHEMA_V3 = String.raw`
ALTER TABLE chats ADD COLUMN parent_chat_id TEXT;
ALTER TABLE chats ADD COLUMN parent_incarnation_id TEXT;
ALTER TABLE chats ADD COLUMN parent_message_id TEXT;
ALTER TABLE chats ADD COLUMN inherited_through_seq INTEGER CHECK (inherited_through_seq > 0);

ALTER TABLE chat_device_bindings ADD COLUMN execution_dir TEXT;
ALTER TABLE chat_device_bindings ADD COLUMN execution_kind TEXT
  CHECK (execution_kind IS NULL OR execution_kind = 'managed-worktree');

CREATE TRIGGER chats_lineage_insert_check BEFORE INSERT ON chats
WHEN NOT (
  (NEW.parent_chat_id IS NULL AND NEW.parent_incarnation_id IS NULL
    AND NEW.parent_message_id IS NULL AND NEW.inherited_through_seq IS NULL)
  OR
  (NEW.parent_chat_id IS NOT NULL AND NEW.parent_incarnation_id IS NOT NULL
    AND NEW.parent_message_id IS NOT NULL AND NEW.inherited_through_seq IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'fork lineage facts must be atomic'); END;

CREATE TRIGGER chats_lineage_update_check
BEFORE UPDATE OF parent_chat_id, parent_incarnation_id, parent_message_id, inherited_through_seq ON chats
WHEN NOT (
  (NEW.parent_chat_id IS NULL AND NEW.parent_incarnation_id IS NULL
    AND NEW.parent_message_id IS NULL AND NEW.inherited_through_seq IS NULL)
  OR
  (NEW.parent_chat_id IS NOT NULL AND NEW.parent_incarnation_id IS NOT NULL
    AND NEW.parent_message_id IS NOT NULL AND NEW.inherited_through_seq IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT, 'fork lineage facts must be atomic'); END;

CREATE TRIGGER chat_execution_insert_check BEFORE INSERT ON chat_device_bindings
WHEN NOT (
  (NEW.execution_dir IS NULL AND NEW.execution_kind IS NULL)
  OR
  (NEW.execution_dir IS NOT NULL AND NEW.execution_kind = 'managed-worktree')
)
BEGIN SELECT RAISE(ABORT, 'execution binding facts must be atomic'); END;

CREATE TRIGGER chat_execution_update_check
BEFORE UPDATE OF execution_dir, execution_kind ON chat_device_bindings
WHEN NOT (
  (NEW.execution_dir IS NULL AND NEW.execution_kind IS NULL)
  OR
  (NEW.execution_dir IS NOT NULL AND NEW.execution_kind = 'managed-worktree')
)
BEGIN SELECT RAISE(ABORT, 'execution binding facts must be atomic'); END;
`;
