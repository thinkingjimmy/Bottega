/**
 * [INPUT]: Depends on retained metadata candidates, a freshly read cloud head and the sole outbox/metadata writer.
 * [OUTPUT]: Discards candidates or captures an explicit new operation against the reviewed head without rewriting old payloads.
 * [POS]: Local conflict resolution transaction; deleted entities and colliding initial identities cannot be revived.
 */
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { SqliteDatabase } from "../../connection";
import type { ChatRecordWriter } from "../../repository/writer";
import type { Row } from "../../repository/codec";
import { enqueueSource } from "../retention";
import { metadataState } from "./metadata-capture";
import { acceptMetadataHead } from "./metadata-confirm";
import { chatMetadataIntentSchema } from "./metadata-contracts";
import { readChatFacts } from "./facts/state";
export function resolveMetadata(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, deviceId: string,
  operationId: string, decision: "retry" | "discard", head: CloudChatHead, expectedQueueHash: string, now: number) {
  const state = metadataState(db, scope, head.chat.id);
  if (readChatFacts(db, scope, head.chat.id).queueHash !== expectedQueueHash) throw new Error("CHAT_METADATA_CANDIDATE_CHANGED");
  if (!state.conflicted) throw new Error("CHAT_METADATA_CONFLICT_ALREADY_RESOLVED");
  if (state.deleted) throw new Error("CHAT_CLOUD_DELETED");
  const pending = db.prepare(`SELECT metadata_intent_json FROM cloud_outbox WHERE environment=? AND user_id=?
    AND json_extract(payload_json,'$.chatId')=? AND metadata_status IN ('conflicted','blocked') ORDER BY seq_or_revision,created_at,id`)
    .all(scope.environment, scope.userId, head.chat.id) as Row[];
  const changes: { title?: string | null; archivedAt?: number | null } = {};
  for (const row of pending) {
    const intent = chatMetadataIntentSchema.parse(JSON.parse(String(row.metadata_intent_json)));
    if (intent.kind === "create") throw new Error("CHAT_INITIAL_CONFLICT_REQUIRES_NEW_IDENTITY");
    Object.assign(changes, intent.changes);
  }
  // The supplied head is identity checked by the same installation path before any candidate is discarded.
  acceptMetadataHead(db, writer, scope, deviceId, head, now);
  db.prepare(`UPDATE cloud_outbox SET metadata_status='discarded' WHERE environment=? AND user_id=?
    AND json_extract(payload_json,'$.chatId')=? AND metadata_status IN ('conflicted','blocked')`).run(scope.environment, scope.userId, head.chat.id);
  db.prepare("UPDATE cloud_chat_metadata_state SET conflicted=0,tail_operation_id=NULL WHERE chat_id=?").run(head.chat.id);
  let queued: string | null = null;
  if (decision === "retry" && Object.keys(changes).length > 0) {
    const intent = chatMetadataIntentSchema.parse({ kind: "patch", operationId: hashChatContent(["chat-metadata", operationId]),
      chatId: head.chat.id, incarnationId: head.chat.incarnationId, changes, basis: { kind: "revision", revision: head.chat.cloudRevision } });
    const row = db.prepare("SELECT core_revision FROM chats WHERE id=?").get(head.chat.id) as Row;
    enqueueSource(db, { id: operationId, scope, chatId: head.chat.id, entityKind: "chat", kind: "metadata-recovery",
      revision: Number(row.core_revision) + 1, executionEpoch: null, payload: { chatId: head.chat.id, changes }, now });
    db.prepare("UPDATE cloud_outbox SET metadata_intent_json=?,metadata_status='queued' WHERE id=?").run(canonicalJson(intent), operationId);
    db.prepare("UPDATE cloud_chat_metadata_state SET tail_operation_id=? WHERE chat_id=?").run(intent.operationId, head.chat.id);
    queued = operationId;
  }
  acceptMetadataHead(db, writer, scope, deviceId, head, now);
  return { chatId: head.chat.id, queued };
}
