/**
 * [INPUT]: Depends on the active import generation fence
 * [OUTPUT]: Provides the same candidate join and canonical ordering for renderer Find and bounded Agent search
 * [POS]: SQL candidate kernel; exact token matching remains shared/search-text
 */

import { ACTIVE_GENERATION_DOCUMENT_FENCE } from "../repository/imported-sql";
export const FIND_CANDIDATES_SQL = `           FROM chat_search_fts f
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
`;
