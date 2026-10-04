/**
 * [INPUT]: Depends on immutable remote attachment/reference DTOs and the command session's RemoteEntry.
 * [OUTPUT]: LOCAL_QUEUE_LIMIT, LocalQueued/LocalQueue, emptyLocalQueue and the pure rules settleLocalGate (which follows a command to its one resend), nextLocalStep and pruneStopped.
 * [POS]: Ruling 12's controlling-side queue: messages written while a command waits for its computer's report stay here, in draft custody,
 *   and leave strictly one at a time; the draft store holds the state and the composer executes the sends.
 */
import type { RemoteAttachment } from "@ai-chat/cloud-protocol/remote/input/model";
import type { RemoteReference } from "@ai-chat/cloud-protocol/remote/input/references";
import { awaitingResubmit, type RemoteEntry } from "../commands/session";

export const LOCAL_QUEUE_LIMIT = 20;
/** A new message held on this controller; its commandId is fixed when queued, so a resend after a reload is the same command. */
export type LocalQueued = { commandId: string; text: string; attachments: readonly RemoteAttachment[]; references: readonly RemoteReference[];
  planMode: boolean; incarnationId: string; ownerDeviceId: string };
/** gate: the command the next item waits on; paused: the refusal (a reason code) that stopped the queue until the user resumes. */
export type LocalQueue = { items: readonly LocalQueued[]; gate: string | null; paused: string | null };
export const emptyLocalQueue: LocalQueue = { items: [], gate: null, paused: null };

const REFUSED = new Set(["rejected", "expired", "cancelled"]);
const TERMINAL = new Set(["done", "cancelled", "error", "expired", "rejected"]);
const refusal = (entry: RemoteEntry) => {
  if (entry.rejected) return entry.rejected;
  const receipt = entry.receipt;
  if (!receipt || receipt.admission || !REFUSED.has(receipt.state) || entry.withdrawnByUser) return null;
  return receipt.reason ?? (receipt.state === "expired" ? "command-expired" : receipt.state);
};

/** Admission, Stop waiting or any other terminal state opens the gate; a refusal also pauses the queue with its reason. */
export function settleLocalGate(queue: LocalQueue, entries: readonly RemoteEntry[], stopped: ReadonlySet<string>): LocalQueue {
  if (!queue.gate) return queue;
  if (stopped.has(queue.gate)) return { ...queue, gate: null };
  const entry = entries.find(value => value.input.commandId === queue.gate);
  if (!entry) return queue;
  // A command waiting to go out again, or already resent, is settled by its resend.
  if (awaitingResubmit(entry)) return queue;
  if (entry.resubmittedAs) return settleLocalGate({ ...queue, gate: entry.resubmittedAs }, entries, stopped);
  const reason = refusal(entry);
  if (reason) return { ...queue, gate: null, paused: reason };
  return entry.canonical || entry.receipt?.admission || entry.receipt && TERMINAL.has(entry.receipt.state) ? { ...queue, gate: null } : queue;
}

export function nextLocalStep(queue: LocalQueue, facts: { waiting: boolean; busy: boolean; ready: boolean; incarnationId: string; ownerDeviceId: string | null }):
  { kind: "send"; item: LocalQueued } | { kind: "pause"; reason: "chat-changed" } | null {
  const item = queue.items[0];
  if (!item || queue.paused || queue.gate || facts.waiting || facts.busy) return null;
  if (item.incarnationId !== facts.incarnationId || item.ownerDeviceId !== facts.ownerDeviceId) return { kind: "pause", reason: "chat-changed" };
  return facts.ready ? { kind: "send", item } : null;
}

/** A stopped id is kept until its command is terminal; one whose command the session has not loaded yet is kept. */
export function pruneStopped(stopped: readonly string[], entries: readonly RemoteEntry[]) {
  return stopped.filter(commandId => {
    const entry = entries.find(value => value.input.commandId === commandId);
    return !entry || !entry.rejected && !(entry.receipt && TERMINAL.has(entry.receipt.state));
  });
}
