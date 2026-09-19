/**
 * [INPUT]: Depends on saved history sources and the shared renderer Find candidate/token kernel
 * [OUTPUT]: Provides bounded preparation and single-command live reads with explicit drift/retention results
 * [POS]: SQLite worker history facade; budgets apply before body materialization
 */

import type { HistoryReadCommand, HistoryReadResult, PreparedHistory } from "../../../../../shared/chat-agent/history";
import { tokenizeSearchQuery, matchSearchTokens, normalizeSearchText } from "../../../../../shared/search-text";
import { queryGramTokens, type Row } from "../repository/codec";
import { HistorySource, type Source } from "./source";
import { FIND_CANDIDATES_SQL } from "./search";
// Charge source bytes before materializing bodies, including imported part previews.
const readCost = (source: Source, limit: number, parts: boolean, part = false) => source.segment === "native"
  ? Math.min(source.bytes, 65536) : (part ? limit + 12 : Math.min(source.bytes, limit + 12)) + (parts && !part ? 8192 : 0);
const wireBytes = (value: unknown) => Buffer.byteLength(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(value) }] }));
const SCOPE = "native saved text; complete imported text <=32768 bytes; excludes tool detail and larger imported/blob bodies";
export class ChatHistoryReader {
  constructor(private readonly source: HistorySource) {}
  prepare(chatId: string, deviceId: string, nativeBeforeSeq: number): PreparedHistory | null {
    const binding = this.source.binding(chatId, deviceId, nativeBeforeSeq);
    if (!binding) return null;
    const first = this.source.list(binding, 0, 1, true, true);
    const recent = this.source.list(binding, 0, 999);
    const candidates = [...first, ...recent].filter((source, index, all) => all.findIndex(item => item.segment === source.segment && item.id === source.id) === index);
    const records: PreparedHistory["records"] = [];
    let scannedBytes = 0, scannedMessages = 0, missing = false;
    for (const item of candidates) {
      const limit = Math.min(32768, 2 * 1024 * 1024 - scannedBytes - 8192 - 1024);
      if (limit < 1024) break;
      const cost = readCost(item, limit, true);
      if (scannedBytes + cost > 2 * 1024 * 1024) break;
      scannedMessages++;
      scannedBytes += cost;
      try {
        const record = this.source.read(binding, item, 0, limit);
        if (!record) { missing = true; continue; }
        records.push(record);
      } catch { missing = true; }
    }
    return { binding, records, scannedMessages, scannedBytes, totalMessages: this.source.count(binding),
      storageTrimmed: this.source.fence(chatId, deviceId)!.storageTrimmed,
      hasMore: missing || recent.length === 999 || scannedMessages < candidates.length || records.some(record => record.projectionTruncated) };
  }
  read(command: HistoryReadCommand, deviceId: string): HistoryReadResult {
    const { binding, position } = command;
    const live = this.source.fence(binding.chatId, deviceId);
    const result: HistoryReadResult = { status: "ok", view: binding.view, viewChanged: false,
      storageTrimmed: live?.storageTrimmed ?? false, projectionTruncated: false, notSaved: false,
      records: [], firstReadableRef: null, lastReadableRef: null, hasMore: false, scanLimited: false,
      nextPage: null, nextChunk: null, searchScope: SCOPE };
    if (!live) return { ...result, status: "unavailable" };
    const identityMatches = live.view.incarnationId === binding.view.incarnationId && live.view.activeGenerationId === binding.view.activeGenerationId;
    if (!identityMatches) return { ...result, status: "unavailable" };
    if (live.view.nativeMessageRevision !== binding.view.nativeMessageRevision) {
      if (!command.refresh || !["recent", "search"].includes(position.mode)) return { ...result, status: "stale" };
      result.view = live.view; result.viewChanged = true;
    }
    const current = { ...binding, view: result.view };
    let candidates: Source[] = [];
    let queryTokens: string[] = [];
    if (position.mode === "chunk" || position.mode === "around") {
      if (!position.ref) return { ...result, status: "unavailable" };
      const target = this.source.locate(current, position.ref);
      if (!target) return { ...result, status: result.storageTrimmed ? "trimmed" : "unavailable" };
      candidates = position.mode === "around" ? this.source.neighbors(current, target) : [target];
    } else if (position.mode === "search") {
      queryTokens = tokenizeSearchQuery(position.query ?? "");
      const grams = queryGramTokens(queryTokens);
      if (!grams.length) return result;
      const match = grams.map(gram => `"${gram}"`).join(" AND ");
      const rows = this.source.db.prepare(`SELECT d.document_kind, m.message_id, m.seq, m.role,
        length(CAST(m.payload_json AS BLOB)) native_bytes, ie.delivery_seq, iv.entry_version_id,
        iv.role imported_role, iv.byte_size imported_bytes ${FIND_CANDIDATES_SQL} LIMIT ? OFFSET ?`)
        .all(deviceId, match, binding.chatId, 200, position.offset) as Row[];
      candidates = rows.map(row => ({ segment: row.document_kind === "native" ? "native" : "imported",
        id: String(row.message_id ?? row.entry_version_id), seq: Number(row.seq ?? row.delivery_seq),
        bytes: row.document_kind === "native" ? Number(row.native_bytes) : Number(row.imported_bytes),
        role: (row.role ?? row.imported_role) as Source["role"] }));
      result.hasMore = rows.length === 200;
    } else {
      candidates = this.source.list(current, position.offset, 21);
      result.hasMore = candidates.length > 20;
    }
    const limit = Math.max(1024, Math.min(15 * 1024, command.byteLimit));
    let scanned = 0, scannedBytes = 0;
    for (const candidate of candidates) {
      if (scanned >= 200 || result.records.length >= 20) break;
      if (candidate.seq > (candidate.segment === "native" ? binding.cut.nativeThroughSeq : binding.cut.importedThroughSeq)) { scanned++; continue; }
      if (position.mode === "search" && (candidate.bytes > 32768 || candidate.role === ("notice" as string))) { scanned++; continue; }
      const readLimit = position.mode === "search" ? 32768 : Math.min(10000, limit);
      const partId = candidate.id === position.ref?.messageId ? position.ref.partId : undefined;
      const cost = readCost(candidate, readLimit, position.mode !== "search", Boolean(partId));
      if (scannedBytes + cost > 256 * 1024) { result.scanLimited = true; break; }
      scannedBytes += cost;
      let record;
      try { record = this.source.read(current, candidate, position.mode === "chunk" ? position.offset : 0, readLimit, partId, position.mode !== "search"); }
      catch { return { ...result, status: "unavailable", notSaved: true }; }
      scanned++;
      if (!record) return { ...result, status: "notSaved", notSaved: true };
      if (position.ref && candidate.id === position.ref.messageId && record.ref.digest !== position.ref.digest) return { ...result, status: "stale" };
      if (position.mode === "search" && matchSearchTokens(normalizeSearchText(record.text), queryTokens) === null) continue;
      // Parts remain independently addressable; previews cannot consume the body page budget.
      record = { ...record, parts: record.parts?.map(part => ({ partId: part.partId, value: { available: true } })) };
      if (wireBytes({ ...result, records: [...result.records, record] }) > limit) {
        if (result.records.length) { scanned--; result.hasMore = true; break; }
        while (record.text && wireBytes({ ...result, records: [record] }) > limit - 900) {
          const text = Array.from(record.text).slice(0, Math.max(0, Math.floor(Array.from(record.text).length * 0.75))).join("");
          record = { ...record, text, range: { ...record.range, toByte: record.range.fromByte + Buffer.byteLength(text) }, projectionTruncated: true };
        }
      }
      result.records.push(record);
      result.notSaved ||= record.notSaved;
      if (record.projectionTruncated) {
        result.projectionTruncated = true;
        result.nextChunk = { mode: "chunk", ref: record.ref, offset: record.range.toByte };
        if (position.mode !== "chunk") result.hasMore ||= candidates.length > scanned;
        break;
      }
    }
    if (position.mode === "recent" || position.mode === "search") {
      result.hasMore ||= scanned < candidates.length;
      result.scanLimited ||= position.mode === "search" && (scanned === 200 || scannedBytes >= 256 * 1024);
      if (result.hasMore || result.scanLimited) result.nextPage = { ...position, offset: position.offset + scanned };
    }
    result.firstReadableRef = result.records[0]?.ref ?? null;
    result.lastReadableRef = result.records.at(-1)?.ref ?? null;
    return result;
  }
}
