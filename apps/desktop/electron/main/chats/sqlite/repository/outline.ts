/**
 * [INPUT]: Depends on shared UTF-8 byte-budget truncation, SQLite timeline/search rows, immutable import generations, and shared outline/find cursor contracts
 * [OUTPUT]: Provides generation/incarnation-fenced tail-first outline pages (newest first, native tail then imported prefix, each page ascending) and byte-bounded in-chat find pages whose exact filter, returned text, and total all speak one corpus: message content
 * [POS]: Narrow transcript-navigation query collaborator beneath ChatRepositoryReader
 */

import { truncateUtf8 } from "../../../../../shared/truncate-utf8";
import type {
  ChatMessage,
  ChatOutlineCursor,
  ChatOutlinePage,
} from "../../../../../shared/chats-ipc";
import {
  matchSearchTokens,
  normalizeSearchText,
} from "../../../../../shared/search-text";
import type { SqliteDatabase } from "../connection";
import {
  ACTIVE_GENERATION_DOCUMENT_FENCE,
  IMPORTED_MESSAGE_BYTE_LIMIT,
} from "./imported-sql";
import type { DatabaseCommand } from "../database-protocol";
import { messageFromRow, type Row } from "./codec";

const FIND_TEXT_BYTE_LIMIT = 4 * 1024;
/* 「从最新一条起」的内部哨兵：序号是整数列，比任何 seq 都大的那一个值让
   回溯分页只需要一条 SQL，而不是「有没有游标」两条。 */
const SEQ_TAIL = Number.MAX_SAFE_INTEGER;

/* Find 的语料是「消息正文」，不是 search_text。search_text 还含工具标题、
   详情、子代理与附件名——用它当判据，计数会数进一批用户在转录里根本读
   不到的东西，而导航只走得到正文那一批：同一个查询于是有两个总数。
   FTS grams 仍是候选预筛，精确判定与呈现一律落在正文上。
   正文超过 8 MiB 的导入条目落在外部 blob 里，SQL 取不到，因此不可被 Find
   命中——这是唯一的已知缺口，且与展示上限同源。 */
const IMPORTED_CONTENT_SQL = `(SELECT GROUP_CONCAT(content, '') FROM (
   SELECT content FROM chat_import_entry_version_chunks c
    WHERE c.entry_version_id = iv.entry_version_id
      AND c.field_kind = 'content'
    ORDER BY c.ordinal
 ))`;

export class ChatOutlineReader {
  constructor(private readonly database: SqliteDatabase) {}

  /* 从尾巴往回翻：第一页就是最新的 limit 条，之后每页更老。目录窗口只留
     最新的一段，正向翻页得先把整条 Chat 从 seq 0 读到底再把前面全丢掉——
     那不是分页，那是全表扫描披了张分页的皮。 */
  getPage(
    chatId: string,
    cursor: ChatOutlineCursor | undefined,
    limitInput: number,
    deviceId: string
  ): ChatOutlinePage | null {
    const fence = this.fence(chatId, deviceId);
    if (!fence) return null;
    const limit = Math.max(1, Math.min(200, limitInput));
    if (cursor) this.assertCursor(fence, cursor);
    const hasImported = Boolean(fence.active_generation_id);
    const readonly = fence.lifecycle_kind === "external-readonly";
    const segment = cursor?.segment ?? (readonly ? "imported" : "native");
    if ((segment === "imported" && !hasImported) || (segment === "native" && readonly)) {
      throw new Error("CHAT_TIMELINE_STALE");
    }
    const beforeSeq = cursor ? cursor.beforeSeq : null;
    return segment === "imported"
      ? this.importedPage(chatId, beforeSeq, limit, fence)
      : this.nativePage(chatId, beforeSeq, limit, fence);
  }

