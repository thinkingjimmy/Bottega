/**
 * [INPUT]: Depends on Node crypto, shared Chat schemas/search projection, SQLite statement types, and mutation receipt contracts
 * [OUTPUT]: Provides deterministic SQLite JSON/digest/search codecs, the projection-free persisted message payload, connection-scoped prepared-statement reuse, and row-to-message/receipt decoders
 * [POS]: Shared value-codec layer for repository readers, writers, and mutation orchestration
 */

import { createHash } from "node:crypto";
import type { ChatMessage } from "../../../../../shared/chats-ipc";
import { normalizeSearchText } from "../../../../../shared/search-text";
import { messageLines } from "../../../sections/export-transcript";
import { messageSchema } from "../../chat-schema";
import type { MutationReceipt } from "../database-protocol";
import type { SqliteDatabase, SqliteStatement } from "../connection";

export const SEARCH_CODEC_VERSION = 1;
export type Row = Record<string, unknown>;

export const json = (value: unknown) => JSON.stringify(value);
export const digest = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const changes = (value: { changes: number | bigint }) =>
  Number(value.changes);

const statementCaches = new WeakMap<SqliteDatabase, Map<string, SqliteStatement>>();

export function prepared(database: SqliteDatabase, sql: string) {
  let cache = statementCaches.get(database);
  if (!cache) {
    cache = new Map();
    statementCaches.set(database, cache);
  }
  const existing = cache.get(sql);
  if (existing) return existing;
  const statement = database.prepare(sql);
  cache.set(sql, statement);
  return statement;
}

/* segment 是只读导入段的读侧投影位。让它随原生消息落盘，下一次读回来
   就会把一条自己写下的消息说成「导入的」——投影位永不进入真相。 */
export function persistedMessagePayload(message: ChatMessage) {
  const { segment: _segment, ...persisted } = message as ChatMessage &
    { segment?: "imported" };
  return json(persisted);
}

export function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== "string") throw new Error(`${label} is not text`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} contains invalid JSON`);
  }
}

export function gramTokens(value: string) {
  const result = new Set<string>();
  for (const token of normalizeSearchText(value).split(" ")) {
    const points = Array.from(token);
    for (const width of [1, 2, 3]) {
      for (let index = 0; index + width <= points.length; index += 1) {
        const bytes = Buffer.from(points.slice(index, index + width).join(""), "utf8");
        result.add(`g${width}${bytes.toString("hex")}`);
      }
    }
  }
  return [...result].sort();
}

export function queryGramTokens(tokens: readonly string[]) {
  const grams = new Set<string>();
  for (const token of tokens) {
    const points = Array.from(normalizeSearchText(token));
    const width = Math.min(3, points.length);
    if (!width) continue;
    for (let index = 0; index + width <= points.length; index += 1) {
      grams.add(
        `g${width}${Buffer.from(points.slice(index, index + width).join(""), "utf8").toString("hex")}`
      );
    }
  }
  return [...grams].sort();
}

export function messageSearchText(message: ChatMessage) {
  return message.role === "notice"
    ? ""
    : normalizeSearchText(messageLines(message, "plain").join("\n"));
}

export function messageFromRow(row: Row): ChatMessage {
  const parsed = messageSchema.parse(parseJson(row.payload_json, "message payload"));
  if (
    parsed.id !== row.message_id ||
    parsed.seq !== row.seq ||
    parsed.role !== row.role ||
    parsed.content !== row.content ||
    parsed.createdAt !== row.created_at
  ) {
    throw new Error("message row and payload disagree");
  }
  return parsed;
}

export function receiptFromRow(row: Row): MutationReceipt<unknown> {
  return {
    operationId: String(row.operation_id),
    requestHash: String(row.request_hash),
    kind: String(row.kind),
    targetId: row.target_id === null ? null : String(row.target_id),
    result: parseJson(row.result_json, "operation result"),
    committedAt: Number(row.committed_at),
  };
}
