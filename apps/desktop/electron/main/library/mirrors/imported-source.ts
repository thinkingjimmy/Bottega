/**
 * [INPUT]: Depends on immutable SQLite import generations, saved field projections and digest-bound oversized blobs.
 * [OUTPUT]: Reads one lossless source message per fenced page for a portable external transcript.
 * [POS]: Worker-only export adapter; installation paths and source routing never leave this boundary.
 */
import { lstatSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { SqliteDatabase } from "../../chats/sqlite/connection";
import type { Row } from "../../chats/sqlite/repository/codec";
import { digest } from "../../chats/sqlite/repository/codec";
import { importedProjectionPayload } from "../../chats/sqlite/cloud/imported/projection";
import { completionMetadataSchema } from "../../../../shared/local-storage/contracts";
import { sourceSchema } from "./imported-codec";
import type { SyncScope } from "../../../../shared/local-storage/contracts";
export function readLibraryImport(db: SqliteDatabase, blobsRoot: string, input: { chatId: string; deviceId: string; generationId: string | null; afterSeq: number }, scope: SyncScope | null = null) {
  const active = db.prepare(`SELECT a.generation_id FROM chat_active_import_generations a JOIN chats c ON c.id=a.chat_id
    LEFT JOIN chat_local_memberships m ON m.chat_id=a.chat_id AND m.device_id=?
    WHERE a.chat_id=? AND (m.device_id IS NOT NULL OR (c.cloud_state='mirror' AND c.cloud_environment=? AND c.cloud_user_id=?))`)
    .get(input.deviceId, input.chatId, scope?.environment ?? null, scope?.userId ?? null) as Row | undefined;
  const generationId = active ? String(active.generation_id) : null;
  if (input.generationId && input.generationId !== generationId) throw new Error("LIBRARY_IMPORT_CHANGED");
  const row = db.prepare(`SELECT v.*,e.delivery_seq FROM chat_import_generation_entries e JOIN chat_import_entry_versions v ON v.entry_version_id=e.entry_version_id
    WHERE e.chat_id=? AND e.generation_id=? AND e.delivery_seq>? ORDER BY e.delivery_seq LIMIT 1`).get(input.chatId, generationId, input.afterSeq) as Row | undefined;
  if (!row) return { generationId, message: null };
  const blob = db.prepare(`SELECT b.content_digest,b.byte_size FROM chat_import_entry_blobs e JOIN chat_import_blobs b ON b.content_digest=e.content_digest
    WHERE e.entry_version_id=? AND e.field_kind='content'`).get(String(row.entry_version_id)) as Row | undefined;
  let content: string;
  if (blob) {
    const hash = String(blob.content_digest);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error("LIBRARY_IMPORT_BLOB_INVALID");
    const path = join(blobsRoot, hash), info = lstatSync(path);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== Number(blob.byte_size)) throw new Error("LIBRARY_IMPORT_BLOB_INVALID");
    const bytes = readFileSync(path); if (digest(bytes) !== hash) throw new Error("LIBRARY_IMPORT_BLOB_INVALID"); content = bytes.toString("utf8");
  } else content = (db.prepare(`SELECT content FROM chat_import_entry_version_chunks WHERE entry_version_id=? AND field_kind='content' ORDER BY ordinal`)
    .all(String(row.entry_version_id)) as Row[]).map(chunk => String(chunk.content)).join("");
  const payload = importedProjectionPayload(db, String(row.entry_version_id), row.payload_json);
  const message = sourceSchema.parse({ kind: "message", id: String(row.source_entry_id), nativeTurnId: String(payload.nativeTurnId ?? row.source_entry_id),
    deliverySeq: Number(row.delivery_seq), role: row.role as "user" | "assistant", content, createdAt: Number(row.created_at ?? 0),
    ...completionMetadataSchema.parse(payload), tools: payload.tools ?? [], process: payload.process ?? [],
    ...(typeof payload.workedForMs === "number" ? { workedForMs: payload.workedForMs } : {}), ...(payload.plan ? { plan: true } : {}) });
  return { generationId, message };
}
