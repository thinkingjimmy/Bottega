/**
 * [INPUT]: Depends on the original scoped outbox, frozen local sources and atomic settlement custody.
 * [OUTPUT]: Proves original successor coverage, fences receipt installation and retires acknowledged evidence without losing divergent results.
 * [POS]: SQLite settlement leaf, executed in the same transaction as canonical content and its cursor.
 */
import type { CloudTurnReceipt } from "@ai-chat/cloud-protocol/chats/content/completion";
import { projectPortableMessage } from "@ai-chat/cloud-protocol/chats/content/projection";
import { canonicalJson, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { messageSchema, subagentsSchema } from "../../../chat-schema";
import type { ChatMessage } from "../../../../../../shared/chats-ipc";
import type { SqliteDatabase } from "../../connection";
import { digest, type Row } from "../../repository/codec";
import { readRetainedSource } from "../inventory/source";
import { releaseRoot } from "../retention";
import { archiveSupersededTail } from "./custody";
import { localTurnAdmissionSchema } from "../delivery/turns/model";
import { readMetadataState } from "../delivery/metadata-confirm";
export function readChatOutbox(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  const result = db.prepare(`SELECT * FROM cloud_outbox WHERE environment=? AND user_id=?
    AND json_extract(payload_json,'$.chatId')=? ORDER BY id LIMIT 10001`).all(scope.environment, scope.userId, chatId) as Row[];
  if (result.length > 10000) throw new Error("TURN_OUTBOX_BUDGET"); return result;
}
export function turnOutboxDigest(db: SqliteDatabase, scope: SyncScope, chatId: string) {
  return digest(canonicalJson(readChatOutbox(db, scope, chatId).map(row => [row.id, row.payload_digest, row.metadata_status])));
}
export function replacementSuccessorThrough(db: SqliteDatabase, scope: SyncScope, receipt: CloudTurnReceipt, deviceId: string, messages: ChatMessage[]) {
  let through = receipt.assistantSeq;
  if (receipt.sealReason !== "replaced" || receipt.executorDeviceId !== deviceId) return through;
  const head = readMetadataState(db, scope, receipt.chatId).head;
  if (!head || head.executorDeviceId !== deviceId || head.executionEpoch !== receipt.executionEpoch || head.chat.incarnationId !== receipt.incarnationId) return through;
  const bySeq = new Map(messages.map(message => [message.seq, message]));
  const rows = readChatOutbox(db, scope, receipt.chatId).filter(row => row.kind === "live-turn").sort((a, b) => Number(a.seq_or_revision) - Number(b.seq_or_revision));
  for (const row of rows) {
    const manifest = JSON.parse(String(row.payload_json)), admission = localTurnAdmissionSchema.parse(readRetainedSource(db, manifest.sources[0]));
    if (admission.sequences.assistantSeq <= through) continue;
    const first = admission.sequences.executorNoticeSeq ?? admission.sequences.noticeSeq ?? admission.sequences.userSeq;
    if (first !== through + 1 || admission.chat.id !== receipt.chatId || admission.chat.incarnationId !== receipt.incarnationId ||
        admission.executorDeviceId !== deviceId || admission.executionEpoch !== receipt.executionEpoch || row.execution_epoch !== receipt.executionEpoch) break;
    if ([...admission.notices, admission.user].some(message => canonicalJson(bySeq.get(message.seq) ?? null) !== canonicalJson(message))) break;
    const assistant = bySeq.get(admission.sequences.assistantSeq);
    if (assistant && (assistant.role !== "assistant" || assistant.id !== admission.assistantMessageId || assistant.turnId !== admission.turnId || assistant.backend !== admission.options.backend)) break;
    through = admission.sequences.assistantSeq;
  }
  return through;
}
export function acknowledgeTurnOutbox(db: SqliteDatabase, scope: SyncScope, receipt: CloudTurnReceipt, message: ChatMessage | null, canonicalAgents: unknown, now: number) {
  if (receipt.settlementState !== "settled") return;
  const chat = db.prepare("SELECT conversation_kind,portable_app_id,portable_project_id FROM chats WHERE id=?").get(receipt.chatId) as Row;
  for (const row of readChatOutbox(db, scope, receipt.chatId)) {
    if (row.kind === "initialize" || ["queued", "blocked", "conflicted"].includes(String(row.metadata_status))) continue;
    const manifest = JSON.parse(String(row.payload_json));
    const source = readRetainedSource(db, manifest.sources[0]) as { message?: ChatMessage; userMessage?: ChatMessage; resultMessage?: ChatMessage | null;
      resultKind?: string; throughSeq?: number; subagents?: unknown };
    const related = row.entity_kind === "turn" ? row.entity_id === receipt.turnId :
      source.message?.seq === receipt.userSeq && source.message.id === receipt.userMessageId ||
      source.message?.seq === receipt.assistantSeq && source.message.id === receipt.assistantMessageId ||
      row.kind === "commit-turn" && source.throughSeq === receipt.assistantSeq;
    if (!related) continue;
    const confirmedAgents = subagentsSchema.parse(canonicalAgents ?? {});
    const differentAgents = Object.entries(subagentsSchema.parse(source.subagents ?? {})).some(([id, agent]) => {
      const portable = { ...agent, parts: agent.parts.map(part => { const { mediaSource: _local, ...rest } = part as unknown as Record<string, unknown>; return rest; }) };
      return canonicalJson(portable) !== canonicalJson(confirmedAgents[id] ?? null);
    });
    const local = source.resultMessage ?? (source.message?.role === "assistant" ? source.message : differentAgents ? message : null);
    if (differentAgents || local && canonicalJson(projectPortableMessage(messageSchema.parse(local))) !== canonicalJson(message)) {
      const user = source.userMessage ?? (db.prepare("SELECT payload_json FROM chat_messages WHERE chat_id=? AND message_id=?")
        .get(receipt.chatId, receipt.userMessageId) as Row | undefined)?.payload_json;
      archiveSupersededTail(db, scope, receipt, {
        classification: { conversationKind: chat.conversation_kind, appId: chat.portable_app_id, projectId: chat.portable_project_id },
        messages: [...(user ? [typeof user === "string" ? JSON.parse(user) : user] : []), ...(local ? [local] : [])], subagents: source.subagents ?? {},
      }, now);
    }
    db.prepare("DELETE FROM cloud_outbox WHERE id=?").run(String(row.id)); releaseRoot(db, `outbox:${row.id}`);
  }
}
