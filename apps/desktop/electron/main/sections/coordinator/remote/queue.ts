/**
 * [INPUT]: The sole durable ledger, target-bound controls and the original dispatch critical section.
 * [OUTPUT]: Content-free queued identities and atomic controls over unsequenced, unpinned inputs with durable transfer proof.
 * [POS]: Coordinator queue library; no Agent dispatch or network IO occurs inside its mutations.
 */
import type { RemoteCommand } from "@ai-chat/cloud-protocol/remote/model";
import type { LedgerState } from "../state/ledger-schema";
import type { DeepReadonly } from "../state/readonly-ledger";
import { canonicalHash } from "../coordinator-values";
import { failManualWithCapsule } from "../submission-outcome";
import { controlReceiptSchema, type RemoteContext } from "./model";
/** Queued rows in dispatch order; the ledger sequence stays local and never leaves this module. */
function queuedRows(state: DeepReadonly<LedgerState>, chatId: string) {
  return Object.values(state.manualIntents).filter(intent => intent.conversationId === chatId &&
    ["queued", "appended"].includes(intent.phase) && !intent.attempts.some(attempt => !["failed"].includes(attempt.phase)))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
export function queuedProjection(state: DeepReadonly<LedgerState>, chatId: string) {
  // Position within the chat, not the device's lifetime counter: the published queue carries no usage metadata.
  const items = queuedRows(state, chatId).map((intent, index) => ({ intentId: intent.id, sequence: index,
    sourceDeviceId: intent.origin.kind === "remote" ? intent.origin.sourceDeviceId : null }));
  return { items, revision: canonicalHash(items) };
}
export function editQueued(state: LedgerState, now: number, command: RemoteCommand, context: RemoteContext) {
  const payload = command.payload;
  if (payload.kind !== "withdraw-queued" && payload.kind !== "reorder-queue") throw new Error("input-unsupported");
  const prior = state.controlReceipts[command.commandId];
  if (prior) {
    if (canonicalHash(prior.remote) !== canonicalHash(context) || prior.payloadHash !== canonicalHash(payload)) throw new Error("REMOTE_CONTROL_ID_CONFLICT");
    return prior;
  }
  const queue = queuedProjection(state, context.chatId), slots = queuedRows(state, context.chatId).map(intent => intent.sequence);
  const ids = payload.kind === "withdraw-queued" ? [payload.intentId] : payload.intentIds;
  if (ids.some(id => !queue.items.some(item => item.intentId === id))) throw new Error("already-dispatched");
  if (payload.expectedRevision !== queue.revision || payload.kind === "reorder-queue" && ids.length !== queue.items.length) throw new Error("queue-changed");
  // Once canonical slots are reserved, persistence may already have committed across a crash.
  // Such rows keep their position; editable queued rows have no transcript sequence yet.
  const moved = payload.kind === "withdraw-queued" ? ids : ids.filter((id, index) => id !== queue.items[index]!.intentId);
  if (moved.some(id => state.manualIntents[id]!.preparing || state.manualIntents[id]!.userSeq !== undefined)) throw new Error("already-dispatched");
  if (payload.kind === "withdraw-queued") failManualWithCapsule(state, payload.intentId,
    state.manualIntents[payload.intentId]!.phase === "queued" ? "recoverable" : "retry-agent-turn", now);
  else ids.forEach((id, index) => { state.manualIntents[id]!.sequence = slots[index]!; });
  return state.controlReceipts[command.commandId] = controlReceiptSchema.parse({ id: command.commandId, conversationId: context.chatId,
    incarnationId: context.incarnationId, requestId: command.commandId, generation: 1, key: `queue:${payload.expectedRevision}`,
    payload, payloadHash: canonicalHash(payload), remote: context, state: "applied", result: "applied", createdAt: now, updatedAt: now });
}

/** Only a never-appended, never-dispatched intent can move without duplicating a canonical user. */
export function withdrawUnpersisted(state: LedgerState, now: number, context: RemoteContext) {
  const intentId = context.origin.commandId, id = canonicalHash(["withdraw-unpersisted", context]);
  const prior = state.controlReceipts[id];
  if (prior) return prior;
  const intent = state.manualIntents[intentId];
  if (!intent || intent.phase !== "queued" || intent.preparing || intent.userSeq !== undefined || intent.attempts.length || !intent.remoteSubmission ||
    canonicalHash(intent.remoteSubmission.context) !== canonicalHash(context)) return null;
  const expectedRevision = queuedProjection(state, context.chatId).revision;
  failManualWithCapsule(state, intentId, "recoverable", now);
  // A transferred intent must never remain available for a second local retry.
  if (state.retryCapsules[intentId]) state.retryCapsules[intentId]!.state = "expired";
  return state.controlReceipts[id] = controlReceiptSchema.parse({ id, conversationId: context.chatId,
    incarnationId: context.incarnationId, requestId: intentId, generation: 1, key: `withdraw:${intentId}`,
    payload: { kind: "withdraw-queued", intentId, expectedRevision }, payloadHash: canonicalHash([intentId, expectedRevision]),
    remote: context, state: "applied", result: "applied", output: { kind: "queue-withdrawal", unpersisted: true }, createdAt: now, updatedAt: now });
}
