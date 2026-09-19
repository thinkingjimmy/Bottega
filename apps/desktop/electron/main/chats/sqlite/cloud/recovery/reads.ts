/**
 * [INPUT]: Depends on the sole SQLite connection, scoped retained roots and archive descriptors.
 * [OUTPUT]: Reads metadata-only archive and version pages without changing source content.
 * [POS]: Recovery custody leaf; receipt transactions remain owned by ChatRepository.
 */
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { recoveryArchiveSchema } from "./contracts";
const kinds = { "superseded-turn-archive": "turn", "superseded-execution-archive": "execution", "superseded-import-archive": "imported", "superseded-home-archive": "home" } as const;
const selection = `SELECT s.* FROM chat_retained_sources s WHERE s.chat_id=? AND s.environment=? AND s.user_id=?
  AND s.kind IN ('superseded-turn-archive','superseded-execution-archive','superseded-import-archive','superseded-home-archive')
  AND EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=s.source_id)`;
function project(row: Row) {
  const value = JSON.parse(String(row.payload_json)), archiveId = String(row.source_id), chatId = String(row.chat_id);
  return recoveryArchiveSchema.parse({ archiveId, chatId, kind: kinds[row.kind as keyof typeof kinds], createdAt: Number(row.created_at),
    messageCount: value.messageCount ?? null, origin: value.origin ?? null, source: { sourceId: archiveId, digest: row.digest } });
}
export function recoveryArchive(db: SqliteDatabase, scope: SyncScope, chatId: string, archiveId: string) {
  const row = db.prepare(`${selection} AND s.source_id=?`).get(chatId, scope.environment, scope.userId, archiveId) as Row | undefined;
  if (!row) throw new Error("RECOVERY_ARCHIVE_UNAVAILABLE"); return project(row);
}
export function recoveryPage(db: SqliteDatabase, scope: SyncScope, chatId: string, afterId: string | null, limit: number) {
  const rows = db.prepare(`${selection} AND s.source_id>? ORDER BY s.source_id LIMIT ?`).all(chatId, scope.environment, scope.userId, afterId ?? "", limit + 1) as Row[];
  const page = rows.slice(0, limit), complete = rows.length <= limit;
  return { items: page.map(project), cursor: complete ? null : String(page.at(-1)!.source_id), complete };
}
export function recoveryRelatedHome(db: SqliteDatabase, scope: SyncScope, chatId: string, archiveId: string) {
  recoveryArchive(db, scope, chatId, archiveId);
  const row = db.prepare(`SELECT DISTINCT h.* FROM chat_retention_roots a JOIN chat_retention_roots r ON r.root_id=a.root_id
    JOIN chat_retained_sources h ON h.source_id=r.source_id WHERE a.source_id=? AND h.chat_id=? AND h.environment=? AND h.user_id=?
    AND h.kind='superseded-home-archive' ORDER BY json_extract(h.payload_json,'$.job.userSeq') DESC,h.source_id LIMIT 1`)
    .get(archiveId, chatId, scope.environment, scope.userId) as Row | undefined;
  const pending = db.prepare(`SELECT 1 FROM chat_retention_roots a JOIN chat_retention_roots r ON r.root_id=a.root_id
    JOIN chat_retained_sources s ON s.source_id=r.source_id JOIN cloud_outbox o ON o.id=json_extract(s.payload_json,'$.jobId')
    WHERE a.source_id=? AND s.kind='recovery-home-owner' AND o.environment=? AND o.user_id=?
    AND NOT EXISTS(SELECT 1 FROM cloud_outbox_checkpoints c WHERE c.outbox_id=o.id AND c.checkpoint_key='home-manifest') LIMIT 1`)
    .get(archiveId, scope.environment, scope.userId);
  if (pending) throw new Error("RECOVERY_HOME_CAPTURE_PENDING");
  return row ? project(row) : null;
}
