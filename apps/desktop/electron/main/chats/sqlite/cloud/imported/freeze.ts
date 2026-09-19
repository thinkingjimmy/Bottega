/**
 * [INPUT]: Depends on confirmed managed Chat heads and original scanner identity/run tables.
 * [OUTPUT]: Permanently freezes a local source and rejects in-flight scanner publication after cloud takeover.
 * [POS]: Same-transaction metadata fence; no synthetic local source identity or executable binding is created.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { retainSource, releaseRoot } from "../retention";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
export function freezeClaimedImport(db: SqliteDatabase, scope: SyncScope, head: CloudChatHead, now: number) {
  if (head.kind !== "external-managed") return;
  db.prepare("UPDATE chat_import_origins SET managed_at=COALESCE(managed_at,?),can_resume=0 WHERE chat_id=?").run(now, head.chat.id);
  db.prepare(`UPDATE chat_import_generations SET state='abandoned' WHERE state='building' AND generation_id IN
    (SELECT generation_id FROM history_import_runs WHERE chat_id=? AND state='running')`).run(head.chat.id);
  db.prepare("UPDATE history_import_runs SET state='cancelled',last_error='Cloud execution claimed',updated_at=? WHERE chat_id=? AND state='running'").run(now, head.chat.id);
  const candidates = db.prepare(`SELECT * FROM cloud_outbox WHERE entity_kind='generation' AND execution_epoch<?
    AND environment=? AND user_id=? AND json_extract(payload_json,'$.chatId')=? AND COALESCE(metadata_status,'') NOT IN ('queued','blocked','conflicted')`)
    .all(head.executionEpoch, scope.environment, scope.userId, head.chat.id) as Row[];
  for (const item of candidates) {
    const manifest = JSON.parse(String(item.payload_json));
    const rootId = `settlement:${head.chat.id}:import:${hashChatContent([scope, item.id])}`;
    db.prepare("INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id) SELECT ?,source_id FROM chat_retention_roots WHERE root_id=?").run(rootId, `outbox:${item.id}`);
    retainSource(db, { chatId: head.chat.id, scope, kind: "superseded-import-archive", revision: Number(item.seq_or_revision), rootId, now,
      payload: { chatId: head.chat.id, incarnationId: head.chat.incarnationId, operationId: item.id, executionEpoch: item.execution_epoch,
        replacedByEpoch: head.executionEpoch, source: manifest.sources[0], createdAt: now } });
    db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(item.id)); releaseRoot(db, `outbox:${item.id}`);
  }
}
