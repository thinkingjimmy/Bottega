/**
 * [INPUT]: Depends on the existing RelayLedger and ChatStore synchronization facade
 * [OUTPUT]: Prepares fresh evidence inside the serialized ledger write or replays an exact frozen command, then transfers custody only after SQLite's durable receipt
 * [POS]: Cross-owner handoff above the leaf queues; no alternative execution ledger is created
 */
import type { RelayLedger } from "../../../sections/coordinator/relay-ledger";
import type { ChatStore } from "../../chat-store";
import { cloudMutationSchema, type CloudMutation } from "../../sqlite/cloud/protocol";
import { cloudRequestHash } from "./api";
function validatedCommand(command: CloudMutation) {
  const parsed = cloudMutationSchema.parse(command);
  if (cloudRequestHash({ ...parsed, requestHash: undefined }) !== parsed.requestHash || parsed.action.type !== "handoff-turn") throw new Error("LEDGER_HANDOFF_COMMAND_INVALID");
  return parsed;
}
export async function handoffLedgerTurn(ledger: RelayLedger, chats: ChatStore, intentId: string,
  command: CloudMutation | Parameters<RelayLedger["prepareCloudHandoff"]>[1]) {
  const parsed = typeof command === "function" ? await ledger.prepareCloudHandoff(intentId, state => {
    const candidate = command(state); return candidate ? validatedCommand(candidate) : null;
  }) : validatedCommand(command);
  if (!parsed) return null;
  if (typeof command !== "function") await ledger.freezeCloudHandoff(intentId, parsed);
  const receipt = await chats.sync.mutate(parsed.scope, parsed.operationId, parsed.action);
  const value = receipt.result.value as { sourceId: string; digest: string };
  if (receipt.operationId !== parsed.operationId || receipt.requestHash !== parsed.requestHash || receipt.result.type !== "handoff-turn") throw new Error("LEDGER_HANDOFF_RECEIPT_INVALID");
  await ledger.confirmCloudHandoff(intentId, { operationId: receipt.operationId, requestHash: receipt.requestHash, ...value });
  return receipt;
}
export async function recoverLedgerHandoffs(ledger: RelayLedger, chats: ChatStore) {
  for (const intent of Object.values(ledger.snapshot().manualIntents)) if (intent.cloudHandoff?.state === "pending") {
    await handoffLedgerTurn(ledger, chats, intent.id, intent.cloudHandoff.command);
  }
}
