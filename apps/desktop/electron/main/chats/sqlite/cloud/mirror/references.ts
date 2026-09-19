/**
 * [INPUT]: Depends on the existing retention-root primary key and verified retained source payloads.
 * [OUTPUT]: Provides ordered body references, exact message identity guards and revision-scoped custody.
 * [POS]: Mirror cache index; complete cloud history stays outside the bounded native execution aggregate.
 */
import type { z } from "zod";
import { hashChatContent, chatBodySchema } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { Row } from "../../repository/codec";
import { retainSource } from "../retention";
import { readRetainedSource } from "../inventory/source";
import { mirrorBodyReferenceSchema } from "./contracts";
export type MirrorBodyReference = z.infer<typeof mirrorBodyReferenceSchema>;
export const markerRoot = (scope: SyncScope, chatId: string) => `mirror:${chatId}:download:${hashChatContent(scope)}`;
export const bodyRoot = (scope: SyncScope, chatId: string) => markerRoot(scope, chatId) + ":bodies";
const ordinal = (seq: number) => String(seq).padStart(16, "0");
export const bodySourceRoot = (scope: SyncScope, chatId: string, seq: number) => `${bodyRoot(scope, chatId)}:body:${ordinal(seq)}`;
const referencePrefix = (scope: SyncScope, chatId: string) => `${bodyRoot(scope, chatId)}:ref:`;
const identityRoot = (scope: SyncScope, chatId: string, messageId: string) => `${bodyRoot(scope, chatId)}:id:${messageId}`;
function readReference(db: SqliteDatabase, row: Row) {
  return mirrorBodyReferenceSchema.parse(readRetainedSource(db, { sourceId: String(row.source_id), digest: String(row.digest) }));
}
export function hasMirrorMessage(db: SqliteDatabase, scope: SyncScope, chatId: string, messageId: string) {
  return Boolean(db.prepare("SELECT 1 FROM chat_retention_roots WHERE root_id=? LIMIT 1").get(identityRoot(scope, chatId, messageId)));
}
export function indexMirrorBody(db: SqliteDatabase, scope: SyncScope, chatId: string, revision: number, reference: MirrorBodyReference, now: number) {
  const rootId = referencePrefix(scope, chatId) + ordinal(reference.seq);
  for (const key of [rootId, identityRoot(scope, chatId, reference.messageId)]) {
    const rows = db.prepare(`SELECT s.source_id,s.digest FROM chat_retention_roots r
      JOIN chat_retained_sources s ON s.source_id=r.source_id WHERE r.root_id=?`).all(key) as Row[];
    if (rows.length > 1 || rows[0] && hashChatContent(readReference(db, rows[0])) !== hashChatContent(reference)) throw new Error("MIRROR_BODY_IDENTITY_CHANGED");
  }
  const source = retainSource(db, { scope, chatId, rootId, revision, kind: "mirror-body-reference", payload: reference, now });
  db.prepare("INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id) VALUES(?,?)")
    .run(identityRoot(scope, chatId, reference.messageId), source.sourceId);
}
export function mirrorReferences(db: SqliteDatabase, scope: SyncScope, chatId: string, cursor: number | null, limit: number, direction: "before" | "after" = "before") {
  const prefix = referencePrefix(scope, chatId);
  const lower = direction === "after" && cursor !== null ? prefix + ordinal(cursor + 1) : prefix;
  const upper = direction === "before" && cursor !== null ? prefix + ordinal(cursor) : prefix + "~";
  const rows = db.prepare(`SELECT r.root_id,s.source_id,s.digest FROM chat_retention_roots r
    JOIN chat_retained_sources s ON s.source_id=r.source_id
    WHERE r.root_id>=? AND r.root_id<? AND s.environment=? AND s.user_id=? AND s.kind='mirror-body-reference'
    ORDER BY r.root_id ${direction === "after" ? "ASC" : "DESC"} LIMIT ?`).all(lower, upper, scope.environment, scope.userId, limit) as Row[];
  return rows.map(row => {
    const reference = readReference(db, row);
    if (row.root_id !== prefix + ordinal(reference.seq)) throw new Error("MIRROR_BODY_IDENTITY_CHANGED");
    return reference;
  });
}
export function readMirrorBody(db: SqliteDatabase, reference: MirrorBodyReference) {
  const body = chatBodySchema.parse(readRetainedSource(db, reference));
  if (body.message.id !== reference.messageId || body.message.seq !== reference.seq) throw new Error("MIRROR_BODY_IDENTITY_CHANGED");
  return body;
}
export function clearMirrorBodies(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  db.prepare(`DELETE FROM chat_search_documents WHERE chat_id=? AND document_kind='native'
    AND EXISTS(SELECT 1 FROM chats c WHERE c.id=chat_id AND c.cloud_state='mirror' AND c.cloud_environment=? AND c.cloud_user_id=?)`)
    .run(chatId, scope.environment, scope.userId);
  const root = bodyRoot(scope, chatId), prefix = root + ":", files = `mirror:${chatId}:files:`;
  db.prepare("DELETE FROM chat_retention_roots WHERE root_id=? OR (root_id>=? AND root_id<?)").run(root, prefix, prefix + "~");
  db.prepare("DELETE FROM chat_retention_roots WHERE root_id>=? AND root_id<?").run(files, files + "~");
  db.prepare(`DELETE FROM chat_retained_sources WHERE chat_id=? AND environment=? AND user_id=?
    AND NOT EXISTS(SELECT 1 FROM chat_retention_roots r WHERE r.source_id=chat_retained_sources.source_id)`)
    .run(chatId, scope.environment, scope.userId);
}
