/**
 * [INPUT]: Ledger drafts, authenticated remote source identity and revision-bound queue references.
 * [OUTPUT]: Source pause gates and durable single-owner queue claims, transfer and rollback.
 * [POS]: Queue custody primitives shared by admission, Steer and scheduler mutations.
 */
import type { LedgerState } from "../state/ledger-schema";
import type { DeepReadonly } from "../state/readonly-ledger";
import type { RemoteContext } from "./model";
import type { QueuedInput } from "@ai-chat/cloud-protocol/remote/queue";
import { canonicalHash } from "../coordinator-values";
import { failManualWithCapsule } from "../submission-outcome";
export { sourceQueuePaused, setSourceQueuePaused } from "./source-pause";

export function queueRows(state: DeepReadonly<LedgerState>, chatId: string) {
  return Object.values(state.manualIntents).filter(intent => intent.conversationId === chatId && intent.origin.kind !== "workflow" &&
    ["queued", "appended"].includes(intent.phase) && !intent.attempts.some(attempt => attempt.phase !== "failed"))
    .sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
}
export function queueProjection(state: DeepReadonly<LedgerState>, chatId: string) {
  const items = queueRows(state, chatId).map((intent, sequence) => ({ intentId: intent.id, sequence,
    sourceDeviceId: intent.queueSource?.origin.sourceDeviceId ?? (intent.origin.kind === "remote" ? intent.origin.sourceDeviceId : null),
    ...(intent.queueSource ? { commandId: intent.queueSource.origin.commandId } : {}),
    locked: Boolean(intent.preparing || intent.userSeq !== undefined || intent.queueClaim) }));
  const pausedSources = [...new Set(state.remoteQueuePauses.filter(pause => pause.chatId === chatId).map(pause => pause.sourceDeviceId))].sort();
  return { items, pausedSources, revision: canonicalHash({ items, pausedSources }) };
}
export function claimQueuedInput(state: LedgerState, context: RemoteContext, reference: QueuedInput) {
  const intent = state.manualIntents[reference.intentId];
  const source = intent?.remoteSubmission?.context ?? intent?.queueSource;
  if (!intent || intent.conversationId !== context.chatId || source?.incarnationId !== context.incarnationId ||
    source.origin.sourceDeviceId !== context.origin.sourceDeviceId) throw new Error("not-owner");
  if (intent.queueTakenBy === context.origin.commandId) return intent;
  if (intent.phase !== "queued" || intent.preparing || intent.userSeq !== undefined || intent.attempts.length ||
    intent.queueClaim && intent.queueClaim !== context.origin.commandId) throw new Error("already-dispatched");
  if (intent.queueClaim === context.origin.commandId) return intent;
  if (queueProjection(state, context.chatId).revision !== reference.expectedRevision) throw new Error("queue-changed");
  intent.queueClaim = context.origin.commandId;
  return intent;
}
export function releaseQueuedInput(state: LedgerState, commandId: string) {
  for (const intent of Object.values(state.manualIntents)) if (intent.queueClaim === commandId && !intent.queueTakenBy) delete intent.queueClaim;
}
export function transferQueuedInput(state: LedgerState, context: RemoteContext, reference: QueuedInput, now: number) {
  const intent = claimQueuedInput(state, context, reference);
  if (intent.queueTakenBy === context.origin.commandId) return intent.sequence;
  failManualWithCapsule(state, intent.id, "recoverable", now, false);
  if (state.retryCapsules[intent.id]) state.retryCapsules[intent.id]!.state = "expired";
  intent.queueTakenBy = context.origin.commandId;
  delete intent.queueClaim;
  return intent.sequence;
}
