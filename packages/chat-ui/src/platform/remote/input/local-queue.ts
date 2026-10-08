/**
 * [INPUT]: Immutable attachment/reference DTOs, send predecessors, shared capacity and command entries.
 * [OUTPUT]: LocalQueued/LocalQueue with frozen send settings, LOCAL_QUEUE_LIMIT, emptyLocalQueue, settleLocalGate and nextLocalStep.
 * [POS]: Controller-side successor custody; one admission gate advances at a time, with state owned by the draft store.
 */
import type { RemoteTurnOptions } from "@ai-chat/cloud-protocol/remote/model";
import type { RemoteCreateInput } from "../contracts";
import type { SendPosition } from "../commands/presentation";
import type { RemotePermissionMode, RemoteAttachment } from "@ai-chat/cloud-protocol/remote/input/model";
import type { RemoteReference } from "@ai-chat/cloud-protocol/remote/input/references";
import { awaitingResubmit, type RemoteEntry } from "../commands/session";

export { LOCAL_QUEUE_LIMIT } from "./limits";
export type FrozenSendSettings = { backend: RemoteCreateInput["backend"]; permissionMode: RemotePermissionMode; options?: RemoteTurnOptions };
/** A new message held on this controller; its commandId is fixed when queued, so a resend after a reload is the same command. */
export type LocalQueued = { commandId: string; text: string; attachments: readonly RemoteAttachment[]; references: readonly RemoteReference[];
  planMode: boolean; incarnationId: string; ownerDeviceId: string; settings?: FrozenSendSettings; position?: SendPosition };
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

/** Admission or a confirmed terminal state opens the gate; a refusal also pauses the queue with its reason. */
export function settleLocalGate(queue: LocalQueue, entries: readonly RemoteEntry[]): LocalQueue {
  if (!queue.gate) return queue;
  const entry = entries.find(value => value.input.commandId === queue.gate);
  if (!entry) return queue;
  // A command waiting to go out again, or already resent, is settled by its resend.
  if (awaitingResubmit(entry)) return queue;
  if (entry.resubmittedAs) return settleLocalGate({ ...queue, gate: entry.resubmittedAs }, entries);
  const reason = refusal(entry);
  if (reason) return { ...queue, gate: null, paused: reason };
  return entry.cancelledBeforeSend || entry.canonical || entry.receipt?.admission || entry.receipt && TERMINAL.has(entry.receipt.state) ? { ...queue, gate: null } : queue;
}

export function nextLocalStep(queue: LocalQueue, facts: { waiting: boolean; busy: boolean; ready: boolean; incarnationId: string; ownerDeviceId: string | null }):
  { kind: "send"; item: LocalQueued } | { kind: "pause"; reason: "chat-changed" } | null {
  const item = queue.items[0];
  if (!item || queue.paused || queue.gate || facts.waiting || facts.busy) return null;
  if (item.incarnationId !== facts.incarnationId || item.ownerDeviceId !== facts.ownerDeviceId) return { kind: "pause", reason: "chat-changed" };
  return facts.ready ? { kind: "send", item } : null;
}
