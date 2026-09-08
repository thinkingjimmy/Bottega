/**
 * [INPUT]: Depends on canonical metadata, the fact writer, and the stable switch reservation command
 * [OUTPUT]: Reserves three immutable sequence positions while preserving all Chat business facts
 * [POS]: Worker reservation kernel; the repository records its result in the existing operation receipt table
 */
import type { ChatRepositoryReader } from "../repository/reader";
import type { ChatRecordWriter } from "../repository/writer";
import { chatFactsSchema } from "../../chat-schema";
import { agentSwitchIntentSchema } from "../../../../../shared/chat-agent/schema";
import { switchRequestHash, switchSequenceOperationId, type ReserveSwitchSequencesCommand, type SwitchSequenceReservation } from "./command";

export function reserveSwitchSequences(reader: ChatRepositoryReader, writer: ChatRecordWriter,
  command: ReserveSwitchSequencesCommand): SwitchSequenceReservation {
  const { requestHash, ...body } = command;
  if (requestHash !== switchRequestHash(body) || command.operationId !== switchSequenceOperationId(command.intentId)) throw new Error("AGENT_SWITCH_COMMAND_CONFLICT");
  const intent = agentSwitchIntentSchema.parse(command.intent);
  const current = reader.listMetadata(command.deviceId, command.chatId)[0];
  if (!current || current.incarnationId !== command.incarnationId) throw new Error("INCARNATION_MISMATCH");
  if (current.agent !== intent.expectedAgent || current.agentRevision !== intent.expectedAgentRevision ||
    current.chatRecordRevision !== intent.expectedChatRecordRevision) throw new Error("AGENT_REVISION_STALE");
  if (current.readOnlyReason || current.context.kind !== "ordinary" || current.archivedAt) throw new Error("AGENT_SWITCH_NOT_WRITABLE");
  const { preview: _preview, ...facts } = current;
  const reserved = chatFactsSchema.parse({ ...facts, nextSeq: facts.nextSeq + 3, chatRecordRevision: facts.chatRecordRevision + 1 });
  writer.writeCore(reserved, current.importOrigin ? "external-managed" : "native");
  writer.writeLocalFacts(reserved, command.deviceId);
  return { chatId: current.id, chatRecordRevision: reserved.chatRecordRevision,
    noticeSeq: current.nextSeq, userSeq: current.nextSeq + 1, assistantSeq: current.nextSeq + 2 };
}
