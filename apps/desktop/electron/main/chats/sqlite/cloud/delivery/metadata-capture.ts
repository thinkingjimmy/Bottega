/**
 * [INPUT]: Depends on the sole Chat transaction, canonical metadata and current confirmed/causal state.
 * [OUTPUT]: Captures title/archive/sortKey intents and initial option observations atomically with business saves.
 * [POS]: Outbox producer leaf; receipt delivery cannot silently replace an offline edit's baseline.
 */
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { cloudChatHeadSchema, type PortableChat } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatFacts } from "../../../chat-summary";
import type { SqliteDatabase } from "../../connection";
import { type Row } from "../../repository/codec";
import { chatMetadataIntentSchema, chatMetadataValuesSchema, type ChatMetadataIntent } from "./metadata-contracts";

export function metadataState(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const row = db.prepare("SELECT * FROM cloud_chat_metadata_state WHERE chat_id=? AND environment=? AND user_id=?")
    .get(chatId, scope.environment, scope.userId) as Row | undefined;
  if (!row) throw new Error("CHAT_METADATA_BASELINE_UNAVAILABLE"); return row;
}
const valuesOf = (facts: { title: PortableChat["title"]; archivedAt?: number | null; sortKey?: number | null }) =>
  chatMetadataValuesSchema.parse({ title: facts.title, archivedAt: facts.archivedAt ?? null, sortKey: facts.sortKey ?? null });
export function captureInitialMetadata(db: SqliteDatabase, scope: SyncScope, outboxId: string,
  snapshot: { chat: PortableChat; lifecycleKind: string; archivedAt: number | null }) {
  const intent = chatMetadataIntentSchema.parse({ kind: "create", operationId: hashChatContent(["chat-create", outboxId]), ...snapshot });
  db.prepare(`INSERT INTO cloud_chat_metadata_state(chat_id,environment,user_id,observed_json,tail_operation_id,execution_observed_json)
    VALUES(?,?,?,?,?,?)`).run(snapshot.chat.id, scope.environment, scope.userId, canonicalJson(valuesOf({ ...snapshot.chat, archivedAt: snapshot.archivedAt })), intent.operationId,
      canonicalJson({ options: snapshot.chat.options, agentRevision: snapshot.chat.agentRevision }));
  db.prepare("UPDATE cloud_outbox SET metadata_intent_json=?,metadata_status='queued' WHERE id=?")
    .run(canonicalJson(intent), outboxId);
}
export function captureMetadataEdit(db: SqliteDatabase, scope: SyncScope, outboxId: string, facts: ChatFacts) {
  const state = metadataState(db, scope, facts.id);
  const current = chatMetadataValuesSchema.parse(JSON.parse(String(state.observed_json))), next = valuesOf(facts);
  if (canonicalJson(current) === canonicalJson(next)) return;
  if (state.deleted) throw new Error("CHAT_CLOUD_DELETED");
  if (state.conflicted) throw new Error("CHAT_METADATA_CONFLICT_REQUIRES_RESOLUTION");
  const head = state.confirmed_json ? cloudChatHeadSchema.parse(JSON.parse(String(state.confirmed_json))) : null;
  const stored = db.prepare("SELECT cloud_revision FROM chats WHERE id=?").get(facts.id) as Row;
  const revision = head?.chat.cloudRevision ?? Number(stored.cloud_revision);
  if (!state.tail_operation_id && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error("CHAT_METADATA_BASELINE_UNAVAILABLE");
  const intent: ChatMetadataIntent = chatMetadataIntentSchema.parse({ kind: "patch", operationId: hashChatContent(["chat-metadata", outboxId]), chatId: facts.id,
    incarnationId: facts.incarnationId, changes: { ...(current.title !== next.title ? { title: next.title } : {}),
      ...(current.archivedAt !== next.archivedAt ? { archivedAt: next.archivedAt } : {}),
      ...(current.sortKey !== next.sortKey ? { sortKey: next.sortKey } : {}) },
    basis: state.tail_operation_id ? { kind: "receipt", operationId: state.tail_operation_id } : { kind: "revision", revision } });
  db.prepare("UPDATE cloud_outbox SET metadata_intent_json=?,metadata_status='queued' WHERE id=?").run(canonicalJson(intent), outboxId);
  db.prepare("UPDATE cloud_chat_metadata_state SET observed_json=?,tail_operation_id=? WHERE chat_id=?")
    .run(canonicalJson(next), intent.operationId, facts.id);
}
export function captureMirrorMetadata(db: SqliteDatabase, scope: SyncScope, chat: PortableChat) {
  const row = db.prepare("SELECT archived_at FROM chats WHERE id=?").get(chat.id) as Row;
  db.prepare(`INSERT INTO cloud_chat_metadata_state(chat_id,environment,user_id,observed_json)
    VALUES(?,?,?,?) ON CONFLICT(chat_id) DO UPDATE SET observed_json=excluded.observed_json,confirmed_json=NULL
    WHERE cloud_chat_metadata_state.tail_operation_id IS NULL AND cloud_chat_metadata_state.conflicted=0`)
    .run(chat.id, scope.environment, scope.userId, canonicalJson(valuesOf({ ...chat, archivedAt: row.archived_at === null ? null : Number(row.archived_at) })));
}
