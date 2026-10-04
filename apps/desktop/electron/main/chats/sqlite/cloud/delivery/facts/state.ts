/**
 * [INPUT]: Depends on scoped metadata state and immutable intents in the sole Chat outbox.
 * [OUTPUT]: Provides bounded durable candidates, pending projections and a recovery decision fence.
 * [POS]: SQLite facts read model; mirrored classification never creates a local role or binding.
 */
import type { SyncScope } from "../../../../../../../shared/local-storage/contracts";
import { chatFactsViewSchema } from "../../../../../../../shared/cloud/facts";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SqliteDatabase } from "../../../connection";
import type { Row } from "../../../repository/codec";
import { readMetadataState } from "../metadata-confirm";
import { metadataState } from "../metadata-capture";
import { chatMetadataIntentSchema, chatMetadataValuesSchema } from "../metadata-contracts";
const withoutSortKey = <T extends { sortKey?: number }>({ sortKey: _sortKey, ...chat }: T) => chat;
export function readChatFacts(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const state = readMetadataState(db, scope, chatId);
  const rows = db.prepare(`SELECT id,metadata_intent_json,metadata_status FROM cloud_outbox WHERE environment=? AND user_id=?
    AND json_extract(payload_json,'$.chatId')=? AND metadata_status IN ('queued','blocked','conflicted','deleted')
    ORDER BY seq_or_revision,created_at,id LIMIT 10001`).all(scope.environment, scope.userId, chatId) as Row[];
  if (rows.length > 10000) throw new Error("CHAT_METADATA_CANDIDATE_BUDGET");
  const candidate: { title?: string | null; archivedAt?: number | null; sortKey?: number | null } = {};
  let creation = false;
  for (const row of rows) {
    const intent = chatMetadataIntentSchema.parse(JSON.parse(String(row.metadata_intent_json)));
    if (intent.kind === "create") creation = true; else Object.assign(candidate, intent.changes);
  }
  const values = chatMetadataValuesSchema.parse(JSON.parse(String(metadataState(db, scope, chatId).observed_json)));
  return chatFactsViewSchema.parse({ pendingCount: state.pendingCount, conflictCount: state.conflictCount,
    head: state.head && !state.conflicted && !state.deleted ? { ...state.head, chat: { ...withoutSortKey(state.head.chat), title: values.title,
      ...(values.sortKey === null ? {} : { sortKey: values.sortKey }) }, archivedAt: values.archivedAt } : state.head,
    status: state.deleted ? "deleted" : state.conflicted ? "conflicted" : state.pendingCount ? "pending" : "idle",
    candidate: !creation && Object.keys(candidate).length ? candidate : null,
    queueHash: hashChatContent(rows.map(row => [row.id, row.metadata_intent_json, row.metadata_status])) });
}
