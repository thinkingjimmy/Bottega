/**
 * [INPUT]: Depends on scoped native, imported and confirmed mirror FTS documents and bounded retained body reads.
 * [OUTPUT]: Provides account-fenced keyset search without creating device membership for mirrors.
 * [POS]: SQLite search projection shared by renderer jobs and native history tools.
 */
import { chatBodySchema } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../connection";
import type { DatabaseCommand, SearchDocumentHit } from "../database-protocol";
import { messageSchema } from "../../chat-schema";
import { parseJson, type Row } from "../repository/codec";
import { ACTIVE_GENERATION_DOCUMENT_FENCE } from "../repository/imported-sql";
import { readRetainedSource } from "../cloud/inventory/source";
import type { ChatRecord } from "../../../../../shared/chats-ipc";
// Kind order is part of the stable search cursor.
const SEARCH_DOCUMENT_KIND_RANK =
  "CASE d.document_kind WHEN 'title' THEN 0 WHEN 'native' THEN 1 ELSE 2 END";

// Anonymous placeholders repeat each key in cursor order.
const SEARCH_DOCUMENT_KEYSET_AFTER = `(
  c.updated_at < ?
  OR (c.updated_at = ? AND (
        c.id > ?
        OR (c.id = ? AND (
              ${SEARCH_DOCUMENT_KIND_RANK} > ?
              OR (${SEARCH_DOCUMENT_KIND_RANK} = ? AND d.row_id > ?)
           ))
     ))
)`;

const nullableString = (value: unknown) =>
  value === null || value === undefined ? null : String(value);
const nullableNumber = (value: unknown) =>
  value === null || value === undefined ? null : Number(value);

export function searchDocuments(database: SqliteDatabase, command: Extract<DatabaseCommand, { kind: "search-documents" }>, scope: SyncScope | null) {
    if (!command.grams.length) return { hits: [], nextCursor: null };
    const match = command.grams.map((gram) => `"${gram}"`).join(" AND ");
    const cursor = command.cursor;
    const mirrorScope = command.includeMirrors ? scope : null;
    const rows = database.prepare(
      `SELECT d.*, ${SEARCH_DOCUMENT_KIND_RANK} kind_rank,
              c.title, c.agent, c.updated_at, c.incarnation_id, c.cloud_state,
              s.source_id mirror_source_id, s.digest mirror_digest,
              COALESCE(la.aggregate_revision,c.core_revision) core_revision,
              COALESCE(la.timeline_revision,c.native_message_revision) native_message_revision,
              a.generation_id active_generation_id,
              m.payload_json message_json,
              m.message_id native_message_id, m.seq native_message_seq,
              m.role native_message_role,
              ie.delivery_seq imported_message_seq,
              iv.entry_version_id imported_message_id,
              iv.role imported_message_role
         FROM chat_search_fts f
         JOIN chat_search_documents d ON d.row_id = f.rowid
         JOIN chats c ON c.id = d.chat_id
         LEFT JOIN chat_local_memberships lm
           ON lm.chat_id = c.id AND lm.device_id = ?
         LEFT JOIN chat_local_aggregate_state la
           ON la.chat_id = c.id AND la.device_id = ?
         LEFT JOIN chat_retained_sources s
           ON d.document_kind='native' AND d.source_row_id='mirror:' || s.source_id
          AND s.chat_id=c.id AND s.environment=c.cloud_environment AND s.user_id=c.cloud_user_id AND s.kind='mirror-body'
         LEFT JOIN chat_active_import_generations a ON a.chat_id = c.id
         LEFT JOIN chat_messages m
           ON d.document_kind = 'native' AND CAST(m.row_id AS TEXT) = d.source_row_id
         LEFT JOIN chat_import_entry_versions iv
           ON d.document_kind = 'imported-version' AND iv.entry_version_id = d.source_row_id
         LEFT JOIN chat_import_generation_entries ie
           ON ie.chat_id = d.chat_id
          AND ie.generation_id = a.generation_id
          AND ie.entry_version_id = iv.entry_version_id
        WHERE chat_search_fts MATCH ?
          AND ((lm.chat_id IS NOT NULL AND la.chat_id IS NOT NULL) OR
            (c.cloud_state='mirror' AND c.cloud_environment=? AND c.cloud_user_id=?
              AND NOT EXISTS(SELECT 1 FROM cloud_tombstones t WHERE t.chat_id=c.id AND t.environment=c.cloud_environment AND t.user_id=c.cloud_user_id)))
          AND (d.document_kind <> 'native' OR m.row_id IS NOT NULL OR (c.cloud_state='mirror' AND s.source_id IS NOT NULL))
          AND ${ACTIVE_GENERATION_DOCUMENT_FENCE}
          ${cursor ? `AND ${SEARCH_DOCUMENT_KEYSET_AFTER}` : ""}
        ORDER BY c.updated_at DESC, c.id, ${SEARCH_DOCUMENT_KIND_RANK}, d.row_id
        LIMIT ?`
    ).all(
      command.deviceId,
      command.deviceId,
      match,
      mirrorScope?.environment ?? null,
      mirrorScope?.userId ?? null,
      ...(cursor
        ? [
            cursor.updatedAt,
            cursor.updatedAt,
            cursor.chatId,
            cursor.chatId,
            cursor.kindRank,
            cursor.kindRank,
            cursor.rowId,
          ]
        : []),
      command.limit + 1
    ) as Row[];
    const page = rows.slice(0, command.limit);
    const hits: SearchDocumentHit[] = page.map((row) => {
      const body = row.mirror_source_id ? chatBodySchema.parse(readRetainedSource(database, { sourceId: String(row.mirror_source_id), digest: String(row.mirror_digest) })).message : null;
      return ({
      ...(row.cloud_state === "mirror" ? { mirror: true } : {}),
      chatId: String(row.chat_id),
      documentKind: row.document_kind as SearchDocumentHit["documentKind"],
      sourceRowId: String(row.source_row_id),
      searchText: String(row.search_text),
      message: row.message_json
        ? messageSchema.parse(parseJson(row.message_json, "search message"))
        : null,
      messageId: nullableString(row.native_message_id ?? row.imported_message_id ?? body?.id),
      messageSeq: nullableNumber(row.native_message_seq ?? row.imported_message_seq ?? body?.seq),
      messageRole: (row.native_message_role ?? row.imported_message_role ?? body?.role ?? null) as
        | "user"
        | "assistant"
        | null,
      timelineSegment: row.document_kind === "native"
        ? "native"
        : row.document_kind === "imported-version"
          ? "imported"
          : null,
      title: row.title === null ? null : String(row.title),
      agent: row.agent as ChatRecord["agent"],
      updatedAt: Number(row.updated_at),
      activeGenerationId: row.active_generation_id === null
        ? null
        : String(row.active_generation_id),
      incarnationId: row.incarnation_id === null
        ? null
        : String(row.incarnation_id),
      coreRevision: Number(row.core_revision),
      nativeMessageRevision: Number(row.native_message_revision),
    }); });
    const last = page.at(-1);
    return {
      hits,
      nextCursor: rows.length > command.limit && last
        ? {
            updatedAt: Number(last.updated_at),
            chatId: String(last.chat_id),
            kindRank: Number(last.kind_rank),
            rowId: Number(last.row_id),
          }
        : null,
    };
  }

