/**
 * [INPUT]: Depends on SQLite saved rows, bounded chunk/blob I/O, and cryptographic source identities
 * [OUTPUT]: Reads bounded canonical body and saved-part slices while preserving view, identity, and part-manifest truncation
 * [POS]: Worker-only history source; file I/O finishes before the worker accepts another command
 */

import { readHistoryParts } from "./parts";
import { createHash } from "node:crypto";
import { constants, openSync, closeSync, fstatSync, readSync } from "node:fs";
import { resolve, dirname, basename } from "node:path";
import type { SqliteDatabase } from "../connection";
import type { Row } from "../repository/codec";
import type { HistoryBinding, HistoryRef, HistoryRecord, HistoryViewFence } from "../../../../../shared/chat-agent/history";
import type { AgentBackendId } from "../../../../../shared/agent-ipc";
import { truncateUtf8 } from "../../../../../shared/truncate-utf8";
export type Source = { segment: "native" | "imported"; id: string; seq: number; bytes: number; role: "user" | "assistant" };
export class HistorySource {
  constructor(readonly db: SqliteDatabase, private readonly blobsRoot: string) {}
  fence(chatId: string, deviceId: string) {
    const row = this.db.prepare(`SELECT c.incarnation_id, c.native_message_revision, c.trimmed_through_seq,
      g.generation_id, (SELECT MIN(seq) FROM chat_messages WHERE chat_id=c.id AND role='user') first_user_seq
      FROM chats c JOIN chat_local_memberships m ON m.chat_id=c.id AND m.device_id=?
      LEFT JOIN chat_active_import_generations g ON g.chat_id=c.id WHERE c.id=?`).get(deviceId, chatId) as Row | undefined;
    if (!row) return null;
    return { view: { incarnationId: String(row.incarnation_id), nativeMessageRevision: Number(row.native_message_revision),
      activeGenerationId: row.generation_id == null ? null : String(row.generation_id) } satisfies HistoryViewFence,
      storageTrimmed: Number(row.trimmed_through_seq) > 0 && (row.first_user_seq == null || Number(row.first_user_seq) > Number(row.trimmed_through_seq)) };
  }
  binding(chatId: string, deviceId: string, nativeBeforeSeq: number): HistoryBinding | null {
    const fence = this.fence(chatId, deviceId);
    if (!fence) return null;
    const row = this.db.prepare(`SELECT MAX(delivery_seq) seq FROM chat_import_generation_entries
      WHERE chat_id=? AND generation_id=?`).get(chatId, fence.view.activeGenerationId) as Row;
    return { chatId, view: fence.view, cut: { nativeThroughSeq: Math.max(0, nativeBeforeSeq - 1),
      importedThroughSeq: Number(row.seq ?? 0) } };
  }
  count(binding: HistoryBinding) {
    const row = this.db.prepare(`SELECT
      (SELECT COUNT(*) FROM chat_messages WHERE chat_id=? AND seq<=? AND role IN ('user','assistant')) +
      (SELECT COUNT(*) FROM chat_import_generation_entries e JOIN chat_import_entry_versions v ON v.entry_version_id=e.entry_version_id
        WHERE e.chat_id=? AND e.generation_id=? AND e.delivery_seq<=? AND v.role IN ('user','assistant')) total`)
      .get(binding.chatId, binding.cut.nativeThroughSeq, binding.chatId, binding.view.activeGenerationId, binding.cut.importedThroughSeq) as Row;
    return Number(row.total);
  }
  list(binding: HistoryBinding, offset: number, limit: number, oldest = false, userOnly = false): Source[] {
    const order = oldest ? "ASC" : "DESC";
    const rows = this.db.prepare(`SELECT * FROM (
      SELECT 'native' segment, message_id id, seq, role, length(CAST(payload_json AS BLOB)) bytes, 1 rank
        FROM chat_messages WHERE chat_id=? AND seq<=? AND role IN ('user','assistant')
      UNION ALL SELECT 'imported', v.entry_version_id, e.delivery_seq, v.role, v.byte_size, 0
        FROM chat_import_generation_entries e JOIN chat_import_entry_versions v ON v.entry_version_id=e.entry_version_id
        WHERE e.chat_id=? AND e.generation_id=? AND e.delivery_seq<=? AND v.role IN ('user','assistant')
      ) ${userOnly ? "WHERE role='user'" : ""} ORDER BY rank ${order}, seq ${order} LIMIT ? OFFSET ?`).all(binding.chatId, binding.cut.nativeThroughSeq,
        binding.chatId, binding.view.activeGenerationId, binding.cut.importedThroughSeq, limit, offset) as Row[];
    return rows.map(row => ({ segment: row.segment as Source["segment"], id: String(row.id), seq: Number(row.seq),
      bytes: Number(row.bytes), role: row.role as Source["role"] }));
  }
  neighbors(binding: HistoryBinding, target: Source): Source[] {
    const rank = target.segment === "native" ? 1 : 0;
    const query = (direction: "ASC" | "DESC", comparison: ">" | "<") => {
      const rows = this.db.prepare(`SELECT * FROM (
        SELECT 'native' segment, message_id id, seq, role, length(CAST(payload_json AS BLOB)) bytes, 1 rank
          FROM chat_messages WHERE chat_id=? AND seq<=? AND role IN ('user','assistant')
        UNION ALL SELECT 'imported', v.entry_version_id, e.delivery_seq, v.role, v.byte_size, 0
          FROM chat_import_generation_entries e JOIN chat_import_entry_versions v ON v.entry_version_id=e.entry_version_id
          WHERE e.chat_id=? AND e.generation_id=? AND e.delivery_seq<=? AND v.role IN ('user','assistant'))
        WHERE rank ${comparison} ? OR (rank=? AND seq ${comparison} ?)
        ORDER BY rank ${direction}, seq ${direction} LIMIT 9`).all(binding.chatId, binding.cut.nativeThroughSeq,
        binding.chatId, binding.view.activeGenerationId, binding.cut.importedThroughSeq, rank, rank, target.seq) as Row[];
      return rows.map(row => ({ segment: row.segment as Source["segment"], id: String(row.id), seq: Number(row.seq),
        bytes: Number(row.bytes), role: row.role as Source["role"] }));
    };
    // Put the requested evidence first so a long neighbor cannot hide it.
    return [target, ...query("DESC", "<"), ...query("ASC", ">")];
  }
  locate(binding: HistoryBinding, ref: HistoryRef): Source | null {
    if (ref.seq > (ref.segment === "native" ? binding.cut.nativeThroughSeq : binding.cut.importedThroughSeq)) return null;
    const row = ref.segment === "native" ? this.db.prepare(`SELECT message_id id, seq, role,
      length(CAST(payload_json AS BLOB)) bytes FROM chat_messages WHERE chat_id=? AND message_id=? AND seq=? AND role!='notice'`)
      .get(binding.chatId, ref.messageId, ref.seq) as Row | undefined
      : this.db.prepare(`SELECT v.entry_version_id id, e.delivery_seq seq, v.role, v.byte_size bytes FROM chat_import_generation_entries e
        JOIN chat_import_entry_versions v ON v.entry_version_id=e.entry_version_id
        WHERE e.chat_id=? AND e.generation_id=? AND v.entry_version_id=? AND e.delivery_seq=?`)
        .get(binding.chatId, binding.view.activeGenerationId, ref.messageId, ref.seq) as Row | undefined;
    return row ? { segment: ref.segment, id: String(row.id), seq: Number(row.seq), bytes: Number(row.bytes), role: row.role as Source["role"] } : null;
  }
  read(binding: HistoryBinding, source: Source, fromByte: number, limit: number, partId?: string, includeParts = true): HistoryRecord | null {
    let text = "", totalBytes = 0, digest = "", backend: AgentBackendId | undefined;
    let notSaved = false;
    let parts: HistoryRecord["parts"];
    let partsTruncated = false;
    if (source.segment === "native") {
      if (source.bytes > 64 * 1024) return null;
      const row = this.db.prepare(`SELECT payload_json FROM chat_messages WHERE chat_id=? AND message_id=? AND seq=?`)
        .get(binding.chatId, source.id, source.seq) as Row | undefined;
      if (!row) return null;
      const payload = String(row.payload_json);
      digest = createHash("sha256").update(payload).digest("hex");
      const message = JSON.parse(payload);
      backend = message.backend;
      const savedParts = (message.parts ?? []) as Array<{ id?: string; itemId?: string; kind?: string }>;
      const selectedPart = partId ? savedParts.find((part, index) => (part.itemId ?? part.id ?? `part-${index}`) === partId) : undefined;
      if (partId && !selectedPart) return null;
      const value = partId ? JSON.stringify(selectedPart) : String(message.content ?? "");
      totalBytes = Buffer.byteLength(value);
      text = utf8Slice(value, fromByte, limit);
      if (includeParts && !partId && fromByte === 0) parts = savedParts.map((part, index) => ({ partId: part.itemId ?? part.id ?? `part-${index}`, value: part }));
      notSaved = Boolean(message.partsTruncated || message.truncated);
    } else {
      const row = this.db.prepare(`SELECT v.content_digest, COALESCE(json_extract(v.payload_json,'$.cloudSourceKind'),o.source_kind) source_kind
        FROM chat_import_entry_versions v LEFT JOIN chat_import_origins o ON o.chat_id=v.chat_id WHERE v.entry_version_id=? AND v.chat_id=?`)
        .get(source.id, binding.chatId) as Row | undefined;
      if (!row) return null;
      digest = String(row.content_digest);
      backend = row.source_kind as AgentBackendId;
      const field = partId ?? "content";
      const size = this.db.prepare(`SELECT COALESCE(SUM(byte_size),0) bytes FROM chat_import_entry_version_chunks
        WHERE entry_version_id=? AND field_kind=?`).get(source.id, field) as Row;
      totalBytes = Number(size.bytes);
      if (totalBytes) {
        const chunks = this.db.prepare(`WITH positions AS (
          SELECT ordinal, byte_size, COALESCE(SUM(byte_size) OVER (ORDER BY ordinal ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING),0) start
          FROM chat_import_entry_version_chunks WHERE entry_version_id=? AND field_kind=?)
          SELECT substr(CAST(c.content AS BLOB),MAX(0,?-p.start)+1,?-MAX(p.start,?)) content, p.byte_size, p.start FROM positions p JOIN chat_import_entry_version_chunks c
          ON c.entry_version_id=? AND c.field_kind=? AND c.ordinal=p.ordinal
          WHERE p.start+p.byte_size>? AND p.start<? ORDER BY p.ordinal LIMIT 3`)
          .iterate(source.id, field, fromByte, fromByte + limit + 4, fromByte, source.id, field, fromByte, fromByte + limit) as Iterable<Row>;
        let traversed = 0;
        for (const chunk of chunks) {
          traversed = Number(chunk.start);
          const bytes = Number(chunk.byte_size);
          const used = Buffer.byteLength(text);
          text += boundedUtf8(Buffer.from(chunk.content as Uint8Array), limit - used);
          traversed += bytes;
          if (Buffer.byteLength(text) >= limit - 3 || traversed >= fromByte + limit) break;
        }
      } else {
        const blob = this.db.prepare(`SELECT b.local_path, b.byte_size, b.content_digest FROM chat_import_entry_blobs e
          JOIN chat_import_blobs b ON b.content_digest=e.content_digest WHERE e.entry_version_id=? AND e.field_kind=?`)
          .get(source.id, field) as Row | undefined;
        if (blob) {
          totalBytes = Number(blob.byte_size);
          text = this.readBlob(blob, fromByte, limit);
        } else if (field !== "content") return null;
      }
      if (includeParts && !partId && fromByte === 0) {
        const manifest = readHistoryParts(this.db, source.id);
        parts = manifest.parts;
        partsTruncated = manifest.truncated;
      }

    }
    return { ref: { segment: source.segment, messageId: source.id, seq: source.seq, digest, ...(partId ? { partId } : {}) },
      role: source.role, ...(source.role === "assistant" ? { backend } : {}), text,
      range: { fromByte, toByte: fromByte + Buffer.byteLength(text), totalBytes },
      projectionTruncated: fromByte + Buffer.byteLength(text) < totalBytes, notSaved,
      ...(partsTruncated ? { partsTruncated: true } : {}), ...(parts?.length ? { parts } : {}) };
  }
  private readBlob(row: Row, fromByte: number, limit: number) {
    const path = resolve(String(row.local_path));
    const digest = String(row.content_digest);
    if (dirname(path) !== resolve(this.blobsRoot) || basename(path) !== digest || !/^[a-f0-9]{64}$/.test(digest)) throw new Error("HISTORY_BLOB_UNAVAILABLE");
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size !== Number(row.byte_size)) throw new Error("HISTORY_BLOB_UNAVAILABLE");
      const buffer = Buffer.alloc(Math.min(limit + 4, Math.max(0, stat.size - fromByte)));
      const read = readSync(fd, buffer, 0, buffer.length, fromByte);
      return boundedUtf8(buffer.subarray(0, read), limit);
    } finally { closeSync(fd); }
  }
}
function boundedUtf8(buffer: Buffer, limit: number) {
  let end = Math.min(buffer.length, limit);
  while (end > 0 && end < buffer.length && (buffer[end]! & 0xc0) === 0x80) end--;
  return buffer.subarray(0, end).toString("utf8");
}
export function utf8Slice(value: string, fromByte: number, limit: number) {
  const bytes = Buffer.from(value);
  let start = Math.min(fromByte, bytes.length);
  while (start < bytes.length && (bytes[start]! & 0xc0) === 0x80) start++;
  return truncateUtf8(bytes.subarray(start).toString("utf8"), limit).value;
}

export function importedBackend(database: SqliteDatabase, entryId: string): AgentBackendId {
    const row = database.prepare(`SELECT COALESCE(json_extract(v.payload_json,'$.cloudSourceKind'),o.source_kind) source_kind FROM chat_import_entry_versions v
      LEFT JOIN chat_import_origins o ON o.chat_id = v.chat_id WHERE v.entry_version_id = ?`).get(entryId) as Row | undefined;
    if (!row?.source_kind) throw new Error("Imported author is unavailable");
    return row.source_kind as AgentBackendId;
  }
