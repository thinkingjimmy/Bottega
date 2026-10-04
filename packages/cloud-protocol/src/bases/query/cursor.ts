/**
 * [INPUT]: Depends on @ai-chat/base-core semantic contracts; @noble/hashes HMAC-SHA-256, the product canonical JSON (@bottega/contracts), the shared strict base64url leaf, Base cell values and queryError.
 * [OUTPUT]: The authenticated Query V1 keyset cursor type with encode/decode that separates a malformed cursor (400) from a changed snapshot
 *           identity (409).
 * [POS]: Cursor codec leaf of bases/query; execute.ts owns ordering and paging, this file owns only the token. Synchronous and Node-free, so
 *        the desktop worker and the browser share it.
 */
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { BaseCellValue } from "@ai-chat/base-core/model/bases-ipc";
import { canonicalJson } from "@bottega/contracts/core/canonical-json";
import { encodeBase64url, parseBase64url } from "../../encryption/base64url";

const utf8 = new TextEncoder();
import { queryError } from "./error";

export type QueryCursorV1 = Readonly<{
  v: 1;
  shapeDigest: `sha256:${string}`;
  baseInstanceId: string;
  revision: number;
  limit: number;
  lastSortKeys: readonly (BaseCellValue | null)[];
  itemId: string;
}>;

const sign = (payload: string, key: Uint8Array) => hmac(sha256, key, utf8.encode(payload));

export function encodeCursor(cursor: QueryCursorV1, key: Uint8Array) {
  const payload = encodeBase64url(utf8.encode(canonicalJson(cursor)));
  return `${payload}.${encodeBase64url(sign(payload, key))}`;
}

export function decodeCursor(
  value: string,
  key: Uint8Array,
  expected: Pick<QueryCursorV1, "shapeDigest" | "baseInstanceId" | "revision" | "limit">
): QueryCursorV1 {
  const [payload, signature, extra] = value.split(".");
  if (!payload || !signature || extra !== undefined) throw invalid();
  let cursor: QueryCursorV1;
  const supplied = parseBase64url(signature, 32);
  if (!supplied) throw invalid();
  if (!constantTimeEqual(sign(payload, key), supplied)) throw invalid();
  const bytes = parseBase64url(payload, 1, 4_096);
  if (!bytes) throw invalid();
  try { cursor = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as QueryCursorV1; } catch { throw invalid(); }
  /* A malformed cursor never heals, so calling it 409 would have the App retry it forever; a changed identity only needs a fresh first page. */
  if (!cursor || typeof cursor !== "object" || cursor.v !== 1 || cursor.limit !== expected.limit ||
    !Array.isArray(cursor.lastSortKeys) || typeof cursor.itemId !== "string") throw invalid();
  if (cursor.shapeDigest !== expected.shapeDigest || cursor.baseInstanceId !== expected.baseInstanceId || cursor.revision !== expected.revision) {
    throw queryError(409, "query_revision_changed", "Query cursor identity changed");
  }
  return cursor;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}

function invalid() {
  return queryError(400, "query_cursor_invalid", "Query cursor is invalid");
}
