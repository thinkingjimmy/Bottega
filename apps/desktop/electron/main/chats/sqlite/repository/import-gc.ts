/**
 * [INPUT]: Depends on the SQLite connection type and the immutable-import generation/entry tables
 * [OUTPUT]: Provides reclaimRetiredGenerations: bounded, saga-fenced deletion of superseded and abandoned import generations plus the orphan entry-version, chunk, search-document and blob sweep that follows
 * [POS]: The reclamation half of HistoryImportRepository; the write path never has to know when a generation stops being reachable
 */

import type { SqliteDatabase } from "../connection";

export type RetiredGenerationGc = Readonly<{
  deletedGenerations: number;
  deletedEntryVersions: number;
  deletedBlobDigests: string[];
}>;

/* 退休的代际有两种：被下一代取代的（superseded，留最近一代备查），以及
   半途夭折的（abandoned——取消、崩溃、启动收尸）。后者一度没有回收者，于是
   每一次失败的重导入都在库里留下一整份 entry 版本、分片和 blob。
   仍有 running run 的代际不碰：它还在被写。 */
export function reclaimRetiredGenerations(
  database: SqliteDatabase,
  chatId: string,
  limitInput = 8
): RetiredGenerationGc {
  const limit = Math.max(1, Math.min(100, limitInput));
  const orphanLimit = limit * 128;
  const generations = database.prepare(
    `SELECT g.generation_id FROM chat_import_generations g
      WHERE g.chat_id = ?
        AND (
          g.state = 'abandoned'
          OR (g.state = 'superseded' AND g.generation_id <> COALESCE((
               SELECT generation_id FROM chat_import_generations
                WHERE chat_id = ? AND state = 'superseded'
                ORDER BY created_at DESC, generation_id DESC LIMIT 1
             ), ''))
        )
        AND NOT EXISTS (SELECT 1 FROM history_import_runs r
          WHERE r.generation_id = g.generation_id AND r.state = 'running')
        AND NOT EXISTS (SELECT 1 FROM chat_continuation_sagas s
          WHERE s.chat_id = g.chat_id AND s.generation_id = g.generation_id
            AND s.state NOT IN ('completed', 'failed'))
      ORDER BY g.created_at, g.generation_id LIMIT ?`
  ).all(chatId, chatId, limit) as Array<{ generation_id: string }>;
  for (const row of generations) {
    database.prepare("DELETE FROM chat_import_generations WHERE generation_id = ?")
      .run(row.generation_id);
  }
  const orphans = database.prepare(
    `SELECT v.entry_version_id FROM chat_import_entry_versions v
      WHERE v.chat_id = ? AND NOT EXISTS (
        SELECT 1 FROM chat_import_generation_entries e
         WHERE e.chat_id = v.chat_id AND e.entry_version_id = v.entry_version_id
      ) ORDER BY v.entry_version_id LIMIT ?`
  ).all(chatId, orphanLimit) as Array<{ entry_version_id: string }>;
  const blobDigests = new Set<string>();
  for (const row of orphans) {
    for (const blob of database.prepare(
      "SELECT content_digest FROM chat_import_entry_blobs WHERE entry_version_id = ?"
    ).all(row.entry_version_id) as Array<{ content_digest: string }>) {
      blobDigests.add(blob.content_digest);
    }
    database.prepare(
      "DELETE FROM chat_search_documents WHERE document_kind = 'imported-version' AND source_row_id = ?"
    ).run(row.entry_version_id);
    database.prepare("DELETE FROM chat_import_entry_versions WHERE entry_version_id = ?")
      .run(row.entry_version_id);
  }
  const deletedBlobDigests = [...blobDigests].filter((contentDigest) => {
    const retained = database.prepare(
      "SELECT 1 FROM chat_import_entry_blobs WHERE content_digest = ? LIMIT 1"
    ).get(contentDigest);
    if (retained) return false;
    database.prepare("DELETE FROM chat_import_blobs WHERE content_digest = ?").run(contentDigest);
    return true;
  });
  return {
    deletedGenerations: generations.length,
    deletedEntryVersions: orphans.length,
    deletedBlobDigests,
  };
}
