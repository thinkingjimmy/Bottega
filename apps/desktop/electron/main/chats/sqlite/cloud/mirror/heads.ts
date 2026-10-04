/**
 * [INPUT]: Depends on canonical metadata reconciliation and the existing authority-free mirror writer.
 * [OUTPUT]: Deletion-fenced portable metadata, monotonic owner cursors and separate durable candidate/residence catalog facts without execution authority.
 * [POS]: SQLite downlink metadata boundary; body hydration is independent.
 */
import { cloudChatHeadSchema, type CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { ChatRecordWriter } from "../../repository/writer";
import type { MirrorTransactions } from "../mirrors";
import { json, type Row } from "../../repository/codec";
import { acceptMetadataHead, readMetadataState } from "../delivery/metadata-confirm";
import { chatCatalogFactsSchema } from "@ai-chat/chat-ui/model";
import { catalogCursorsSchema, type catalogTopicSchema } from "./contracts";
import type { z } from "zod";
export function putMirrorHead(db: SqliteDatabase, writer: ChatRecordWriter, mirrors: MirrorTransactions, scope: SyncScope,
  deviceId: string, head: CloudChatHead, now: number) {
  if (db.prepare("SELECT 1 FROM cloud_tombstones WHERE environment=? AND user_id=? AND chat_id=?").get(scope.environment, scope.userId, head.chat.id)) return { chatId: head.chat.id };
  let row = db.prepare("SELECT * FROM chats WHERE id=?").get(head.chat.id) as Row | undefined;
  if (!row) {
    mirrors.put({ type: "put-mirror", chat: head.chat, messages: [], subagents: {} }, scope);
    row = db.prepare("SELECT * FROM chats WHERE id=?").get(head.chat.id) as Row;
  }
  acceptMetadataHead(db, writer, scope, deviceId, head, now);
  const confirmed = readMetadataState(db, scope, head.chat.id).head as CloudChatHead | null;
  if (row.cloud_state === "mirror" && confirmed) {
    db.prepare(`UPDATE chats SET agent=?,agent_revision=?,options_json=?,conversation_kind=?,portable_app_id=?,portable_project_id=?,updated_at=? WHERE id=?`)
      .run(confirmed.chat.agent, confirmed.chat.agentRevision, json(confirmed.chat.options), confirmed.chat.classification.conversationKind,
        confirmed.chat.classification.appId, confirmed.chat.classification.projectId, confirmed.chat.updatedAt, head.chat.id);
  }
  return { chatId: head.chat.id };
}
export function readCatalogCursors(db: SqliteDatabase, scope: SyncScope) {
  const row = db.prepare("SELECT meta_cursor FROM cloud_sync_state WHERE environment=? AND user_id=?").get(scope.environment, scope.userId) as Row | undefined;
  return catalogCursorsSchema.parse(row?.meta_cursor ? JSON.parse(String(row.meta_cursor)) : { chats: 0, projects: 0 });
}
export function confirmedChatPage(db: SqliteDatabase, scope: SyncScope, afterId: string | null, limit: number) {
  const rows = db.prepare(`SELECT chat_id,confirmed_json FROM cloud_chat_metadata_state
    WHERE environment=? AND user_id=? AND chat_id>? AND confirmed_json IS NOT NULL AND deleted=0 ORDER BY chat_id LIMIT ?`)
    .all(scope.environment, scope.userId, afterId ?? "", limit + 1) as Row[];
  const page = rows.slice(0, limit), complete = rows.length <= limit;
  return { items: page.map(row => cloudChatHeadSchema.parse(JSON.parse(String(row.confirmed_json)))),
    cursor: complete ? null : String(page.at(-1)!.chat_id), complete };
}
export function confirmedCatalog(db: SqliteDatabase, scope: SyncScope, afterRevision: number, throughRevision: number | null) {
  const current = readCatalogCursors(db, scope).chats, revision = throughRevision ?? current;
  if (revision > current || afterRevision > revision) throw new Error("CATALOG_CURSOR_INVALID");
  const rows = db.prepare(`SELECT confirmed_json,observed_json,conflicted,deleted,tail_operation_id,
    (SELECT cloud_state FROM chats WHERE id=cloud_chat_metadata_state.chat_id) residence FROM cloud_chat_metadata_state WHERE environment=? AND user_id=?
    AND json_extract(confirmed_json,'$.catalogRevision')>? AND json_extract(confirmed_json,'$.catalogRevision')<=?
    ORDER BY json_extract(confirmed_json,'$.catalogRevision') LIMIT 51`).all(scope.environment, scope.userId, afterRevision, revision) as Row[];
  const items = rows.slice(0, 50).map(row => cloudChatHeadSchema.parse(JSON.parse(String(row.confirmed_json))));
  const facts = rows.slice(0, 50).map((row, index) => chatCatalogFactsSchema.parse({ chatId: items[index]!.chat.id, residence: row.residence === "mirror" ? "mirror" : "native",
    ...JSON.parse(String(row.observed_json)), state: row.deleted ? "deleted" : row.conflicted ? "conflicted" : row.tail_operation_id ? "pending" : "idle" }));
  return { items, facts, revision, complete: rows.length <= 50, cursor: rows.length <= 50 ? null : items.at(-1)!.catalogRevision };
}
export function advanceCatalog(db: SqliteDatabase, scope: SyncScope, topic: z.infer<typeof catalogTopicSchema>, expectedRevision: number, revision: number, now: number) {
  const cursors = readCatalogCursors(db, scope);
  if (cursors[topic] !== expectedRevision || revision < expectedRevision) throw new Error("CATALOG_CURSOR_CONFLICT");
  cursors[topic] = revision;
  db.prepare("UPDATE cloud_sync_state SET meta_cursor=?,updated_at=? WHERE environment=? AND user_id=?").run(json(cursors), now, scope.environment, scope.userId);
  return cursors;
}
