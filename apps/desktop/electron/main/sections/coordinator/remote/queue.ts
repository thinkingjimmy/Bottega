/**
 * [INPUT]: The sole durable ledger, target-bound controls and the original dispatch critical section.
 * [OUTPUT]: Content-free queued identities (a person's intents only, never a workflow step's) and atomic controls over unsequenced, unpinned inputs with durable transfer proof. Revision-bound take and source pause controls preserve immutable takeover evidence.
 * [POS]: Coordinator queue library; no Agent dispatch or network IO occurs inside its mutations.
 */
import type { RemoteCommand } from "@ai-chat/cloud-protocol/remote/model";
import type { LedgerState } from "../state/ledger-schema";
import type { DeepReadonly } from "../state/readonly-ledger";
import { canonicalHash } from "../coordinator-values";
import { failManualWithCapsule } from "../submission-outcome";
import { controlReceiptSchema, type RemoteContext } from "./model";
import { queueRows, queueProjection, transferQueuedInput, setSourceQueuePaused } from "./queue-custody";
/**
 * Queued rows in dispatch order; the ledger sequence stays local and never leaves this module. A workflow step's intent is a
 * role's prompt, not the person's message, so it is never offered for editing or withdrawal (Q4).
 */
export function queuedProjection(state: DeepReadonly<LedgerState>, chatId: string) {
  return queueProjection(state, chatId);
}
export function editQueued(state: LedgerState, now: number, command: RemoteCommand, context: RemoteContext) {
  const payload = command.payload;
  if (payload.kind !== "withdraw-queued" && payload.kind !== "reorder-queue" && payload.kind !== "take-queued" && payload.kind !== "set-queue-paused") throw new Error("input-unsupported");
  const prior = state.controlReceipts[command.commandId];
  if (prior) {
    if (canonicalHash(prior.remote) !== canonicalHash(context) || prior.payloadHash !== canonicalHash(payload)) throw new Error("REMOTE_CONTROL_ID_CONFLICT");
    return prior;
  }
  const queue = queuedProjection(state, context.chatId), slots = queueRows(state, context.chatId).map(intent => intent.sequence);
  const ids = payload.kind === "set-queue-paused" ? [] : payload.kind === "reorder-queue" ? payload.intentIds : [payload.intentId];
  if (ids.some(id => !queue.items.some(item => item.intentId === id))) throw new Error("already-dispatched");
  if (payload.expectedRevision !== queue.revision || payload.kind === "reorder-queue" && ids.length !== queue.items.length) throw new Error("queue-changed");
  // Once canonical slots are reserved, persistence may already have committed across a crash.
  // Such rows keep their position; editable queued rows have no transcript sequence yet.
  const moved = payload.kind === "reorder-queue" ? ids.filter((id, index) => id !== queue.items[index]!.intentId) : ids;
  if (moved.some(id => state.manualIntents[id]!.preparing || state.manualIntents[id]!.userSeq !== undefined || state.manualIntents[id]!.queueClaim)) throw new Error("already-dispatched");
  if (payload.kind === "withdraw-queued") failManualWithCapsule(state, payload.intentId,
    state.manualIntents[payload.intentId]!.phase === "queued" ? "recoverable" : "retry-agent-turn", now, false);
  else if (payload.kind === "take-queued") transferQueuedInput(state, context, payload, now);
  else if (payload.kind === "set-queue-paused") setSourceQueuePaused(state, context, payload.paused);
  else ids.forEach((id, index) => { state.manualIntents[id]!.sequence = slots[index]!; });
  return state.controlReceipts[command.commandId] = controlReceiptSchema.parse({ id: command.commandId, conversationId: context.chatId,
    incarnationId: context.incarnationId, requestId: command.commandId, generation: 1, key: `queue:${payload.expectedRevision}`,
    payload, payloadHash: canonicalHash(payload), remote: context, state: "applied", result: "applied", createdAt: now, updatedAt: now,
    ...(payload.kind === "take-queued" ? { output: { kind: "queue-withdrawal", unpersisted: true } } : {}) });
}

/** Only a never-appended, never-dispatched intent can move without duplicating a canonical user. */
export function withdrawUnpersisted(state: LedgerState, now: number, context: RemoteContext) {
  const intentId = context.origin.commandId, id = canonicalHash(["withdraw-unpersisted", context]);
  const prior = state.controlReceipts[id];
  if (prior) return prior;
  const intent = state.manualIntents[intentId];
  if (!intent || intent.phase !== "queued" || intent.preparing || intent.queueClaim || intent.userSeq !== undefined || intent.attempts.length || !intent.remoteSubmission ||
    canonicalHash(intent.remoteSubmission.context) !== canonicalHash(context)) return null;
  const expectedRevision = queuedProjection(state, context.chatId).revision;
  failManualWithCapsule(state, intentId, "recoverable", now, false);
  // A transferred intent must never remain available for a second local retry.
  if (state.retryCapsules[intentId]) state.retryCapsules[intentId]!.state = "expired";
  return state.controlReceipts[id] = controlReceiptSchema.parse({ id, conversationId: context.chatId,
    incarnationId: context.incarnationId, requestId: intentId, generation: 1, key: `withdraw:${intentId}`,
    payload: { kind: "withdraw-queued", intentId, expectedRevision }, payloadHash: canonicalHash([intentId, expectedRevision]),
    remote: context, state: "applied", result: "applied", output: { kind: "queue-withdrawal", unpersisted: true }, createdAt: now, updatedAt: now });
}
