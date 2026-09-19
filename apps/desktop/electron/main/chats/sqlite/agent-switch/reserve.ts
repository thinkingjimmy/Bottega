/**
 * [INPUT]: Depends on canonical metadata, the fact writer, and the stable switch reservation command
 * [OUTPUT]: Allocates receipt-backed two/three/four-slot reservations from confirmed executor and committed-device state.
 * [POS]: Worker reservation kernel; the repository records its result in the existing operation receipt table
 */
import { allocateTurnSequences } from "../../../../../shared/chat-agent/sequences";
import type { ChatRepositoryReader } from "../repository/reader";
import type { ChatRecordWriter } from "../repository/writer";
import { chatFactsSchema } from "../../chat-schema";
import type { SqliteDatabase } from "../connection";
import { assertLocalExecutor } from "../cloud/execution/state";
import { agentSwitchIntentSchema } from "../../../../../shared/chat-agent/schema";
import { switchRequestHash, switchSequenceOperationId, turnSequenceOperationId, type ReserveTurnSequencesCommand, type ReserveSwitchSequencesCommand, type SwitchSequenceReservation } from "./command";

export function reserveSwitchSequences(db: SqliteDatabase, reader: ChatRepositoryReader, writer: ChatRecordWriter,
  command: ReserveSwitchSequencesCommand | ReserveTurnSequencesCommand): SwitchSequenceReservation {
  const { requestHash, ...body } = command;
  if (requestHash !== switchRequestHash(body) || command.operationId !== (command.kind === "reserve-switch-sequences" ? switchSequenceOperationId : turnSequenceOperationId)(command.intentId)) throw new Error("AGENT_SWITCH_COMMAND_CONFLICT");
  const intent = command.kind === "reserve-switch-sequences" ? agentSwitchIntentSchema.parse(command.intent) : null;
  const current = reader.listMetadata(command.deviceId, command.chatId)[0];
  if (!current || current.incarnationId !== command.incarnationId) throw new Error("INCARNATION_MISMATCH");
  if (intent && (current.agent !== intent.expectedAgent || current.agentRevision !== intent.expectedAgentRevision ||
    current.chatRecordRevision !== intent.expectedChatRecordRevision)) throw new Error("AGENT_REVISION_STALE");
  if (current.readOnlyReason || (intent && current.context.kind !== "ordinary") || current.archivedAt) throw new Error("AGENT_SWITCH_NOT_WRITABLE");
  const execution = assertLocalExecutor(db, command.chatId, command.deviceId);
  const executorNotice = execution ? execution.lastCommittedDeviceId !== null && execution.lastCommittedDeviceId !== command.deviceId : command.executorNotice;
  const { preview: _preview, ...facts } = current;
  const sequences = allocateTurnSequences(current.nextSeq, { agent: Boolean(intent) || command.kind === "reserve-turn-sequences" && Boolean(command.contextNotice), executor: executorNotice });
  const reserved = chatFactsSchema.parse({ ...facts, nextSeq: sequences.assistantSeq + 1, chatRecordRevision: facts.chatRecordRevision + 1 });
  writer.writeCore(reserved, current.importOrigin ? "external-managed" : "native");
  writer.writeLocalFacts(reserved, command.deviceId);
  return { chatId: current.id, chatRecordRevision: reserved.chatRecordRevision,
    ...sequences, ...(execution ? { execution: { deviceId: command.deviceId, executionEpoch: execution.head.executionEpoch,
      lastCommittedDeviceId: execution.lastCommittedDeviceId, ...(execution.head.lastExecutorTransition?.executionEpoch === execution.head.executionEpoch && execution.head.lastExecutorTransition.staleSnapshot ? { staleSnapshot: true } : {}) } } : {}) };
}
