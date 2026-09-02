/**
 * [INPUT]: Depends on the closed Chat database protocol, SQLite membership/message/Subagent rows, canonical Chat limits, and row codecs
 * [OUTPUT]: Provides exact native-message lookup plus bounded native-message and Subagent reads without materializing unrelated Chat components
 * [POS]: Narrow fact reader beneath ChatRepository; metadata, imported timeline, and branch reads remain separate concerns
 */

import type { DatabaseCommand } from "../../database-protocol";
import type { SqliteDatabase } from "../../connection";
import {
  assertSubagentBudget,
  CHAT_BYTE_LIMIT,
  CHAT_MESSAGE_LIMIT,
  subagentsSchema,
} from "../../../chat-schema";
import { messageFromRow, parseJson, type Row } from "../codec";

export class ChatFactReader {
  constructor(private readonly database: SqliteDatabase) {}

  getMessage(command: Extract<DatabaseCommand, { kind: "get-native-message" }>) {
    this.assertMembership(command.chatId, command.deviceId);
    const selector = command.selector;
    const row = selector.kind === "id"
      ? this.database.prepare(
          "SELECT * FROM chat_messages WHERE chat_id = ? AND message_id = ?"
        ).get(command.chatId, selector.messageId)
      : selector.kind === "seq"
        ? this.database.prepare(
            "SELECT * FROM chat_messages WHERE chat_id = ? AND seq = ?"
          ).get(command.chatId, selector.seq)
        : this.database.prepare(
            "SELECT * FROM chat_messages WHERE chat_id = ? AND role = 'user' ORDER BY seq LIMIT 1"
          ).get(command.chatId);
    return row ? messageFromRow(row as Row) : null;
  }

  getMessages(command: Extract<DatabaseCommand, { kind: "get-native-messages" }>) {
    this.assertMembership(command.chatId, command.deviceId);
    const usage = this.database.prepare(
      `SELECT COUNT(*) rows,
              COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) bytes
         FROM chat_messages WHERE chat_id = ?`
    ).get(command.chatId) as Row;
    if (
      Number(usage.rows) > CHAT_MESSAGE_LIMIT * 2 ||
      Number(usage.bytes) > CHAT_BYTE_LIMIT * 4
    ) {
      throw new Error(`CHAT_NATIVE_CONTEXT_BUDGET_EXCEEDED:${command.chatId}`);
    }
    return (this.database.prepare(
      "SELECT * FROM chat_messages WHERE chat_id = ? ORDER BY seq"
    ).all(command.chatId) as Row[]).map(messageFromRow);
  }

  getSubagents(command: Extract<DatabaseCommand, { kind: "get-native-subagents" }>) {
    this.assertMembership(command.chatId, command.deviceId);
    const value = Object.fromEntries((this.database.prepare(
      "SELECT agent_thread_id, meta_json, parts_json FROM chat_subagents WHERE chat_id = ? ORDER BY agent_thread_id"
    ).all(command.chatId) as Row[]).map((row) => [
      String(row.agent_thread_id),
      {
        meta: parseJson(row.meta_json, "subagent meta"),
        parts: parseJson(row.parts_json, "subagent parts"),
      },
    ]));
    const parsed = subagentsSchema.parse(value);
    assertSubagentBudget(parsed);
    return parsed;
  }

  private assertMembership(chatId: string, deviceId: string) {
    const row = this.database.prepare(
      `SELECT c.*, a.aggregate_revision, a.timeline_revision,
              g.entry_count active_generation_entry_count,
              g.byte_size active_generation_byte_size
         FROM chats c
         JOIN chat_local_memberships m
           ON m.chat_id = c.id AND m.device_id = ?
         JOIN chat_local_aggregate_state a
           ON a.chat_id = c.id AND a.device_id = ?
         LEFT JOIN chat_active_import_generations ag ON ag.chat_id = c.id
         LEFT JOIN chat_import_generations g
           ON g.chat_id = ag.chat_id AND g.generation_id = ag.generation_id
        WHERE c.id = ?`
    ).get(deviceId, deviceId, chatId) as Row | undefined;
    if (!row) throw new Error("Chat does not exist on this device");
    return row;
  }
}
