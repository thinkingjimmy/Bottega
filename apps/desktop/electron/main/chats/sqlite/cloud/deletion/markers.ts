/**
 * [INPUT]: Depends on scoped permanent markers, immutable retention and the existing initialization manifest.
 * [OUTPUT]: Remembers confirmed deletion identity and settles the removed initialization entry without claiming a content upload.
 * [POS]: SQLite deletion evidence; the original account outbox remains the sole pending-work owner.
 */
import { tombstoneSchema, type CloudTombstone } from "@ai-chat/cloud-protocol/lifecycle/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import { digest, json, type Row } from "../../repository/codec";
import { retainSource } from "../retention";
export function readDeletionMarker(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const row = db.prepare(`SELECT s.payload_json,s.digest FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
    WHERE s.chat_id=? AND s.environment=? AND s.user_id=? AND s.kind='confirmed-deletion-marker' AND r.root_id=? LIMIT 1`)
    .get(chatId, scope.environment, scope.userId, `confirmed-deletion:${digest(json([scope, chatId]))}`) as Row | undefined;
  if (!row) return null;
  if (digest(String(row.payload_json)) !== row.digest) throw new Error("DELETION_MARKER_CORRUPT");
  return tombstoneSchema.parse(JSON.parse(String(row.payload_json)));
}
export function rememberDeletion(db: SqliteDatabase, scope: SyncScope, marker: CloudTombstone, incarnationId: string, now: number) {
  const prior = readDeletionMarker(db, scope, marker.entityId);
  if (marker.entityKind !== "chat" || prior && json(prior) !== json(marker) || marker.incarnationId && marker.incarnationId !== incarnationId) throw new Error("DELETION_MARKER_CHANGED");
  db.prepare("INSERT OR IGNORE INTO cloud_tombstones(environment,user_id,chat_id,incarnation_id,deleted_at) VALUES(?,?,?,?,?)")
    .run(scope.environment, scope.userId, marker.entityId, incarnationId, marker.deletedAt);
  if (!prior) retainSource(db, { scope, chatId: marker.entityId, rootId: `confirmed-deletion:${digest(json([scope, marker.entityId]))}`,
    kind: "confirmed-deletion-marker", revision: marker.revision, payload: marker, now });
  settleDeletedInitialization(db, scope, marker, now);
}
export function settleDeletedInitialization(db: SqliteDatabase, scope: SyncScope, marker: CloudTombstone, now: number) {
  const row = db.prepare("SELECT initial_manifest_json FROM cloud_sync_state WHERE environment=? AND user_id=?").get(scope.environment, scope.userId) as Row | undefined;
  if (!row?.initial_manifest_json) return;
  const manifest = JSON.parse(String(row.initial_manifest_json));
  const entry = manifest.entries.find((entry: { chatId: string }) => entry.chatId === marker.entityId);
  if (!entry || entry.completionHash) return;
  entry.completionHash = digest(json(["confirmed-deletion", marker]));
  if (manifest.entries.every((item: { completionHash?: string }) => item.completionHash)) manifest.state = "complete";
  db.prepare("UPDATE cloud_sync_state SET initial_manifest_json=?,updated_at=? WHERE environment=? AND user_id=?")
    .run(json(manifest), now, scope.environment, scope.userId);
}
