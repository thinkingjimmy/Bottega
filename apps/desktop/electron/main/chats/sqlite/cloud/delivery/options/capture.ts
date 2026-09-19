/**
 * [INPUT]: Depends on canonical local facts, the preceding observed options and the existing metadata cursor.
 * [OUTPUT]: Freezes same-Agent option changes alongside the original business outbox transaction.
 * [POS]: Execution-facts producer; sessions, grants and reserved sequences create no portable option changes.
 */
import { canonicalJson, type SyncScope } from "../../../../../../../shared/local-storage/contracts";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { chatOptionsOperationSchema, hashChatOptionsOperation } from "@ai-chat/cloud-protocol/chats/options-sync";
import type { ChatFacts } from "../../../../chat-summary";
import type { SqliteDatabase } from "../../../connection";
import type { Row } from "../../../repository/codec";
import { metadataState } from "../metadata-capture";
export function observeExecutionOptions(db: SqliteDatabase, scope: SyncScope, chatId: string, facts: Pick<ChatFacts, "options" | "agentRevision">) {
  db.prepare("UPDATE cloud_chat_metadata_state SET execution_observed_json=? WHERE chat_id=? AND environment=? AND user_id=?")
    .run(canonicalJson({ options: facts.options, agentRevision: facts.agentRevision }), chatId, scope.environment, scope.userId);
}
export function captureOptionsEdit(db: SqliteDatabase, scope: SyncScope, outboxId: string, kind: string, facts: ChatFacts, epoch: number) {
  const state = metadataState(db, scope, facts.id);
  const previous = state.execution_observed_json ? JSON.parse(String(state.execution_observed_json)) :
    state.confirmed_json ? JSON.parse(String(state.confirmed_json)).chat : null;
  observeExecutionOptions(db, scope, facts.id, facts);
  if (kind !== "update-chat-facts" || !previous || canonicalJson(previous.options) === canonicalJson(facts.options)) return null;
  const latest = db.prepare("SELECT MAX(seq) seq FROM chat_messages WHERE chat_id=? AND role='user' AND COALESCE(json_extract(payload_json,'$.segment'),'native')<>'imported'").get(facts.id) as Row;
  const operation = chatOptionsOperationSchema.parse({ operationId: hashChatContent(["chat-options", outboxId]),
    chatId: facts.id, incarnationId: facts.incarnationId, executionEpoch: epoch, agentRevision: facts.agentRevision,
    afterUserSeq: Number(latest.seq ?? 0), previous: previous.options, options: facts.options, payloadHash: "0".repeat(64) });
  return { ...operation, payloadHash: hashChatOptionsOperation(operation) };
}
