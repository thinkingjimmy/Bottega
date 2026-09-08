/**
 * [INPUT]: Depends on immutable imported payloads and existing per-field SQLite chunks
 * [OUTPUT]: Materializes saved tool/process parts and returns bounded manifests with explicit part-count truncation
 * [POS]: Import-time projection; tool execution never parses the unbounded source payload
 */
import { createHash } from "node:crypto";
import type { SqliteDatabase } from "../connection";
import { transaction } from "../connection";
import type { Row } from "../repository/codec";
export function writeHistoryParts(db: SqliteDatabase, entryId: string, payload: unknown) {
  const value = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const insert = db.prepare(`INSERT OR IGNORE INTO chat_import_entry_version_chunks
    (entry_version_id,field_kind,ordinal,content,byte_size,content_digest) VALUES (?,?,?,?,?,?)`);
  for (const [key, prefix] of [["parts", "part"], ["tools", "tool"], ["process", "process"]] as const) {
    const parts = value[key];
    if (!Array.isArray(parts)) continue;
    for (const [index, part] of parts.entries()) {
      const characters = Array.from(JSON.stringify(part));
      for (let offset = 0, ordinal = 0; offset < characters.length; offset += 4096, ordinal++) {
        const content = characters.slice(offset, offset + 4096).join("");
        insert.run(entryId, `${prefix}-${index}`, ordinal, content, Buffer.byteLength(content), createHash("sha256").update(content).digest("hex"));
      }
    }
  }
  db.prepare("UPDATE chat_import_entry_versions SET history_parts_ready=1 WHERE entry_version_id=?").run(entryId);
}
export function initializeHistoryParts(db: SqliteDatabase) {
  transaction(db, () => {
    const pending = db.prepare(`SELECT entry_version_id, json_remove(payload_json,'$.searchText','$.preview') payload
      FROM chat_import_entry_versions WHERE history_parts_ready=0 LIMIT 1`);
    for (let row = pending.get() as Row | undefined; row; row = pending.get() as Row | undefined) {
      writeHistoryParts(db, String(row.entry_version_id), JSON.parse(String(row.payload)));
    }
  });
}
export function readHistoryParts(db: SqliteDatabase, entryId: string) {
  const rows = db.prepare(`SELECT field_kind, SUM(byte_size) bytes FROM chat_import_entry_version_chunks
    WHERE entry_version_id=? AND field_kind!='content' GROUP BY field_kind ORDER BY field_kind LIMIT 33`).all(entryId) as Row[];
  let budget = 8192;
  const parts = rows.slice(0, 32).map(row => {
    const partId = String(row.field_kind), bytes = Number(row.bytes);
    if (bytes > budget) return { partId, value: { available: true, projectionTruncated: true } };
    const chunks = db.prepare(`SELECT content FROM chat_import_entry_version_chunks WHERE entry_version_id=? AND field_kind=? ORDER BY ordinal LIMIT 3`)
      .all(entryId, partId) as Row[];
    const content = chunks.map(chunk => String(chunk.content)).join("");
    budget -= Buffer.byteLength(content);
    return { partId, value: JSON.parse(content) as unknown };
  });
  return { parts, truncated: rows.length > 32 };
}