  findMessages(input: Extract<DatabaseCommand, { kind: "find-messages" }>) {
    const fence = this.fence(input.chatId, input.deviceId);
    if (!fence) return null;
    if (input.cursor) this.assertCursor(fence, input.cursor);
    if (!input.grams.length) return this.emptyFindPage(input.chatId, fence);
    const match = input.grams.map((gram) => `"${gram}"`).join(" AND ");
    const items: Array<{
      messageId: string;
      seq: number;
      role: ChatMessage["role"];
      text: string;
    }> = [];
    let offset = input.cursor?.offset ?? 0;
    let hasMore = true;
    while (items.length < input.limit && hasMore) {
      const batch = Math.min(200, input.limit - items.length);
      const rows = this.database.prepare(
        `SELECT d.document_kind,
                m.payload_json, m.message_id, m.seq, m.role, m.content, m.created_at,
                ie.delivery_seq, iv.entry_version_id, iv.role imported_role,
                iv.created_at imported_created_at,
                ${IMPORTED_CONTENT_SQL} imported_content
           FROM chat_search_fts f
           JOIN chat_search_documents d ON d.row_id = f.rowid
           JOIN chat_local_memberships lm
             ON lm.chat_id = d.chat_id AND lm.device_id = ?
           LEFT JOIN chat_messages m
             ON d.document_kind = 'native'
            AND CAST(m.row_id AS TEXT) = d.source_row_id
           LEFT JOIN chat_active_import_generations ag ON ag.chat_id = d.chat_id
           LEFT JOIN chat_import_entry_versions iv
             ON d.document_kind = 'imported-version'
            AND iv.entry_version_id = d.source_row_id
           LEFT JOIN chat_import_generation_entries ie
             ON ie.chat_id = d.chat_id
            AND ie.generation_id = ag.generation_id
            AND ie.entry_version_id = iv.entry_version_id
          WHERE chat_search_fts MATCH ? AND d.chat_id = ?
            AND d.document_kind IN ('native', 'imported-version')
            AND ${ACTIVE_GENERATION_DOCUMENT_FENCE}
          ORDER BY CASE d.document_kind WHEN 'imported-version' THEN 0 ELSE 1 END,
                   COALESCE(ie.delivery_seq, m.seq)
          LIMIT ? OFFSET ?`
      ).all(input.deviceId, match, input.chatId, batch, offset) as Row[];
      offset += rows.length;
      hasMore = rows.length === batch;
      for (const row of rows) {
        const content = row.document_kind === "native"
          ? String(row.content ?? "")
          : String(row.imported_content ?? "");
        if (matchSearchTokens(normalizeSearchText(content), input.tokens) === null) {
          continue;
        }
        const message = row.document_kind === "native"
          ? messageFromRow(row)
          : {
              id: String(row.entry_version_id),
              role: row.imported_role as "user" | "assistant",
              createdAt: Number(row.imported_created_at ?? 0),
              seq: Number(row.delivery_seq),
            };
        items.push({
          messageId: message.id,
          seq: message.seq,
          role: message.role,
          text: truncateUtf8(content, FIND_TEXT_BYTE_LIMIT, "…").value,
        });
      }
    }
    const incarnationId = String(fence.incarnation_id);
    const nativeMessageRevision = Number(fence.native_message_revision);
    const activeGenerationId = this.activeGeneration(fence);
    return {
      chatId: input.chatId,
      incarnationId,
      nativeMessageRevision,
      activeGenerationId,
      items,
      total: this.findTotal(input, match),
      nextCursor: hasMore
        ? { offset, incarnationId, nativeMessageRevision, activeGenerationId }
        : null,
    };
  }

  /* 「第 3 条 / 共几条」里的那个「共」：候选集走一遍，用与分页同一把
     精确过滤器数同一片语料——正文，不物化任何一条消息的展示形态。 */
  private findTotal(
    input: Extract<DatabaseCommand, { kind: "find-messages" }>,
    match: string
  ) {
    const rows = this.database.prepare(
      `SELECT d.document_kind, m.content, ${IMPORTED_CONTENT_SQL} imported_content
         FROM chat_search_fts f
         JOIN chat_search_documents d ON d.row_id = f.rowid
         JOIN chat_local_memberships lm
           ON lm.chat_id = d.chat_id AND lm.device_id = ?
         LEFT JOIN chat_messages m
           ON d.document_kind = 'native'
          AND CAST(m.row_id AS TEXT) = d.source_row_id
         LEFT JOIN chat_active_import_generations ag ON ag.chat_id = d.chat_id
         LEFT JOIN chat_import_entry_versions iv
           ON d.document_kind = 'imported-version'
          AND iv.entry_version_id = d.source_row_id
         LEFT JOIN chat_import_generation_entries ie
           ON ie.chat_id = d.chat_id
          AND ie.generation_id = ag.generation_id
          AND ie.entry_version_id = iv.entry_version_id
        WHERE chat_search_fts MATCH ? AND d.chat_id = ?
          AND d.document_kind IN ('native', 'imported-version')
          AND ${ACTIVE_GENERATION_DOCUMENT_FENCE}`
    ).iterate(input.deviceId, match, input.chatId) as Iterable<Row>;
    let total = 0;
    for (const row of rows) {
      const content = row.document_kind === "native"
        ? String(row.content ?? "")
        : String(row.imported_content ?? "");
      if (matchSearchTokens(normalizeSearchText(content), input.tokens) !== null) {
        total += 1;
      }
    }
    return total;
  }

