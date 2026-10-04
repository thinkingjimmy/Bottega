/**
 * [INPUT]: Depends on the closed Memory database commands, canonical native-message rows, current-device membership/binding facts, and message codecs
 * [OUTPUT]: Provides native-only Memory summaries and bounded forward segment pages with the preceding user fence
 * [POS]: Chat repository Memory authorization reader; imported generations are deliberately invisible here
 */

import type {
  DatabaseCommand,
  MemoryChatSummary,
} from "../../database-protocol";
import type { SqliteDatabase } from "../../connection";
import { messageFromRow, type Row } from "../codec";

export class ChatMemoryReader {
  constructor(private readonly database: SqliteDatabase) {}

  listSummaries(deviceId: string): MemoryChatSummary[] {
    return this.database.prepare(
      `SELECT c.id, c.incarnation_id, b.home_dir,
              COALESCE(MAX(m.seq), 0) last_seq, c.trimmed_through_seq
         FROM chats c
         JOIN chat_device_bindings b
           ON b.chat_id = c.id AND b.device_id = ? AND b.state = 'ready'
         LEFT JOIN chat_messages m ON m.chat_id = c.id
        WHERE c.lifecycle_kind <> 'external-readonly'
        GROUP BY c.id, c.incarnation_id, b.home_dir, c.trimmed_through_seq
        ORDER BY c.id`
    ).all(deviceId).map((row) => {
      const value = row as Row;
      return {
        id: String(value.id),
        incarnationId: String(value.incarnation_id),
        homeDir: value.home_dir === null ? null : String(value.home_dir),
        lastSeq: Number(value.last_seq),
        trimmedThroughSeq: Number(value.trimmed_through_seq),
      };
    });
  }

  getSegment(
    command: Extract<DatabaseCommand, { kind: "get-memory-native-segment" }>
  ) {
    this.assertRequest(command.afterSeq, command.limit);
    const core = this.database.prepare(
      `SELECT c.id, c.incarnation_id, c.trimmed_through_seq,
              m.local_project_id, b.home_dir,
              COALESCE((SELECT MAX(seq) FROM chat_messages WHERE chat_id = c.id), 0) last_seq
         FROM chats c
         JOIN chat_local_memberships m
           ON m.chat_id = c.id AND m.device_id = ?
         JOIN chat_device_bindings b
           ON b.chat_id = c.id AND b.device_id = ? AND b.state = 'ready'
        WHERE c.id = ? AND c.lifecycle_kind <> 'external-readonly'`
    ).get(command.deviceId, command.deviceId, command.chatId) as Row | undefined;
    if (!core) return null;
    const rows = this.database.prepare(
      `SELECT * FROM chat_messages WHERE chat_id = ? AND seq > ?
        ORDER BY seq LIMIT ?`
    ).all(command.chatId, command.afterSeq, command.limit + 1) as Row[];
    const preceding = this.database.prepare(
      `SELECT * FROM chat_messages
        WHERE chat_id = ? AND role = 'user' AND seq <= ?
        ORDER BY seq DESC LIMIT 1`
    ).get(command.chatId, command.afterSeq) as Row | undefined;
    const messages = rows.slice(0, command.limit).map(messageFromRow);
    return {
      id: String(core.id),
      incarnationId: String(core.incarnation_id),
      projectId: core.local_project_id === null ? null : String(core.local_project_id),
      homeDir: core.home_dir === null ? null : String(core.home_dir),
      lastSeq: Number(core.last_seq),
      trimmedThroughSeq: Number(core.trimmed_through_seq),
      precedingUser: preceding ? messageFromRow(preceding) : null,
      messages,
      nextAfterSeq: rows.length > command.limit ? messages.at(-1)!.seq : null,
    };
  }

  private assertRequest(afterSeq: number, limit: number) {
    if (
      !Number.isSafeInteger(afterSeq) || afterSeq < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 256
    ) throw new Error("Memory native segment request is invalid");
  }
}
