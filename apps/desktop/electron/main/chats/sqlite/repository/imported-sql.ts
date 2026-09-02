/**
 * [INPUT]: Depends on nothing but the imported-generation table names
 * [OUTPUT]: Provides the imported-entry renderer byte ceiling, the one imported-entry projection SELECT, and the active-generation document fence
 * [POS]: Single SQL text authority shared by every imported-entry reader; a projection column can no longer drift between the record, timeline, and outline reads
 */

/** 超过这个体量的一条导入 entry 不再穿过 Worker IPC，只给预览。 */
export const IMPORTED_MESSAGE_BYTE_LIMIT = 32 * 1024;

/* 一条导入 entry 的完整读法：正文分片拼回、超限内容退回 blob 元数据。
   记录读、时间线页、时间线邻域问的是同一件事，因此只该有一份问法。 */
export const IMPORTED_ENTRY_SELECT = `SELECT e.delivery_seq, v.*,
        (SELECT GROUP_CONCAT(content, '') FROM (
           SELECT content FROM chat_import_entry_version_chunks c
           WHERE c.entry_version_id = v.entry_version_id AND c.field_kind = 'content'
             AND v.byte_size <= ${IMPORTED_MESSAGE_BYTE_LIMIT}
            ORDER BY c.ordinal
         )) content_text,
        (SELECT b.local_path FROM chat_import_entry_blobs eb
          JOIN chat_import_blobs b ON b.content_digest = eb.content_digest
         WHERE eb.entry_version_id = v.entry_version_id AND eb.field_kind = 'content') content_blob_path,
        (SELECT b.content_digest FROM chat_import_entry_blobs eb
          JOIN chat_import_blobs b ON b.content_digest = eb.content_digest
         WHERE eb.entry_version_id = v.entry_version_id AND eb.field_kind = 'content') content_blob_digest
   FROM chat_import_generation_entries e
   JOIN chat_import_entry_versions v ON v.entry_version_id = e.entry_version_id`;

/* 只有仍挂在活跃代上的 imported 文档算数：被取代的那一代还留在索引里，
   放它进候选集就是让搜索命中一段已经不存在的历史。别名 `d` 是搜索文档，
   `ie` 是活跃代的成员行。 */
export const ACTIVE_GENERATION_DOCUMENT_FENCE =
  "(d.document_kind <> 'imported-version' OR ie.entry_version_id IS NOT NULL)";
