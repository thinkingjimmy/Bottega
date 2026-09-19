/**
 * [INPUT]: Depends on local lifecycle facts, complete saved native history, original outbox roots and confirmed deletion evidence.
 * [OUTPUT]: Archives executable local branches while retaining imported generations without aggregate reads, and fences remotely deleted Chats.
 * [POS]: Sole SQLite native deletion disposition; local Home and original records remain available for explicit rescue.
 */
import { readSavedNative } from "../../../../library/mirrors/native-source";
import { cloudChatHeadSchema, type CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { CloudTombstone } from "@ai-chat/cloud-protocol/lifecycle/model";
import type { SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { SqliteDatabase } from "../../connection";
import type { ChatRepositoryReader } from "../../repository/reader";
import { digest, json, type Row } from "../../repository/codec";
import { archiveDeletion, portableFacts } from "../snapshots";
import { archiveExecution } from "../execution/archive";
import { releaseRoot } from "../retention";
import { rememberDeletion } from "./markers";
import { deletionOutbox, deletionTarget } from "./mirrors";
import { assertHomeCaptured } from "../home/jobs";
import { captureMirrorMetadata } from "../delivery/metadata-capture";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
type DeletionInput = { tombstone: CloudTombstone; expectedRevision: number; expectedMessageRevision: number; expectedOutboxHash: string };
export function prepareDeletedChat(db: SqliteDatabase, reader: ChatRepositoryReader, scope: SyncScope, deviceId: string, input: DeletionInput, now: number) {
  const marker = input.tombstone, target = deletionTarget(db, scope, marker.entityId);
  if (marker.entityKind !== "chat" || !target || target.residence !== "native" || marker.incarnationId && marker.incarnationId !== target.incarnationId) throw new Error("NATIVE_DELETION_IDENTITY_CHANGED");
  if (target.revision !== input.expectedRevision || target.messageRevision !== input.expectedMessageRevision || target.outboxHash !== input.expectedOutboxHash) throw new Error("DELETION_CONTENT_CHANGED");
  assertHomeCaptured(db, target.id);
  const kind = db.prepare("SELECT lifecycle_kind FROM chats WHERE id=?").get(target.id) as Row;
  if (kind.lifecycle_kind === "external-readonly") {
    const confirmed = db.prepare("SELECT confirmed_json FROM cloud_chat_metadata_state WHERE chat_id=?").get(target.id) as Row | undefined;
    if (confirmed?.confirmed_json && !deletionOutbox(db, scope, target.id).some(row => row.kind !== "delete-chat")) return { chatId: target.id, archiveId: null };
    const generation = db.prepare("SELECT generation_id FROM chat_active_import_generations WHERE chat_id=?").get(target.id) as Row | undefined;
    if (!generation) throw new Error("READONLY_RECOVERY_GENERATION_UNAVAILABLE");
    const archiveId = `readonly_${hashChatContent([scope, marker, target.incarnationId, generation.generation_id]).slice(0, 48)}`;
    archiveDeletion(db, reader, target.id, target.incarnationId, deviceId, archiveId, now);
    return { chatId: target.id, archiveId };
  }
  const bounded = reader.getRecord(target.id, deviceId), record = bounded && readSavedNative(db, bounded);
  if (!record || record.context.kind !== "ordinary" || !record.messages.some(message => message.role === "user")) return { chatId: target.id, archiveId: null };
  const state = db.prepare("SELECT confirmed_json FROM cloud_chat_metadata_state WHERE chat_id=?").get(target.id) as Row | undefined;
  const head: CloudChatHead = state?.confirmed_json ? cloudChatHeadSchema.parse(JSON.parse(String(state.confirmed_json))) : {
    chat: portableFacts(record, 0), kind: "native", archivedAt: record.archivedAt ?? null,
    executorDeviceId: null, executionEpoch: 0, lastCommittedExecutorDeviceId: null, nativeSessionDeviceId: null, executionPreparation: null,
    headSeq: record.messages.at(-1)?.seq ?? 0, reservedThroughSeq: record.nextSeq - 1, openTurnId: null,
    homeSnapshotId: null, homeBytes: 0, homeState: "none", sourceDeviceId: deviceId, catalogRevision: 0, bodyRevision: 0 };
  const outbox = deletionOutbox(db, scope, target.id);
  if (state?.confirmed_json && !outbox.some(row => row.kind !== "delete-chat") && (record.messages.at(-1)?.seq ?? 0) <= head.headSeq) return { chatId: target.id, archiveId: null };
  const branch = archiveExecution(db, scope, { ...head, chat: portableFacts(record, head.chat.cloudRevision) }, record, outbox, now);
  const source = db.prepare(`SELECT s.source_id FROM chat_retained_sources s JOIN chat_retention_roots r ON r.source_id=s.source_id
    WHERE r.root_id=? AND s.kind='superseded-execution-archive'`).get(`settlement:${target.id}:execution:${branch.branchId}`) as Row;
  return { chatId: target.id, archiveId: String(source.source_id) };
}

export function archiveDeletedExecution(db: SqliteDatabase, reader: ChatRepositoryReader, scope: SyncScope,
  deviceId: string, head: CloudChatHead, now: number) {
  const row = db.prepare("SELECT lifecycle_kind FROM chats WHERE id=?").get(head.chat.id) as Row | undefined;
  // Readonly imports are retained by archiveDeletion as complete generations and original blob references.
  if (row?.lifecycle_kind === "external-readonly") return;
  const bounded = reader.getRecord(head.chat.id, deviceId), record = bounded && readSavedNative(db, bounded);
  if (record) archiveExecution(db, scope, head, record, deletionOutbox(db, scope, head.chat.id), now);
}

export function retainDeletedChat(db: SqliteDatabase, reader: ChatRepositoryReader, scope: SyncScope, deviceId: string,
  input: DeletionInput & { recovery?: { archiveId: string | null; childId: string | null } }, now: number) {
  const marker = input.tombstone, target = deletionTarget(db, scope, marker.entityId);
  if (marker.entityKind !== "chat" || !target || target.residence !== "native" || marker.incarnationId && marker.incarnationId !== target.incarnationId) throw new Error("NATIVE_DELETION_IDENTITY_CHANGED");
  if (target.revision !== input.expectedRevision || target.messageRevision !== input.expectedMessageRevision || target.outboxHash !== input.expectedOutboxHash) throw new Error("DELETION_CONTENT_CHANGED");
  if (input.recovery) {
    const prepared = prepareDeletedChat(db, reader, scope, deviceId, input, now);
    if (prepared.archiveId !== input.recovery.archiveId) throw new Error("CHAT_DELETION_ARCHIVE_CHANGED");
    if (prepared.archiveId) {
      const childId = `recovered_${hashChatContent([scope, { chatId: target.id, archiveId: prepared.archiveId }]).slice(0, 32)}`;
      const child = reader.getRecord(childId, deviceId);
      const readonly = prepared.archiveId.startsWith("readonly_");
      if (input.recovery.childId !== childId || !child || (readonly ? child.readOnlyReason !== "external-readonly" ||
        child.incarnationId !== hashChatContent([hashChatContent([scope, { chatId: target.id, archiveId: prepared.archiveId }]), "readonly-incarnation"]).slice(0, 32) :
        child.parentChatId !== target.id || child.parentIncarnationId !== target.incarnationId)) throw new Error("CHAT_CONVERGENCE_FORK_REQUIRED");
    }
  }
  const outbox = deletionOutbox(db, scope, marker.entityId), state = db.prepare("SELECT confirmed_json FROM cloud_chat_metadata_state WHERE chat_id=?").get(marker.entityId) as Row | undefined;
  const custody = digest(json([scope, marker, target.revision, target.messageRevision, target.outboxHash]));
  archiveDeletion(db, reader, marker.entityId, target.incarnationId, deviceId, custody, now);
  if (state?.confirmed_json) archiveDeletedExecution(db, reader, scope, deviceId,
    cloudChatHeadSchema.parse(JSON.parse(String(state.confirmed_json))), now);
  rememberDeletion(db, scope, marker, target.incarnationId, now);
  const local = reader.listMetadata(deviceId, target.id)[0];
  if (local && !state) captureMirrorMetadata(db, scope, portableFacts(local, 0));
  db.prepare("UPDATE chats SET cloud_state='synced',cloud_environment=?,cloud_user_id=?,cloud_revision=COALESCE(cloud_revision,0) WHERE id=?").run(scope.environment, scope.userId, target.id);
  db.prepare("UPDATE cloud_chat_metadata_state SET deleted=1,tail_operation_id=NULL WHERE chat_id=?").run(marker.entityId);
  for (const row of outbox) { db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(row.id)); releaseRoot(db, `outbox:${row.id}`); }
  return { chatId: marker.entityId };
}
