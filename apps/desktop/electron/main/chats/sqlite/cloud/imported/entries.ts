/**
 * [INPUT]: Depends on immutable wire entry hashes, scoped download state and existing imported field tables.
 * [OUTPUT]: Stages retained generation membership and bounded UTF-8 fields, then verifies every field before confirming the entry.
 * [POS]: Worker import leaf; complete entry versions are immutable and interrupted fields remain resumable.
 */
import { createHash } from "node:crypto";
import { importedEntryHash, type ImportedEntry } from "@ai-chat/cloud-protocol/chats/imported/model";
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { digest, json, type Row } from "../../repository/codec";
import { localEntryId, requireImportDownload, saveImportDownload } from "./state";
export function beginImportEntry(db: SqliteDatabase, scope: SyncScope, chatId: string, generationId: string, entry: ImportedEntry) {
  const state = requireImportDownload(db, scope, chatId, generationId);
  if (state.complete || state.beforeSeq !== null && entry.deliverySeq >= state.beforeSeq || importedEntryHash(entry) !== entry.entryVersionId) throw new Error("IMPORT_ENTRY_INVALID");
  const id = localEntryId(scope, chatId, entry.entryVersionId, entry.deliverySeq), row = db.prepare("SELECT payload_json FROM chat_import_entry_versions WHERE entry_version_id=?").get(id) as Row | undefined;
  let ready = false;
  if (row) {
    const payload = JSON.parse(String(row.payload_json));
    if (canonicalJson(payload.cloudEntry) !== canonicalJson(entry)) throw new Error("IMPORT_ENTRY_CHANGED");
    ready = payload.cloudReady === true;
    if (!ready) db.prepare("DELETE FROM chat_import_entry_version_chunks WHERE entry_version_id=?").run(id);
  } else db.prepare(`INSERT INTO chat_import_entry_versions(entry_version_id,chat_id,source_entry_id,source_message_id,role,created_at,
    payload_json,digest_codec_version,content_digest,byte_size,history_parts_ready) VALUES(?,?,?,NULL,?,?,?,1,?,?,1)`)
    .run(id, chatId, `${entry.entryVersionId}:${entry.deliverySeq}`, entry.role, entry.createdAt, json({ cloudEntry: entry, cloudReady: false,
      cloudSourceKind: state.status.manifest.sourceKind, preview: entry.preview, completion: entry.completion, completionReason: entry.completionReason,
      workedForMs: entry.workedForMs, plan: entry.plan, searchText: "" }), entry.entryVersionId, entry.fields.find(field => field.field === "content")!.bytes);
  // Membership protects partially written fields from the existing orphan collector.
  db.prepare("INSERT OR IGNORE INTO chat_import_generation_entries(chat_id,generation_id,delivery_seq,entry_version_id) VALUES(?,?,?,?)")
    .run(chatId, state.localGenerationId, entry.deliverySeq, id);
  if ((db.prepare("SELECT entry_version_id FROM chat_import_generation_entries WHERE chat_id=? AND generation_id=? AND delivery_seq=?")
    .get(chatId, state.localGenerationId, entry.deliverySeq) as Row | undefined)?.entry_version_id !== id) throw new Error("IMPORT_ENTRY_CHANGED");
  return { ready };
}
export function writeImportField(db: SqliteDatabase, scope: SyncScope, input: { chatId: string; generationId: string; entry: ImportedEntry; field: string; ordinal: number; content: string }) {
  const state = requireImportDownload(db, scope, input.chatId, input.generationId), descriptor = input.entry.fields.find(field => field.field === input.field);
  const id = localEntryId(scope, input.chatId, input.entry.entryVersionId, input.entry.deliverySeq), row = db.prepare("SELECT payload_json FROM chat_import_entry_versions WHERE entry_version_id=? AND chat_id=?").get(id, input.chatId) as Row | undefined;
  if (state.complete || !descriptor || !row) throw new Error("IMPORT_FIELD_INVALID");
  const payload = JSON.parse(String(row.payload_json));
  if (payload.cloudReady || canonicalJson(payload.cloudEntry) !== canonicalJson(input.entry)) throw new Error("IMPORT_ENTRY_CHANGED");
  const current = db.prepare("SELECT COUNT(*) count,COALESCE(SUM(byte_size),0) bytes FROM chat_import_entry_version_chunks WHERE entry_version_id=? AND field_kind=?").get(id, input.field) as Row;
  const bytes = Buffer.byteLength(input.content);
  if (Number(current.count) !== input.ordinal || Number(current.bytes) + bytes > descriptor.bytes || bytes > 128 * 1024 || !bytes && descriptor.bytes) throw new Error("IMPORT_FIELD_CURSOR_CHANGED");
  db.prepare(`INSERT INTO chat_import_entry_version_chunks(entry_version_id,field_kind,ordinal,content,byte_size,content_digest) VALUES(?,?,?,?,?,?)`)
    .run(id, input.field, input.ordinal, input.content, bytes, digest(input.content));
  return { bytes: Number(current.bytes) + bytes };
}
export function commitImportEntry(db: SqliteDatabase, scope: SyncScope, input: { chatId: string; generationId: string; entry: ImportedEntry; beforeSeq: number | null }, now: number) {
  const state = requireImportDownload(db, scope, input.chatId, input.generationId), entry = input.entry;
  if (state.complete || state.beforeSeq !== input.beforeSeq || state.receivedCount >= state.status.manifest.entryCount ||
    state.beforeSeq !== null && entry.deliverySeq >= state.beforeSeq) throw new Error("IMPORT_ENTRY_CURSOR_CHANGED");
  const id = localEntryId(scope, input.chatId, entry.entryVersionId, entry.deliverySeq), row = db.prepare("SELECT payload_json FROM chat_import_entry_versions WHERE entry_version_id=? AND chat_id=?").get(id, input.chatId) as Row | undefined;
  if (!row) throw new Error("IMPORT_ENTRY_UNAVAILABLE");
  const payload = JSON.parse(String(row.payload_json));
  if (canonicalJson(payload.cloudEntry) !== canonicalJson(entry)) throw new Error("IMPORT_ENTRY_CHANGED");
  if (!payload.cloudReady) {
    for (const field of entry.fields) {
      const hash = createHash("sha256"); let bytes = 0, ordinal = 0;
      for (const chunk of db.prepare("SELECT ordinal,content,byte_size,content_digest FROM chat_import_entry_version_chunks WHERE entry_version_id=? AND field_kind=? ORDER BY ordinal")
        .iterate(id, field.field) as Iterable<Row>) {
        const content = String(chunk.content);
        if (Number(chunk.ordinal) !== ordinal++ || Buffer.byteLength(content) !== Number(chunk.byte_size) || digest(content) !== chunk.content_digest) throw new Error("IMPORT_FIELD_CHANGED");
        bytes += Number(chunk.byte_size); hash.update(content);
      }
      if (!ordinal || bytes !== field.bytes || hash.digest("hex") !== field.sha256) throw new Error("IMPORT_FIELD_INCOMPLETE");
    }
    db.prepare("UPDATE chat_import_entry_versions SET payload_json=? WHERE entry_version_id=?").run(json({ ...payload, cloudReady: true }), id);
  }
  if ((db.prepare("SELECT entry_version_id FROM chat_import_generation_entries WHERE chat_id=? AND generation_id=? AND delivery_seq=?")
    .get(input.chatId, state.localGenerationId, entry.deliverySeq) as Row | undefined)?.entry_version_id !== id) throw new Error("IMPORT_ENTRY_CHANGED");
  return saveImportDownload(db, scope, input.chatId, { ...state, beforeSeq: entry.deliverySeq, receivedCount: state.receivedCount + 1 }, now);
}
