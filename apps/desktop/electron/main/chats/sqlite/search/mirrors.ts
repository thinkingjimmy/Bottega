/**
 * [INPUT]: Depends on verified complete mirror bodies and the canonical search writer.
 * [OUTPUT]: Backfills every cached message without granting native device membership.
 * [POS]: Derived FTS maintenance for complete cloud histories, including old caches.
 */
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../connection";
import type { ChatRecordWriter } from "../repository/writer";
import { messageSearchText } from "../repository/codec";
import { mirrorReferences, readMirrorBody } from "../cloud/mirror/references";

export function indexConfirmedMirror(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, chatId: string) {
  db.prepare("DELETE FROM chat_search_documents WHERE chat_id=? AND document_kind='native' AND source_row_id NOT LIKE 'mirror:%'").run(chatId);
  const existing = db.prepare("SELECT 1 FROM chat_search_documents WHERE chat_id=? AND document_kind='native' AND source_row_id=?");
  let cursor: number | null = null, added = 0;
  while (true) {
    const page = mirrorReferences(db, scope, chatId, cursor, 100);
    for (const reference of page) {
      const sourceRowId = `mirror:${reference.sourceId}`;
      if (existing.get(chatId, sourceRowId)) continue;
      const message = readMirrorBody(db, reference).message;
      if (message.role === "notice") continue;
      writer.writeSearchDocument(chatId, "native", sourceRowId, messageSearchText(message));
      added++;
    }
    if (page.length < 100) return added;
    cursor = page.at(-1)!.seq;
  }
}
