/**
 * [INPUT]: Depends on the store queue and existing SQLite operation receipts
 * [OUTPUT]: Reserves switch sequence positions idempotently and verifies an original reservation during raw recovery
 * [POS]: Bridges raw submission custody to the queued switch command without another ledger or receipt table
 */
import type { ChatStoreState } from "../state";
import { switchRequestHash, switchSequenceOperationId, type SwitchSequenceInput, type SwitchSequenceReservation } from "../../sqlite/agent-switch/command";
import { ChatMutationOutcomeUnknownError } from "../mutation-outcome";

function commandOf(state: ChatStoreState, input: SwitchSequenceInput) {
  const body = { kind: "reserve-switch-sequences" as const, ...input,
    deviceId: state.requireDeviceId(), operationId: switchSequenceOperationId(input.intentId) };
  return { ...body, requestHash: switchRequestHash(body) };
}
export function readSwitchReservation(state: ChatStoreState, input: SwitchSequenceInput) {
  return state.queue.enqueue(async () => {
    const command = commandOf(state, input);
    const receipt = await state.requireDatabase().execute({ kind: "get-operation-receipt", operationId: command.operationId });
    if (!receipt) return null;
    if (receipt.kind !== command.kind || receipt.targetId !== input.chatId || receipt.requestHash !== command.requestHash) throw new Error("AGENT_SWITCH_COMMAND_CONFLICT");
    await state.refreshMetadata(input.chatId);
    state.activeRecord = undefined;
    return receipt.result as SwitchSequenceReservation;
  });
}
export function reserveAgentSwitchSequences(state: ChatStoreState, input: SwitchSequenceInput) {
  return state.queue.enqueue(async () => {
    const outcome = await state.requireDatabase().execute(commandOf(state, input));
    if (outcome.status === "outcome_unknown") throw new ChatMutationOutcomeUnknownError(outcome.operationId, outcome.reason);
    if (outcome.status === "rejected") throw new Error(outcome.failure.message);
    await state.refreshMetadata(input.chatId);
    state.activeRecord = undefined;
    return outcome.receipt.result;
  });
}
