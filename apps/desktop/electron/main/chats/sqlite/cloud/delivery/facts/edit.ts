/**
 * [INPUT]: Depends on reviewed metadata/queue identities and the existing outbox and projection writers.
 * [OUTPUT]: Saves one reviewed title/archive edit and rejects new edits during pending deletion or classification.
 * [POS]: Local facts transaction; delayed requests retain their reviewed revision instead of silently rebasing.
 */
import { canonicalJson, type SyncScope } from "../../../../../../../shared/local-storage/contracts";
import type { ChatFactsEdit } from "../../../../../../../shared/cloud/facts";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import type { SqliteDatabase } from "../../../connection";
import type { ChatRecordWriter } from "../../../repository/writer";
import type { Row } from "../../../repository/codec";
import { enqueueSource } from "../../retention";
import { metadataState } from "../metadata-capture";
import { acceptMetadataHead } from "../metadata-confirm";
import { chatMetadataIntentSchema } from "../metadata-contracts";
import { readChatFacts } from "./state";
export function editChatFacts(db: SqliteDatabase, writer: ChatRecordWriter, scope: SyncScope, deviceId: string, input: ChatFactsEdit, now: number) {
  if (db.prepare("SELECT 1 FROM chat_classification_candidates WHERE chat_id=? AND state IN ('pending','confirmed') LIMIT 1").get(input.chatId)) throw new Error("CHAT_CLASSIFICATION_PENDING");
  if (db.prepare("SELECT 1 FROM cloud_outbox WHERE entity_id=? AND kind='delete-chat' LIMIT 1").get(input.chatId)) throw new Error("CHAT_DELETION_PENDING");
  const view = readChatFacts(db, scope, input.chatId), state = metadataState(db, scope, input.chatId), head = view.head;
  if (!head || head.chat.incarnationId !== input.incarnationId) throw new Error("CHAT_METADATA_IDENTITY_CHANGED");
  if (view.status === "deleted") throw new Error("CHAT_CLOUD_DELETED");
  if (view.status === "conflicted") throw new Error("CHAT_METADATA_CONFLICT_REQUIRES_RESOLUTION");
  if (view.queueHash !== input.expectedQueueHash || input.expectedRevision > head.chat.cloudRevision) throw new Error("CHAT_METADATA_REVIEW_CHANGED");
  const intent = chatMetadataIntentSchema.parse({ kind: "patch", operationId: hashChatContent(["chat-metadata", input.operationId]),
    chatId: input.chatId, incarnationId: input.incarnationId, changes: input.changes,
    basis: state.tail_operation_id ? { kind: "receipt", operationId: state.tail_operation_id } : { kind: "revision", revision: input.expectedRevision } });
  const row = db.prepare("SELECT core_revision FROM chats WHERE id=?").get(input.chatId) as Row;
  enqueueSource(db, { id: input.operationId, scope, chatId: input.chatId, entityKind: "chat", kind: "metadata-edit",
    revision: Number(row.core_revision) + 1, executionEpoch: null, payload: { chatId: input.chatId, changes: input.changes }, now });
  db.prepare("UPDATE cloud_outbox SET metadata_intent_json=?,metadata_status='queued' WHERE id=?").run(canonicalJson(intent), input.operationId);
  db.prepare("UPDATE cloud_chat_metadata_state SET tail_operation_id=? WHERE chat_id=?").run(intent.operationId, input.chatId);
  // Reuse the actual confirmed head; the visible head may include earlier pending changes.
  acceptMetadataHead(db, writer, scope, deviceId, JSON.parse(String(state.confirmed_json)), now);
  return readChatFacts(db, scope, input.chatId);
}
