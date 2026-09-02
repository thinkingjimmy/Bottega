/**
 * [INPUT]: Depends on canonical Chat aggregate limits, SQLite scalar counts, and repository row codecs
 * [OUTPUT]: Provides fail-fast row/byte admission for the one reader that still materializes a whole Chat aggregate
 * [POS]: Safety fence beside the paged readers; no caller may pull an unbounded Chat into main memory
 */

import { CHAT_BYTE_LIMIT, CHAT_MESSAGE_LIMIT } from "../../../chat-schema";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../codec";

const NATIVE_ROW_LIMIT = CHAT_MESSAGE_LIMIT * 2;
const NATIVE_STORED_BYTE_LIMIT = CHAT_BYTE_LIMIT * 4;

export function assertFullAggregateBudget(
  database: SqliteDatabase,
  core: Row,
  chatId: string
) {
  const usage = core.lifecycle_kind === "external-readonly"
    ? {
        rows: Number(core.active_generation_entry_count),
        bytes: Number(core.active_generation_byte_size),
        rowLimit: CHAT_MESSAGE_LIMIT,
        byteLimit: CHAT_BYTE_LIMIT,
      }
    : {
        ...(database.prepare(
          `SELECT
             (SELECT COUNT(*) FROM chat_messages WHERE chat_id = ?) +
             (SELECT COUNT(*) FROM chat_branch_messages WHERE chat_id = ?) +
             (SELECT COUNT(*) FROM chat_subagents WHERE chat_id = ?) rows,
             (SELECT COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0)
                FROM chat_messages WHERE chat_id = ?) +
             (SELECT COALESCE(SUM(LENGTH(CAST(message_json AS BLOB))), 0)
                FROM chat_branch_messages WHERE chat_id = ?) +
             (SELECT COALESCE(SUM(LENGTH(CAST(meta_json AS BLOB))) +
                              SUM(LENGTH(CAST(parts_json AS BLOB))), 0)
                FROM chat_subagents WHERE chat_id = ?) bytes`
        ).get(chatId, chatId, chatId, chatId, chatId, chatId) as Row),
        rowLimit: NATIVE_ROW_LIMIT,
        byteLimit: NATIVE_STORED_BYTE_LIMIT,
      };
  if (Number(usage.rows) > usage.rowLimit || Number(usage.bytes) > usage.byteLimit) {
    throw new Error(`CHAT_AGGREGATE_BUDGET_EXCEEDED:${chatId}`);
  }
}