  /* native 段是时间轴的尾巴：它翻完了才轮到 imported 前缀，于是回溯顺序
     恰好是规范顺序的倒影，页内仍按 seq 升序返回，minimap 的有序前提不破。 */
  private nativePage(chatId: string, beforeSeq: number | null, limit: number, fence: Row) {
    const rows = this.database.prepare(
      `SELECT message_id, seq, role, content FROM chat_messages
        WHERE chat_id = ? AND seq < ?
        ORDER BY seq DESC LIMIT ?`
    ).all(chatId, beforeSeq ?? SEQ_TAIL, limit + 1) as Row[];
    const page = rows.slice(0, limit).reverse();
    const next = rows.length > limit
      ? { segment: "native" as const, beforeSeq: Number(page[0]!.seq) }
      : fence.active_generation_id
        ? { segment: "imported" as const, beforeSeq: null }
        : null;
    return this.page(chatId, fence, page.map((row) => ({
      messageId: String(row.message_id),
      seq: Number(row.seq),
      role: row.role as ChatMessage["role"],
      text: this.preview(row.content),
    })), next);
  }

  private importedPage(chatId: string, beforeSeq: number | null, limit: number, fence: Row) {
    const rows = this.database.prepare(
      `SELECT e.delivery_seq, v.entry_version_id, v.role,
              COALESCE((SELECT GROUP_CONCAT(content, '') FROM (
                 SELECT content FROM chat_import_entry_version_chunks c
                  WHERE c.entry_version_id = v.entry_version_id
                    AND c.field_kind = 'content'
                    AND v.byte_size <= ${IMPORTED_MESSAGE_BYTE_LIMIT}
                  ORDER BY c.ordinal
               )), json_extract(v.payload_json, '$.preview')) content_text
         FROM chat_import_generation_entries e
         JOIN chat_import_entry_versions v ON v.entry_version_id = e.entry_version_id
        WHERE e.chat_id = ? AND e.generation_id = ? AND e.delivery_seq < ?
        ORDER BY e.delivery_seq DESC LIMIT ?`
    ).all(
      chatId,
      fence.active_generation_id as string,
      beforeSeq ?? SEQ_TAIL,
      limit + 1
    ) as Row[];
    const page = rows.slice(0, limit).reverse();
    const next = rows.length > limit
      ? { segment: "imported" as const, beforeSeq: Number(page[0]!.delivery_seq) }
      : null;
    return this.page(chatId, fence, page.map((row) => ({
      messageId: String(row.entry_version_id),
      seq: Number(row.delivery_seq),
      role: row.role as ChatMessage["role"],
      text: this.preview(row.content_text),
    })), next);
  }

  private page(
    chatId: string,
    fence: Row,
    items: ChatOutlinePage["items"],
    next: Pick<ChatOutlineCursor, "segment" | "beforeSeq"> | null
  ): ChatOutlinePage {
    const incarnationId = String(fence.incarnation_id);
    const nativeMessageRevision = Number(fence.native_message_revision);
    const activeGenerationId = this.activeGeneration(fence);
    return {
      chatId,
      incarnationId,
      nativeMessageRevision,
      activeGenerationId,
      items,
      nextCursor: next ? {
        ...next,
        incarnationId,
        nativeMessageRevision,
        activeGenerationId,
      } : null,
    };
  }

  private fence(chatId: string, deviceId: string) {
    return this.database.prepare(
      `SELECT c.incarnation_id, c.native_message_revision, c.lifecycle_kind,
              g.generation_id active_generation_id
         FROM chats c
         JOIN chat_local_memberships m ON m.chat_id = c.id AND m.device_id = ?
         LEFT JOIN chat_active_import_generations g ON g.chat_id = c.id
        WHERE c.id = ?`
    ).get(deviceId, chatId) as Row | undefined;
  }

  private assertCursor(
    fence: Row,
    cursor: Pick<ChatOutlineCursor, "incarnationId" | "nativeMessageRevision" | "activeGenerationId">
  ) {
    if (
      cursor.incarnationId !== String(fence.incarnation_id) ||
      cursor.nativeMessageRevision !== Number(fence.native_message_revision) ||
      cursor.activeGenerationId !== this.activeGeneration(fence)
    ) throw new Error("CHAT_TIMELINE_STALE");
  }

  private activeGeneration(fence: Row) {
    return fence.active_generation_id === null ? null : String(fence.active_generation_id);
  }

  private emptyFindPage(chatId: string, fence: Row) {
    return {
      chatId,
      incarnationId: String(fence.incarnation_id),
      nativeMessageRevision: Number(fence.native_message_revision),
      activeGenerationId: this.activeGeneration(fence),
      items: [],
      total: 0,
      nextCursor: null,
    };
  }

  private preview(value: unknown) {
    return Array.from(String(value ?? "").replace(/\s+/g, " ").trim()).slice(0, 160).join("");
  }
}
