/**
 * [INPUT]: Depends on the canonical Chat commit kernel, validators, and SQLite row writers
 * [OUTPUT]: Commits the Agent notice, user, options and session clearing under the original caller CAS.
 * [POS]: Worker-only atomic switch transition; the repository owns the transaction and receipt
 */

import type { SqliteDatabase } from "../connection";
import type { ChatRepositoryReader } from "../repository/reader";
import type { ChatRecordWriter } from "../repository/writer";
import type { SwitchAgentCommand } from "./command";
import { switchOperationId, switchRequestHash } from "./command";
import { agentSwitchIntentSchema } from "../../../../../shared/chat-agent/schema";
import type { AgentSwitchReceipt } from "../../../../../shared/chat-agent/contracts";
import { chatRecordSchema, messageSchema } from "../../chat-schema";
import { applyTurnCommit } from "../../chat-commit";

export function commitAgentSwitch(
  database: SqliteDatabase, reader: ChatRepositoryReader, writer: ChatRecordWriter,
  command: SwitchAgentCommand,
): AgentSwitchReceipt {
  const { requestHash, ...body } = command;
  if (requestHash !== switchRequestHash(body) || command.operationId !== switchOperationId(command.intentId)) {
    throw new Error("AGENT_SWITCH_COMMAND_CONFLICT");
  }
  const intent = agentSwitchIntentSchema.parse(command.intent);
  const current = reader.getRecord(command.chatId, command.deviceId);
  if (!current || current.incarnationId !== command.incarnationId) throw new Error("INCARNATION_MISMATCH");
  if (current.agent !== intent.expectedAgent || current.agentRevision !== intent.expectedAgentRevision ||
      current.chatRecordRevision !== command.expectedAggregateRevision ||
      command.expectedAggregateRevision !== intent.expectedChatRecordRevision + 1) throw new Error("AGENT_REVISION_STALE");
  if (current.readOnlyReason || current.context.kind !== "ordinary" || current.archivedAt) {
    throw new Error("AGENT_SWITCH_NOT_WRITABLE");
  }
  if (command.targetOptions.backend !== intent.targetAgent ||
      (current.executionKind === "managed-worktree" && command.targetOptions.permissionMode === "full-access")) {
    throw new Error("AGENT_SWITCH_OPTIONS_CONFLICT");
  }
  const notice = messageSchema.parse(command.notice);
  const user = messageSchema.parse(command.userMessage);
  if (notice.role !== "notice" || notice.notice.kind !== "agent-switched" || user.role !== "user" ||
      notice.notice.from !== current.agent || notice.notice.to !== intent.targetAgent ||
      notice.notice.agentRevision !== current.agentRevision + 1 ||
      notice.seq + 1 !== user.seq || user.seq + 1 !== command.assistantSeq ||
      current.nextSeq <= command.assistantSeq ||
      current.messages.some(message => message.seq >= notice.seq)) {
    throw new Error("AGENT_SWITCH_SEQUENCE_CONFLICT");
  }
  const switched = {
    ...current, agent: intent.targetAgent, agentRevision: current.agentRevision + 1,
    options: command.targetOptions, session: null,
  };
  const withNotice = applyTurnCommit(switched, { message: notice }).record;
  const record = chatRecordSchema.parse({
    ...applyTurnCommit(withNotice, { message: user }).record,
    chatRecordRevision: current.chatRecordRevision + 1,
    chatMessageRevision: current.chatMessageRevision + 1,
  });
  writer.writeCore(record, record.importOrigin ? "external-managed" : "native");
  writer.writeLocalFacts(record, command.deviceId);
  writer.writeMessages(record);
  writer.writeSubagents(record);
  writer.writeBranches(record);
  writer.writeSearchDocuments(record);
  const generation = database.prepare("SELECT generation_id FROM chat_active_import_generations WHERE chat_id = ?")
    .get(record.id) as { generation_id: string } | undefined;
  return {
    intentId: command.intentId, submissionHash: command.submissionHash, chatId: record.id,
    agentRevision: record.agentRevision, chatRecordRevision: record.chatRecordRevision,
    nativeMessageRevision: record.chatMessageRevision, targetOptions: record.options,
    noticeMessageId: notice.id, userMessageId: user.id, assistantMessageId: command.assistantMessageId,
    noticeSeq: notice.seq, userSeq: user.seq, assistantSeq: command.assistantSeq,
    historyView: { incarnationId: record.incarnationId, nativeMessageRevision: record.chatMessageRevision,
      activeGenerationId: generation?.generation_id ?? null },
  };
}
