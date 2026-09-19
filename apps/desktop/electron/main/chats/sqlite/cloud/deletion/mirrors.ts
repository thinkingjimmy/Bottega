/**
 * [INPUT]: Depends on scoped mirror rows, confirmed tombstones and retained pending edits.
 * [OUTPUT]: Reads minimal deletion targets and atomically removes mirrors, their cached bodies and catalog visibility while retaining unpublished candidate custody.
 * [POS]: Sole SQLite mirror deletion writer; no native ChatRecord or local execution authority is manufactured.
 */
import type { CloudTombstone } from "@ai-chat/cloud-protocol/lifecycle/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { digest, json, type Row } from "../../repository/codec";
import { releaseMirrorArchiveRoots, releaseRoot, retainSource } from "../retention";
import { clearMirrorBodies } from "../mirror/references";
import { deletionTargetSchema, chatRemovalStateSchema } from "./model";
import { readDeletionMarker, rememberDeletion } from "./markers";
export function deletionOutbox(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  return db.prepare("SELECT * FROM cloud_outbox WHERE environment=? AND user_id=? AND json_extract(payload_json,'$.chatId')=? ORDER BY id")
    .all(scope.environment, scope.userId, chatId) as Row[];
}
export function chatRemovalState(db: SqliteDatabase, chatId: string) {
  const row = db.prepare("SELECT incarnation_id,cloud_state,cloud_environment,cloud_user_id FROM chats WHERE id=?").get(chatId) as Row | undefined;
  return chatRemovalStateSchema.parse(row ? { incarnationId: row.incarnation_id, scope: row.cloud_state === "local-only" ? null :
    { environment: row.cloud_environment, userId: row.cloud_user_id } } : null);
}
export function deletionTarget(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const row = db.prepare("SELECT * FROM chats WHERE id=?").get(chatId) as Row | undefined;
  if (!row) return null;
  if (row.cloud_state !== "local-only" && (row.cloud_environment !== scope.environment || row.cloud_user_id !== scope.userId)) throw new Error("CHAT_SCOPE_MISMATCH");
  return deletionTargetSchema.parse({ id: chatId, incarnationId: row.incarnation_id, projectId: row.portable_project_id,
    residence: row.cloud_state === "mirror" ? "mirror" : "native", revision: row.core_revision, messageRevision: row.native_message_revision,
    outboxHash: digest(json(deletionOutbox(db, scope, chatId).map(row => [row.id, row.payload_digest]))), deletion: readDeletionMarker(db, scope, chatId) });
}
export function removeCloudMirror(db: SqliteDatabase, scope: SyncScope, marker: CloudTombstone, now: number) {
  if (marker.entityKind !== "chat") throw new Error("CHAT_TOMBSTONE_REQUIRED");
  const target = deletionTarget(db, scope, marker.entityId);
  if (target && (target.residence !== "mirror" || marker.incarnationId !== null && marker.incarnationId !== target.incarnationId)) throw new Error("MIRROR_DELETION_IDENTITY_CHANGED");
  const prior = db.prepare("SELECT incarnation_id FROM cloud_tombstones WHERE environment=? AND user_id=? AND chat_id=?")
    .get(scope.environment, scope.userId, marker.entityId) as Row | undefined;
  const incarnationId = target?.incarnationId ?? marker.incarnationId ?? prior?.incarnation_id;
  if (!incarnationId) throw new Error("DELETION_INCARNATION_UNAVAILABLE");
  if (prior && prior.incarnation_id !== incarnationId) throw new Error("DELETION_INCARNATION_CHANGED");
  if (target) {
    const pending = db.prepare("SELECT * FROM cloud_outbox WHERE environment=? AND user_id=? AND json_extract(payload_json,'$.chatId')=?")
      .all(scope.environment, scope.userId, marker.entityId) as Row[];
    if (pending.length) {
      const rootId = `deletion-candidate:${digest(json([scope, marker.entityId, incarnationId]))}`;
      db.prepare(`INSERT OR IGNORE INTO chat_retention_roots(root_id,source_id)
        SELECT ?,s.source_id FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
        WHERE s.chat_id=? AND s.environment=? AND s.user_id=?`).run(rootId, marker.entityId, scope.environment, scope.userId);
      const metadata = db.prepare("SELECT confirmed_json,observed_json FROM cloud_chat_metadata_state WHERE chat_id=?").get(marker.entityId) as Row | undefined;
      retainSource(db, { scope, chatId: marker.entityId, rootId, kind: "deleted-mirror-candidate", revision: marker.revision,
        payload: { marker, metadata: metadata ?? null, operations: pending.map(row => ({ id: row.id, payloadDigest: row.payload_digest, source: JSON.parse(String(row.payload_json)) })) }, now });
    }
    for (const item of pending) { db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(item.id)); releaseRoot(db, `outbox:${item.id}`); }
    releaseMirrorArchiveRoots(db, scope, marker.entityId);
    // Search documents are scoped to the mirror row, so the bodies go before the row does.
    clearMirrorBodies(db, scope, marker.entityId);
    db.prepare("DELETE FROM chats WHERE id=?").run(marker.entityId);
  }
  rememberDeletion(db, scope, marker, String(incarnationId), now);
  db.prepare("UPDATE cloud_chat_metadata_state SET deleted=1,tail_operation_id=NULL WHERE chat_id=?").run(marker.entityId);
  return { chatId: marker.entityId };
}
