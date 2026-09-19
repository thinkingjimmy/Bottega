/**
 * [INPUT]: Depends on immutable imported descriptors, original generation tables and scoped download checkpoints.
 * [OUTPUT]: Verifies complete ordered generations and exposes confirmed pages without replacing an unpublished local source.
 * [POS]: Imported cache activation boundary; mirrors activate only complete data and local takeover explicitly adopts it.
 */
import { EMPTY_IMPORT_DIGEST, extendImportDigest, importedEntrySchema, importEntryBytes, type ImportedEntry, type importStatusSchema } from "@ai-chat/cloud-protocol/chats/imported/model";
import type { z } from "zod";
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { reclaimRetiredGenerations } from "../../repository/import-gc";
import { localImportId, readImportDownload, requireImportChat, requireImportDownload, saveImportDownload } from "./state";
export function beginImportDownload(db: SqliteDatabase, scope: SyncScope, input: { chatId: string; bodyRevision: number; status: z.infer<typeof importStatusSchema> }, now: number) {
  const { head } = requireImportChat(db, scope, input.chatId), { manifest } = input.status;
  if (head.bodyRevision !== input.bodyRevision || manifest.chatId !== input.chatId || manifest.incarnationId !== head.chat.incarnationId ||
    input.status.state !== "ready" || input.status.receivedCount !== manifest.entryCount || input.status.receivedBytes !== manifest.bytes ||
    input.status.receivedDigest !== manifest.digest) throw new Error("IMPORT_GENERATION_UNAVAILABLE");
  const previous = readImportDownload(db, scope, input.chatId);
  if (previous?.status.manifest.generationId === manifest.generationId) {
    if (canonicalJson(previous.status) !== canonicalJson(input.status)) throw new Error("IMPORT_GENERATION_CHANGED");
    return saveImportDownload(db, scope, input.chatId, { ...previous, bodyRevision: input.bodyRevision }, now);
  }
  if (previous && input.status.revision <= previous.status.revision) throw new Error("IMPORT_GENERATION_REGRESSION");
  if (previous && !previous.complete) db.prepare("UPDATE chat_import_generations SET state='abandoned' WHERE generation_id=? AND state='building'").run(previous.localGenerationId);
  const localGenerationId = localImportId(scope, input.chatId, manifest.generationId);
  db.prepare(`INSERT INTO chat_import_generations(generation_id,chat_id,history_revision,source_incarnation,source_size,source_mtime_ns,
    incomplete_tail,state,entry_count,byte_size,digest_codec_version,content_digest,created_at) VALUES(?,?,?,NULL,?,'0',?,'building',?,?,1,?,?)`)
    .run(localGenerationId, input.chatId, `cloud:${manifest.generationId}`, manifest.bytes, String(manifest.incompleteTail), manifest.entryCount, manifest.bytes, manifest.digest, now);
  return saveImportDownload(db, scope, input.chatId, { status: input.status, localGenerationId, bodyRevision: input.bodyRevision, beforeSeq: null, receivedCount: 0, complete: false }, now);
}
export function activateCloudImport(db: SqliteDatabase, scope: SyncScope, chatId: string, now: number) {
  const state = readImportDownload(db, scope, chatId);
  if (!state?.complete) throw new Error("IMPORT_GENERATION_INCOMPLETE");
  const previous = db.prepare("SELECT generation_id FROM chat_active_import_generations WHERE chat_id=?").get(chatId) as Row | undefined;
  if (previous?.generation_id === state.localGenerationId) return;
  db.prepare("DELETE FROM chat_active_import_generations WHERE chat_id=?").run(chatId);
  if (previous) db.prepare("UPDATE chat_import_generations SET state='superseded' WHERE generation_id=? AND state='ready'").run(String(previous.generation_id));
  db.prepare("INSERT INTO chat_active_import_generations(chat_id,generation_id,activated_at) VALUES(?,?,?)").run(chatId, state.localGenerationId, now);
}
export function completeImportDownload(db: SqliteDatabase, scope: SyncScope, chatId: string, generationId: string, now: number) {
  const state = requireImportDownload(db, scope, chatId, generationId), { head, row } = requireImportChat(db, scope, chatId);
  if (state.bodyRevision !== head.bodyRevision) throw new Error("IMPORT_GENERATION_CHANGED");
  if (state.complete) return state;
  let count = 0, bytes = 0, digest = EMPTY_IMPORT_DIGEST;
  for (const row of db.prepare(`SELECT e.delivery_seq,v.payload_json FROM chat_import_generation_entries e
    JOIN chat_import_entry_versions v ON v.entry_version_id=e.entry_version_id WHERE e.chat_id=? AND e.generation_id=? ORDER BY e.delivery_seq`)
    .iterate(chatId, state.localGenerationId) as Iterable<Row>) {
    const payload = JSON.parse(String(row.payload_json)), entry = importedEntrySchema.parse(payload.cloudEntry);
    if (!payload.cloudReady || entry.deliverySeq !== Number(row.delivery_seq)) throw new Error("IMPORT_GENERATION_INCOMPLETE");
    count++; bytes += importEntryBytes(entry); digest = extendImportDigest(digest, entry);
  }
  const manifest = state.status.manifest;
  if (count !== state.receivedCount || count !== manifest.entryCount || bytes !== manifest.bytes || digest !== manifest.digest) throw new Error("IMPORT_GENERATION_INCOMPLETE");
  db.prepare("UPDATE chat_import_generations SET state='ready' WHERE generation_id=? AND state='building'").run(state.localGenerationId);
  const result = saveImportDownload(db, scope, chatId, { ...state, complete: true }, now);
  if (row.cloud_state === "mirror") activateCloudImport(db, scope, chatId, now);
  db.prepare(`UPDATE chat_import_generations SET state='superseded' WHERE chat_id=? AND state='ready' AND history_revision LIKE 'cloud:%'
    AND generation_id!=? AND generation_id NOT IN (SELECT generation_id FROM chat_active_import_generations WHERE chat_id=?)`).run(chatId, state.localGenerationId, chatId);
  reclaimRetiredGenerations(db, chatId);
  return result;
}
export function confirmedImportPage(db: SqliteDatabase, scope: SyncScope, chatId: string, generationId: string | null, revision: number | null, beforeSeq: number | null, limit: number) {
  const { head } = requireImportChat(db, scope, chatId), state = readImportDownload(db, scope, chatId);
  if (state && generationId !== null && (generationId !== state.status.manifest.generationId || revision !== state.status.revision)) throw new Error("IMPORT_GENERATION_CHANGED");
  if (!state?.complete || state.bodyRevision !== head.bodyRevision) return { state, entries: [], cursor: null, complete: false };
  const rows = db.prepare(`SELECT v.payload_json FROM chat_import_generation_entries e JOIN chat_import_entry_versions v ON v.entry_version_id=e.entry_version_id
    WHERE e.chat_id=? AND e.generation_id=? AND e.delivery_seq<? ORDER BY e.delivery_seq DESC LIMIT ?`)
    .all(chatId, state.localGenerationId, beforeSeq ?? Number.MAX_SAFE_INTEGER, limit + 1) as Row[];
  const entries: ImportedEntry[] = []; let bytes = 0;
  for (const row of rows.slice(0, limit)) {
    const entry = importedEntrySchema.parse(JSON.parse(String(row.payload_json)).cloudEntry), size = Buffer.byteLength(JSON.stringify(entry));
    if (entries.length && bytes + size > 1024 * 1024) break;
    entries.push(entry); bytes += size;
  }
  const complete = entries.length === rows.length, cursor = complete ? null : entries.at(-1)!.deliverySeq;
  return { state, entries: entries.reverse(), cursor, complete };
}
