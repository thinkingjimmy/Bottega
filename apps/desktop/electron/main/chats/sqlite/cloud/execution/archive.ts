/**
 * [INPUT]: Depends on retained source custody, native content and original scoped outbox rows.
 * [OUTPUT]: Preserves original-head native snapshots, independently readable variants and complete source roots after identity removal.
 * [POS]: Superseded-execution archive; its identity records the real head instead of inventing a turn receipt.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { ChatRecord } from "../../../../../../shared/chats-ipc";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { digest, json, type Row } from "../../repository/codec";
import { retainSource } from "../retention";
import { executionArchiveSchema } from "./contracts";
import { retainRecoveryVariants } from "../recovery/variants";
import { pinRecoveryHome } from "../recovery/home";
export function archiveExecution(db: SqliteDatabase, scope: SyncScope, head: CloudChatHead, record: ChatRecord, outbox: Row[], now: number) {
  const content = { head, classification: head.chat.classification, messages: record.messages, subagents: record.subagents ?? {},
    branches: record.supersededBranches ?? [], trimmedThroughSeq: record.trimmedThroughSeq ?? 0,
    outbox: outbox.map(row => ({ id: row.id, kind: row.kind, payloadDigest: row.payload_digest, source: JSON.parse(String(row.payload_json)) })) };
  const branchId = digest(json([scope, head.chat.id, head.chat.incarnationId, head.bodyRevision, content]));
  const rootId = `settlement:${head.chat.id}:execution:${branchId}`;
  const prior = db.prepare(`SELECT s.payload_json FROM chat_retention_roots r JOIN chat_retained_sources s ON s.source_id=r.source_id
    WHERE r.root_id=? AND s.kind='superseded-execution-archive'`).get(rootId) as Row | undefined;
  if (prior) return executionArchiveSchema.parse(JSON.parse(String(prior.payload_json)));
  for (const row of outbox) db.prepare(`INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id)
    SELECT ?,source_id FROM chat_retention_roots WHERE root_id=?`).run(rootId, `outbox:${row.id}`);
  const body = retainSource(db, { scope, chatId: head.chat.id, rootId, kind: "superseded-execution-content", revision: head.bodyRevision, payload: content, now });
  const descriptor = executionArchiveSchema.parse({ branchId, chatId: head.chat.id, title: head.chat.title, incarnationId: head.chat.incarnationId,
    bodyRevision: head.bodyRevision, canonicalHeadSeq: head.headSeq, createdAt: now, messageCount: record.messages.length, body });
  retainSource(db, { scope, chatId: head.chat.id, rootId, kind: "superseded-execution-archive", revision: head.bodyRevision, payload: descriptor, now });
  pinRecoveryHome(db, scope, record.id, record.incarnationId, record.messages, rootId, now);
  retainRecoveryVariants(db, scope, head, record, outbox, branchId, now);
  return descriptor;
}
export function executionArchivePage(db: SqliteDatabase, scope: SyncScope, chatId: string, afterId: string | null, limit: number) {
  const rows = db.prepare(`SELECT s.source_id,s.payload_json FROM chat_retained_sources s WHERE s.chat_id=? AND s.environment=? AND s.user_id=?
    AND s.kind='superseded-execution-archive' AND s.source_id>? AND EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=s.source_id)
    ORDER BY s.source_id LIMIT ?`).all(chatId, scope.environment, scope.userId, afterId ?? "", limit + 1) as Row[];
  const page = rows.slice(0, limit), complete = rows.length <= limit;
  return { items: page.map(row => executionArchiveSchema.parse(JSON.parse(String(row.payload_json)))), cursor: complete ? null : String(page.at(-1)!.source_id), complete };
}
