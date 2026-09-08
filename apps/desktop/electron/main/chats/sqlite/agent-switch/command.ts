/**
 * [INPUT]: Depends on shared Chat messages, options, and explicit switch contracts
 * [OUTPUT]: Defines frozen switch and sequence-reservation commands with stable operation/hash identities
 * [POS]: Main-to-worker switch command; only prepared material enters durable custody
 */

import { createHash } from "node:crypto";
import type { AgentTurnOptions } from "../../../../../shared/agent-ipc";
import type { NoticeChatMessage, UserChatMessage } from "../../../../../shared/chats-ipc";
import type { AgentSwitchIntent } from "../../../../../shared/chat-agent/contracts";

export type SwitchAgentCommand = Readonly<{
  kind: "switch-agent";
  operationId: string;
  requestHash: string;
  chatId: string;
  deviceId: string;
  incarnationId: string;
  intentId: string;
  submissionHash: string;
  intent: AgentSwitchIntent;
  expectedAggregateRevision: number;
  targetOptions: AgentTurnOptions;
  notice: NoticeChatMessage;
  userMessage: UserChatMessage;
  assistantMessageId: string;
  assistantSeq: number;
}>;
export const switchOperationId = (intentId: string) => `agent-switch-v1:${intentId}`;
export type SwitchSequenceInput = Pick<SwitchAgentCommand, "chatId" | "incarnationId" | "intentId" | "submissionHash" | "intent">;
export type ReserveSwitchSequencesCommand = SwitchSequenceInput & {
  kind: "reserve-switch-sequences"; deviceId: string; operationId: string; requestHash: string;
};
export type SwitchSequenceReservation = {
  chatId: string; chatRecordRevision: number; noticeSeq: number; userSeq: number; assistantSeq: number;
};
export const switchSequenceOperationId = (intentId: string) => `agent-switch-sequences-v1:${intentId}`;
export function switchRequestHash(command: Omit<SwitchAgentCommand, "requestHash"> | Omit<ReserveSwitchSequencesCommand, "requestHash">) {
  return createHash("sha256").update(JSON.stringify(command)).digest("hex");
}
