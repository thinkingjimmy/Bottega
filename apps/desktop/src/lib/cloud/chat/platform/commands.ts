/**
 * [INPUT]: Depends on the existing manual coordinator and native Agent IPC clients and their frozen input/result types.
 * [OUTPUT]: Provides the native CommandSink without rewriting submissions, receipts, request identities or interaction decisions.
 * [POS]: Canonical desktop execution adapter; main remains responsible for admission, epoch checks and local authority.
 */
import type { CommandSink } from "@ai-chat/chat-ui/contracts";
import { cancelManualTurn, submitManualTurn } from "../../../sections-client";
import { cancelAgentRequest, respondAgentApproval, respondAgentUserInput, steerAgent } from "../../../agent-client";
import type { AgentApprovalDecision, AgentUserInputResponse } from "../../../../../shared/agent-ipc";
type Response = { kind: "approval"; requestId: string; interactionId: string; decision: AgentApprovalDecision } |
  { kind: "input"; requestId: string; interactionId: string; answers: AgentUserInputResponse["answers"] };
const actions = { start: submitManualTurn, steer: steerAgent,
  cancel: (kind: "manual" | "agent", requestId: string) => kind === "manual" ? cancelManualTurn(requestId) : cancelAgentRequest(requestId),
  respond: (input: Response) => input.kind === "approval" ? respondAgentApproval(input.requestId, input.interactionId, input.decision) :
    respondAgentUserInput(input.requestId, input.interactionId, input.answers) };
export const nativeChatCommands: CommandSink<typeof actions> = { ...actions,
  available: chatId => Boolean(chatId && window.sections && window.agent) };
