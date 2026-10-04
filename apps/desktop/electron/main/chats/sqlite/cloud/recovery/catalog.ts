/**
 * [INPUT]: Depends on scoped immutable retention roots, frozen metadata edits and bounded recovery contracts.
 * [OUTPUT]: Lists retained content after its original Chat is removed and projects original unsent mirror edits.
 * [POS]: Read-only SQLite recovery catalog; no native identity or execution authority is created.
 */
import { z } from "zod";
import { cloudChatHeadSchema } from "@ai-chat/cloud-protocol/chats/model";
import { retainedCatalogSchema, retainedMetadataSchema } from "../../../../../../shared/cloud/recovery";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { readRetainedSource } from "../inventory/source";
import { retainedSourceRefSchema } from "../delivery/contracts";
const selection = `SELECT s.* FROM chat_retained_sources s WHERE s.environment=? AND s.user_id=?
  AND s.kind IN ('superseded-turn-archive','superseded-execution-archive','superseded-import-archive','superseded-home-archive','deleted-mirror-candidate')
  AND EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=s.source_id)`;
const object = z.record(z.string(), z.unknown());
const kinds = { "superseded-turn-archive": "turn", "superseded-execution-archive": "execution", "superseded-import-archive": "imported", "superseded-home-archive": "home", "deleted-mirror-candidate": "metadata" } as const;
function payload(db: SqliteDatabase, row: Row) {
  return object.parse(readRetainedSource(db, { sourceId: String(row.source_id), digest: String(row.digest) }));
}
function title(row: Row, value: Record<string, unknown>) {
  if (typeof value.title === "string") return value.title;
  let candidate: unknown = null;
  if (row.kind === "deleted-mirror-candidate") {
    const metadata = object.nullish().parse(value.metadata); candidate = metadata?.confirmed_json ? JSON.parse(String(metadata.confirmed_json)) : null;
  }
  const head = cloudChatHeadSchema.safeParse(candidate);
  return head.success ? head.data.chat.title : null;
}
export function retainedCatalog(db: SqliteDatabase, scope: SyncScope, afterId: string | null) {
  // The frozen schema has a source identity index, so scan a fixed identity page instead of an unbounded kind filter.
  const rows = db.prepare("SELECT * FROM chat_retained_sources WHERE source_id>? ORDER BY source_id LIMIT 65").all(afterId ?? "") as Row[];
  const page = rows.slice(0, 64), items = []; let consumed = 0;
  for (const row of page) {
    consumed++;
    if (row.environment !== scope.environment || row.user_id !== scope.userId || !(String(row.kind) in kinds) ||
      !db.prepare("SELECT 1 FROM chat_retention_roots WHERE source_id=? LIMIT 1").get(String(row.source_id))) continue;
    const value = object.parse(JSON.parse(String(row.payload_json)));
    items.push({ archiveId: row.source_id, chatId: row.chat_id, kind: kinds[row.kind as keyof typeof kinds], title: title(row, value),
      createdAt: row.created_at, messageCount: value.messageCount ?? null, origin: value.origin ?? null });
    if (items.length === 20) break;
  }
  const complete = rows.length <= 64 && consumed === page.length;
  return retainedCatalogSchema.parse({ items, cursor: complete ? null : page[consumed - 1]!.source_id, complete });
}
export function retainedMetadata(db: SqliteDatabase, scope: SyncScope, chatId: string, archiveId: string, before: number | null) {
  const row = db.prepare(`${selection} AND s.chat_id=? AND s.source_id=? AND s.kind='deleted-mirror-candidate'`)
    .get(scope.environment, scope.userId, chatId, archiveId) as Row | undefined;
  if (!row) throw new Error("RECOVERY_CANDIDATE_UNAVAILABLE");
  const value = payload(db, row), operations = z.array(object).parse(value.operations), offset = before ?? 0;
  if (offset > operations.length) throw new Error("RECOVERY_CURSOR_INVALID");
  const edits = [];
  for (const operation of operations.slice(offset, offset + 20)) {
    const manifest = object.parse(operation.source), sources = z.array(retainedSourceRefSchema).parse(manifest.sources);
    for (const source of sources.slice(0, 1)) {
      const content = object.parse(readRetainedSource(db, source)), changes = object.optional().parse(content.changes);
      if (changes) edits.push({ operationId: operation.id, ...(typeof changes.title === "string" || changes.title === null ? { title: changes.title } : {}),
        ...("archivedAt" in changes ? { archived: changes.archivedAt !== null } : {}) });
    }
  }
  const cursor = offset + 20 < operations.length ? offset + 20 : null;
  return retainedMetadataSchema.parse({ title: title(row, value), edits, cursor, complete: cursor === null });
}
