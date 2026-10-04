/**
 * [INPUT]: Depends on immutable outbox intents, original cloud receipts and the sole Chat metadata/search writer.
 * [OUTPUT]: Installs confirmed heads (title/archive/sortKey, the last without touching updated_at), defers visible changes during classification CAS and freezes imported sources on managed takeover.
 * [POS]: Receipt reconciliation beneath ChatRepository; it never creates local execution authority or a second queue.
 */
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { cloudChatHeadSchema, type CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import { hashChatMetadataOperation, type ChatMetadataReceipt } from "@ai-chat/cloud-protocol/chats/metadata";
import type { SqliteDatabase } from "../../connection";
import type { ChatRecordWriter } from "../../repository/writer";
import type { Row } from "../../repository/codec";
import type { ChatDeliveryCheckpoint } from "./contracts";
import { metadataState } from "./metadata-capture";
import { chatMetadataIntentSchema, chatMetadataValuesSchema } from "./metadata-contracts";
import { freezeClaimedImport } from "../imported/freeze";

export function validateMetadataOperation(item: Row, checkpoint: Extract<ChatDeliveryCheckpoint, { kind: "metadata-operation" }>) {
  if (!item.metadata_intent_json) throw new Error("CHAT_METADATA_INTENT_REQUIRED");
  const intent = chatMetadataIntentSchema.parse(JSON.parse(String(item.metadata_intent_json))), operation = checkpoint.operation;
  let command;
  if (intent.kind === "create") {
    if (checkpoint.basis) throw new Error("CHAT_CREATION_BASELINE_INVALID");
    command = { kind: "create" as const, chat: intent.chat, lifecycleKind: intent.lifecycleKind, archivedAt: intent.archivedAt };
  } else {
    let revision: number;
    if (intent.basis.kind === "revision") {
      if (checkpoint.basis) throw new Error("CHAT_METADATA_BASELINE_CHANGED");
      revision = intent.basis.revision;
    } else {
      const receipt = checkpoint.basis;
      if (!receipt || receipt.operationId !== intent.basis.operationId || !["applied", "converged"].includes(receipt.status) ||
        receipt.chatId !== intent.chatId || receipt.head?.chat.incarnationId !== intent.incarnationId) throw new Error("CHAT_METADATA_PREDECESSOR_UNCONFIRMED");
      revision = receipt.head.chat.cloudRevision;
    }
    command = { kind: "patch" as const, incarnationId: intent.incarnationId, expectedRevision: revision, changes: intent.changes };
  }
  if (operation.operationId !== intent.operationId || operation.chatId !== (intent.kind === "create" ? intent.chat.id : intent.chatId) ||
    canonicalJson(operation.command) !== canonicalJson(command) || hashChatMetadataOperation(operation) !== operation.payloadHash) throw new Error("CHAT_METADATA_SEALED_IDENTITY_CHANGED");
}
function visibleMetadata(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const state = metadataState(db, scope, chatId), head = state.confirmed_json ? cloudChatHeadSchema.parse(JSON.parse(String(state.confirmed_json))) : null;
  let values = head ? { title: head.chat.title, archivedAt: head.archivedAt, sortKey: head.chat.sortKey ?? null }
    : chatMetadataValuesSchema.parse(JSON.parse(String(state.observed_json)));
  const pending = db.prepare(`SELECT metadata_intent_json FROM cloud_outbox WHERE environment=? AND user_id=?
    AND json_extract(payload_json,'$.chatId')=? AND metadata_status='queued' ORDER BY seq_or_revision,created_at,id`)
    .all(scope.environment, scope.userId, chatId) as Row[];
  for (const row of pending) {
    const intent = chatMetadataIntentSchema.parse(JSON.parse(String(row.metadata_intent_json)));
    if (intent.kind === "create") values = { title: intent.chat.title, archivedAt: intent.archivedAt, sortKey: intent.chat.sortKey ?? null };
    else values = { ...values, ...intent.changes };
  }
  return { state, head, values };
}
function projectMetadata(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, chatId: string, deviceId: string, now: number) {
  if (db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(chatId)) return;
  const { values, head } = visibleMetadata(db, scope, chatId);
  const row = db.prepare(`SELECT c.title,c.archived_at,c.sort_key,c.cloud_state,c.updated_at,m.archived_at local_archived_at
    FROM chats c LEFT JOIN chat_local_memberships m ON m.chat_id=c.id AND m.device_id=? WHERE c.id=?`).get(deviceId, chatId) as Row;
  const oldArchive = row.cloud_state === "mirror" ? row.archived_at : row.local_archived_at;
  if ((row.sort_key ?? null) !== values.sortKey) {
    // A position is not activity: it lands without touching updated_at, unlike title/archive below.
    db.prepare("UPDATE chats SET sort_key=?,core_revision=core_revision+1 WHERE id=?").run(values.sortKey, chatId);
    db.prepare("UPDATE chat_local_aggregate_state SET aggregate_revision=aggregate_revision+1 WHERE chat_id=? AND device_id=?").run(chatId, deviceId);
  }
  if (row.title !== values.title || oldArchive !== values.archivedAt) {
    const updatedAt = Math.max(Number(row.updated_at) + 1, now);
    db.prepare("UPDATE chats SET title=?,title_source='user',archived_at=?,updated_at=?,core_revision=core_revision+1 WHERE id=?")
      .run(values.title, values.archivedAt, updatedAt, chatId);
    db.prepare("UPDATE chat_local_aggregate_state SET aggregate_revision=aggregate_revision+1 WHERE chat_id=? AND device_id=?").run(chatId, deviceId);
    db.prepare(`UPDATE chat_local_memberships SET visibility_state=?,archived_at=?,membership_revision=membership_revision+1,updated_at=?
      WHERE chat_id=? AND device_id=?`).run(values.archivedAt === null ? "visible" : "archived", values.archivedAt, updatedAt, chatId, deviceId);
    if (row.title !== values.title) {
      writer.writeTitleSearchDocument(chatId, values.title);
      const job = db.prepare("SELECT job_json FROM chat_title_jobs WHERE chat_id=? AND device_id=?").get(chatId, deviceId) as Row | undefined;
      if (job) {
        const previous = JSON.parse(String(job.job_json)) as { jobId?: string };
        const value = previous.jobId ? { state: "superseded", jobId: previous.jobId, supersededAt: updatedAt } : { state: "none" };
        db.prepare("UPDATE chat_title_jobs SET state=?,job_json=?,updated_at=? WHERE chat_id=? AND device_id=?")
          .run(value.state, canonicalJson(value), updatedAt, chatId, deviceId);
      }
    }
  }
  if (head && row.cloud_state === "mirror") {
    const { sortKey: _confirmedSortKey, ...portable } = head.chat;
    db.prepare("UPDATE cloud_chat_mirrors SET portable_json=? WHERE chat_id=?")
      .run(canonicalJson({ ...portable, title: values.title, ...(values.sortKey === null ? {} : { sortKey: values.sortKey }) }), chatId);
  }
  db.prepare("UPDATE cloud_chat_metadata_state SET observed_json=? WHERE chat_id=?").run(canonicalJson(values), chatId);
}
function storeHead(db: SqliteDatabase, scope: SyncScope, head: CloudChatHead, now: number) {
  const state = metadataState(db, scope, head.chat.id), previous = state.confirmed_json ? cloudChatHeadSchema.parse(JSON.parse(String(state.confirmed_json))) : null;
  const chat = db.prepare("SELECT incarnation_id,cloud_environment,cloud_user_id FROM chats WHERE id=?").get(head.chat.id) as Row | undefined;
  if (!chat || chat.cloud_environment !== scope.environment || chat.cloud_user_id !== scope.userId || chat.incarnation_id !== head.chat.incarnationId) throw new Error("CHAT_METADATA_IDENTITY_CHANGED");
  if (previous && head.chat.cloudRevision < previous.chat.cloudRevision) return;
  if (previous?.chat.cloudRevision === head.chat.cloudRevision) {
    if (previous.chat.title !== head.chat.title || previous.archivedAt !== head.archivedAt ||
      (previous.chat.sortKey ?? null) !== (head.chat.sortKey ?? null)) throw new Error("CHAT_METADATA_REVISION_CHANGED");
    if (head.catalogRevision < previous.catalogRevision) return;
  }
  db.prepare("UPDATE cloud_chat_metadata_state SET confirmed_json=? WHERE chat_id=?").run(canonicalJson(head), head.chat.id);
  db.prepare("UPDATE chats SET cloud_revision=?,cloud_owner_device_id=? WHERE id=?")
    .run(head.chat.cloudRevision, head.ownerDeviceId, head.chat.id);
  db.prepare("UPDATE chats SET parent_chat_id=?,parent_incarnation_id=?,parent_message_id=?,inherited_through_seq=? WHERE id=?")
    .run(head.chat.parentChatId ?? null, head.chat.parentIncarnationId ?? null, head.chat.parentMessageId ?? null, head.chat.inheritedThroughSeq ?? null, head.chat.id);
  freezeClaimedImport(db, scope, head, now);
}
export function acceptMetadataHead(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, deviceId: string, head: CloudChatHead, now: number) {
  if (db.prepare("SELECT 1 FROM cloud_tombstones WHERE environment=? AND user_id=? AND chat_id=?").get(scope.environment, scope.userId, head.chat.id)) return { chatId: head.chat.id };
  storeHead(db, scope, head, now); projectMetadata(db, writer, scope, head.chat.id, deviceId, now); return { chatId: head.chat.id };
}
export function confirmMetadataReceipt(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, deviceId: string, item: Row,
  receipt: ChatMetadataReceipt, now: number) {
  const intent = chatMetadataIntentSchema.parse(JSON.parse(String(item.metadata_intent_json)));
  if (receipt.operationId !== intent.operationId || receipt.sourceDeviceId !== deviceId) throw new Error("CHAT_METADATA_RECEIPT_CHANGED");
  db.prepare("UPDATE cloud_outbox SET metadata_status=? WHERE id=?").run(receipt.status, String(item.id));
  const failed = receipt.status === "conflicted" || receipt.status === "deleted";
  if (failed) {
    db.prepare(`UPDATE cloud_chat_metadata_state SET conflicted=1,deleted=? WHERE chat_id=?`).run(receipt.status === "deleted" ? 1 : 0, receipt.chatId);
    db.prepare(`UPDATE cloud_outbox SET metadata_status='blocked' WHERE environment=? AND user_id=?
      AND json_extract(payload_json,'$.chatId')=? AND metadata_status='queued'`).run(scope.environment, scope.userId, receipt.chatId);
  }
  db.prepare("UPDATE cloud_chat_metadata_state SET tail_operation_id=NULL WHERE chat_id=? AND tail_operation_id=?").run(receipt.chatId, receipt.operationId);
  // A colliding create belongs to another source. Keep this local Chat and all its content intact.
  if (intent.kind === "create" && failed) return;
  if (receipt.head) storeHead(db, scope, receipt.head, now);
  projectMetadata(db, writer, scope, receipt.chatId, deviceId, now);
}
export function readMetadataState(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const state = metadataState(db, scope, chatId);
  const counts = db.prepare(`SELECT SUM(metadata_status IN ('queued','blocked')) pending,SUM(metadata_status='conflicted') conflicts
    FROM cloud_outbox WHERE environment=? AND user_id=? AND json_extract(payload_json,'$.chatId')=?`)
    .get(scope.environment, scope.userId, chatId) as Row;
  return { head: state.confirmed_json ? JSON.parse(String(state.confirmed_json)) : null, conflicted: Boolean(state.conflicted), deleted: Boolean(state.deleted),
    pendingCount: Number(counts.pending ?? 0), conflictCount: Number(counts.conflicts ?? 0) };
}
