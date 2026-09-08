/**
 * [INPUT]: Depends on the ChatStore state cell, SQLite switch commands, and caller option CAS
 * [OUTPUT]: Provides receipt-gated switch publication and pure Chat options patch validation
 * [POS]: Focused Chat store collaborator; no coordinator or Settings operations run inside the store queue
 */

import type { ChatStoreState } from "../state";
import type { ChatFacts } from "../../chat-summary";
import type { ChatOptionsPatch } from "../../../../../shared/chat-agent/contracts";
import { turnOptionsSchema } from "../../../../../shared/chat-agent/options";
import type { SwitchAgentCommand } from "../../sqlite/agent-switch/command";
import { switchRequestHash } from "../../sqlite/agent-switch/command";
import { ChatMutationOutcomeUnknownError } from "../mutation-outcome";

export function patchChatOptions(current: ChatFacts, input: ChatOptionsPatch): ChatFacts {
  if (current.agent !== input.expectedAgent || current.agentRevision !== input.expectedAgentRevision ||
      current.chatRecordRevision !== input.expectedChatRecordRevision) throw new Error("AGENT_REVISION_STALE");
  if (current.readOnlyReason || current.archivedAt) throw new Error("CHAT_NOT_WRITABLE");
  const options = turnOptionsSchema.parse({ ...current.options, ...input.patch });
  if (options.backend !== current.agent ||
      (current.executionKind === "managed-worktree" && options.permissionMode === "full-access")) {
    throw new Error("CHAT_OPTIONS_CONFLICT");
  }
  return { ...current, options };
}

export function prepareSwitchCommand(state: ChatStoreState, input: Omit<SwitchAgentCommand,
  "deviceId" | "requestHash" | "expectedAggregateRevision">): SwitchAgentCommand {
  const current = state.metadata.get(input.chatId);
  if (!current) throw new Error("Chat does not exist");
  // The only intervening canonical write is this intent's three-sequence reservation.
  if (current.agent !== input.intent.expectedAgent || current.agentRevision !== input.intent.expectedAgentRevision ||
      current.chatRecordRevision !== input.intent.expectedChatRecordRevision + 1) throw new Error("AGENT_REVISION_STALE");
  const body = { ...input, deviceId: state.requireDeviceId(), expectedAggregateRevision: current.chatRecordRevision };
  return { ...body, requestHash: switchRequestHash(body) };
}

export function switchChatAgent(state: ChatStoreState, command: SwitchAgentCommand) {
  return state.queue.enqueue(async () => {
    if (command.deviceId !== state.requireDeviceId()) throw new Error("AGENT_SWITCH_DEVICE_MISMATCH");
    const outcome = await state.requireDatabase().execute(command);
    if (outcome.status === "outcome_unknown") {
      throw new ChatMutationOutcomeUnknownError(outcome.operationId, outcome.reason);
    }
    if (outcome.status === "rejected") throw new Error(outcome.failure.message);
    const metadata = await state.refreshMetadata(command.chatId);
    state.activeRecord = undefined;
    return { receipt: outcome.receipt.result, metadata };
  });
}
