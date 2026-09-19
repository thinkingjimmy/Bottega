/**
 * [INPUT]: Depends on the existing retained-source/attachment owners and immutable settlement identities.
 * [OUTPUT]: Archives superseded local results and lists their bounded, canonical-linked read-only descriptors.
 * [POS]: SQLite settlement custody; branches share the existing source Store and never become executable history.
 */
import type { CloudTurnReceipt } from "@ai-chat/cloud-protocol/chats/content/completion";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { digest, json, type Row } from "../../repository/codec";
import { retainSource } from "../retention";
import { pinRecoveryHome } from "../recovery/home";
import { messageSchema } from "../../../chat-schema";
export function archiveSupersededTail(db: SqliteDatabase, scope: SyncScope, receipt: CloudTurnReceipt, payload: unknown, now: number) {
  const branchId = digest(json([scope, receipt.turnId, receipt.resultHash, payload])), rootId = `settlement:${receipt.turnId}:branch:${branchId}`;
  const existing = db.prepare(`SELECT s.payload_json FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
    WHERE r.root_id=? AND s.kind='superseded-turn-archive'`).get(rootId) as Row | undefined;
  if (existing) return JSON.parse(String(existing.payload_json));
  const body = retainSource(db, { scope, chatId: receipt.chatId, rootId, kind: "superseded-tail", revision: receipt.assistantSeq, payload, now });
  const descriptor = { branchId, chatId: receipt.chatId, turnId: receipt.turnId, canonicalResultHash: receipt.resultHash!,
    assistantSeq: receipt.assistantSeq, createdAt: now, messageCount: Array.isArray((payload as { messages?: unknown }).messages) ? (payload as { messages: unknown[] }).messages.length : 0, body };
  retainSource(db, { scope, chatId: receipt.chatId, rootId, kind: "superseded-turn-archive", revision: receipt.assistantSeq, payload: descriptor, now });
  pinRecoveryHome(db, scope, receipt.chatId, receipt.incarnationId,
    descriptor.messageCount ? (payload as { messages: unknown[] }).messages.map(message => messageSchema.parse(message)) : [], rootId, now);
  return descriptor;
}
export function archivedTurnPage(db: SqliteDatabase, scope: SyncScope, chatId: string, afterId: string | null, limit: number) {
  const rows = db.prepare(`SELECT s.source_id,s.payload_json FROM chat_retained_sources s
    WHERE s.chat_id=? AND s.environment=? AND s.user_id=? AND s.kind='superseded-turn-archive' AND s.source_id>?
      AND EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=s.source_id) ORDER BY s.source_id LIMIT ?`)
    .all(chatId, scope.environment, scope.userId, afterId ?? "", limit + 1) as Row[];
  const page = rows.slice(0, limit), complete = rows.length <= limit;
  return { items: page.map(row => JSON.parse(String(row.payload_json))), cursor: complete ? null : String(page.at(-1)!.source_id), complete };
}
