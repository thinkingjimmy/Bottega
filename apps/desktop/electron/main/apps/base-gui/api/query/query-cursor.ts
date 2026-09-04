/**
 * [INPUT]: Depends on node:crypto HMAC/timing-safe comparison, canonical JSON, Base cell values, and the shared API error factory
 * [OUTPUT]: Provides the authenticated Query V1 keyset cursor type with encode/decode that separates a malformed cursor (400) from a stale snapshot identity (409)
 * [POS]: Cursor codec leaf of api/query/; query-v1.ts owns ordering and paging while this file owns only the token
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import type { BaseCellValue } from "../../../../../../shared/bases-ipc";
import { canonicalJson } from "../../../gui-build/metadata";
import { apiError } from "../errors";

export type QueryCursorV1 = Readonly<{
  v: 1;
  shapeDigest: `sha256:${string}`;
  baseInstanceId: string;
  revision: number;
  limit: number;
  lastSortKeys: readonly (BaseCellValue | null)[];
  itemId: string;
}>;

export function encodeCursor(cursor: QueryCursorV1, key: Uint8Array) {
  const payload = Buffer.from(canonicalJson(cursor)).toString("base64url");
  const signature = createHmac("sha256", key).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function decodeCursor(
  value: string,
  key: Uint8Array,
  expected: Pick<QueryCursorV1, "shapeDigest" | "baseInstanceId" | "revision" | "limit">
): QueryCursorV1 {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra) throw invalid();
  const actual = createHmac("sha256", key).update(payload).digest();
  const supplied = Buffer.from(signature, "base64url");
  if (actual.length !== supplied.length || !timingSafeEqual(actual, supplied)) throw invalid();
  let cursor: QueryCursorV1;
  try {
    cursor = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as QueryCursorV1;
  } catch {
    throw invalid();
  }
  /* 形状坏了与身份换代是两件事：坏游标永远不会自愈，说成 409 会让 App 对着
     它无限重试；换代则只需要从头再翻一次。 */
  if (
    cursor.v !== 1 || cursor.limit !== expected.limit ||
    !Array.isArray(cursor.lastSortKeys) || typeof cursor.itemId !== "string"
  ) throw invalid();
  if (
    cursor.shapeDigest !== expected.shapeDigest ||
    cursor.baseInstanceId !== expected.baseInstanceId ||
    cursor.revision !== expected.revision
  ) throw apiError(409, "query_revision_changed", "Query cursor identity changed");
  return cursor;
}

function invalid() {
  return apiError(400, "query_cursor_invalid", "Query cursor is invalid");
}
