/**
 * [INPUT]: Original command custody, ordered queue identities, this view's transcript readiness/canonical user messages and verified live settlement.
 * [OUTPUT]: One send presentation for the transcript, composer and visible queue; transport waiting never establishes a predecessor. Proven queue takeover and unadmitted exchanges do not create duplicate transcript bubbles.
 * [POS]: Shared remote presentation policy. Wire queues remain complete for revision-fenced controls.
 */
import type { CloudChatHead } from "@ai-chat/cloud-protocol/chats/model";
import type { AwaitingQueue } from "@ai-chat/cloud-protocol/remote/queue";
import type { ChatLiveView } from "../../model";
import { awaitingResubmit, type RemoteEntry } from "./session";

export type SendPosition = { afterCommandId?: string; afterTurnId?: string };
export const isMessageEntry = (entry: RemoteEntry) => ["start-turn", "retry-authentication"].includes(entry.input.payload.kind);
export const commandFinished = (entry: RemoteEntry) => Boolean(entry.cancelledBeforeSend || entry.rejected ||
  entry.receipt && ["done", "error", "cancelled", "expired", "rejected"].includes(entry.receipt.state) && !awaitingResubmit(entry));
export type SendPresentation = ReturnType<typeof remoteSendPresentation>;
export function remoteSendPresentation({ head, live, entries, queue, localIds = [], canonical = [], completedTurns = [], transcriptReady = true }: {
  head: CloudChatHead; live?: ChatLiveView | null; entries: readonly RemoteEntry[]; queue?: AwaitingQueue | null;
  localIds?: readonly string[]; canonical?: readonly { commandId: string; messageId: string }[];
  completedTurns?: readonly string[];
  transcriptReady?: boolean;
}) {
  const settled = live?.state?.receipt.settlementState === "settled" ? live.state.receipt : null;
  const byId = new Map(entries.map(entry => [entry.input.commandId, entry]));
  const endedTurns = new Set([...completedTurns, ...entries.filter(commandFinished).flatMap(entry => entry.receipt?.admission ? [entry.receipt.admission.requestId] : [])]);
  if (settled) endedTurns.add(settled.turnId);
  const isSettled = (entry: RemoteEntry) => commandFinished(entry) || Boolean(entry.receipt?.admission && endedTurns.has(entry.receipt.admission.requestId));
  const activeTurnId = [head.openTurnId, live?.state?.receipt.settlementState === "open" ? live.state.receipt.turnId : null,
    ...entries.filter(entry => isMessageEntry(entry) && entry.receipt?.state === "running").map(entry => entry.receipt?.admission?.requestId)]
    .find(id => id && !endedTurns.has(id)) ?? null;
  const current = entries.find(entry => isMessageEntry(entry) && activeTurnId &&
    (entry.receipt?.admission?.requestId === activeTurnId || canonical.some(message => message.commandId === entry.input.commandId && message.messageId === live?.state?.receipt.userMessageId)));
  const accepted = queue?.accepted ?? head.queue;
  const wireIds = [...(accepted?.deviceId === head.ownerDeviceId ? accepted.items.map(item => item.intentId) : []),
    ...(queue?.items.filter(item => item.targetDeviceId === head.ownerDeviceId).map(item => item.intentId) ?? [])];
  const eligible = entries.filter(entry => isMessageEntry(entry) && !entry.resubmittedAs && !isSettled(entry));
  const orderedIds = [...new Set([...wireIds, ...eligible.map(entry => entry.input.commandId)])]
    .filter(id => { const entry = byId.get(id); return !entry || eligible.includes(entry); });
  const queued = new Set(localIds);
  let foreground: RemoteEntry | null = current ?? null;
  const held = (entry: RemoteEntry) => {
    const before = entry.position?.afterCommandId ? byId.get(entry.position.afterCommandId) : null;
    return Boolean(before && !isSettled(before) && !before.resubmittedAs) ||
      Boolean(entry.position?.afterTurnId && entry.position.afterTurnId === activeTurnId) || Boolean(entry.receipt?.blockedBy);
  };
  // An idle send owns the foreground before any transport/queue snapshot arrives.
  // Preserve that ownership even if the next command's queue snapshot arrives first.
  if (!activeTurnId) foreground = eligible.find(entry => entry.position && !entry.position.afterCommandId && !entry.position.afterTurnId && !held(entry)) ?? null;
  let foregroundId = foreground?.input.commandId;
  if (!activeTurnId && !foregroundId) {
    foregroundId = orderedIds.find(id => !queued.has(id) && (!byId.has(id) || !held(byId.get(id)!)));
    foreground = foregroundId ? byId.get(foregroundId) ?? null : null;
  }
  for (const id of orderedIds) if (id !== foregroundId) queued.add(id);
  const canonicalIds = new Set(canonical.map(item => item.commandId));
  // Session acknowledgement can outlive a view. Keep its original bubble until this view has read the body.
  const pending = entries.filter(entry => isMessageEntry(entry) && (entry.owned || entry.optimistic) && (!entry.canonical || !transcriptReady) && !canonicalIds.has(entry.input.commandId) &&
    !entry.cancelledBeforeSend && !entry.resubmittedAs && !entry.rejected && entry.receipt?.output?.kind !== "queue-withdrawal" && !("queueExchange" in entry.input.payload && entry.input.payload.queueExchange && !entry.receipt?.admission) && !queued.has(entry.input.commandId) &&
    !(!entry.receipt?.admission && ["rejected", "expired", "cancelled"].includes(entry.receipt?.state ?? "")));
  const waiting = Boolean(activeTurnId || foregroundId);
  return { foreground, pending, queuedIds: [...queued], activeTurnId, waiting };
}
