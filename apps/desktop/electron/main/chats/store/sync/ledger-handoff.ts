/**
 * [INPUT]: Depends on the existing RelayLedger and ChatStore synchronization facade
 * [OUTPUT]: Transfers frozen turn evidence only after SQLite's durable receipt and keeps unknown outcomes recoverable
 * [POS]: Cross-owner handoff above the leaf queues; no alternative execution ledger is created
 */
import type { RelayLedger } from "../../../sections/coordinator/relay-ledger";
import type { ChatStore } from "../../chat-store";
import { cloudMutationSchema, type CloudMutation } from "../../sqlite/cloud/protocol";
import { cloudRequestHash } from "./api";
export async function handoffLedgerTurn(ledger: RelayLedger, chats: ChatStore, intentId: string, command: CloudMutation) {
  const parsed = cloudMutationSchema.parse(command);
  if (cloudRequestHash({ ...parsed, requestHash: undefined }) !== parsed.requestHash || parsed.action.type !== "handoff-turn") throw new Error("LEDGER_HANDOFF_COMMAND_INVALID");
  await ledger.freezeCloudHandoff(intentId, parsed);
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
