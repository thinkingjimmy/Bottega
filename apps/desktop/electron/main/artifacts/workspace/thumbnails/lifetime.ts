/**
 * [INPUT]: Validated immutable references, unguessable request IDs and trusted caller WebContents IDs.
 * [OUTPUT]: Bounded cancellable thumbnail request ownership, early-cancel tombstones and exact-window cleanup.
 * [POS]: Thumbnail consumer lifetime; cancellation removes only that consumer, never another shared capture owner.
 */
import { randomUUID } from "node:crypto";
import { webContents } from "electron";
import type { WorkspaceCommand } from "@ai-chat/cloud-protocol/artifacts/design/model";
const requests = new Map<string, { windowId: number; controller: AbortController }>();
const cancelled = new Map<string, { windowId: number; until: number }>();
export const thumbnailCancelled = () => new Error("artifact-thumbnail-cancelled");
const key = (input: WorkspaceCommand, windowId: number) => JSON.stringify([windowId, input.chatId, input.incarnationId, input.artifactId, input.requestId]);
function purge() { for (const [id, value] of cancelled) if (value.until <= Date.now()) cancelled.delete(id); }
export function cancelThumbnailRequest(input: WorkspaceCommand, windowId: number) {
  purge(); const id = key(input, windowId), held = requests.get(id);
  if (held) held.controller.abort(thumbnailCancelled());
  if (!cancelled.has(id) && cancelled.size >= 256) throw new Error("artifact-thumbnail-busy");
  cancelled.set(id, { windowId, until: Date.now() + 60_000 });
  return { cancelled: true };
}
export function cancelThumbnailWindow(windowId: number) {
  for (const value of requests.values()) if (value.windowId === windowId) value.controller.abort(thumbnailCancelled());
  for (const [id, value] of cancelled) if (value.windowId === windowId) cancelled.delete(id);
}
export const thumbnailRequestFacts = () => {
  purge();
  const owners = (values: Iterable<{ windowId: number }>) => {
    const counts = new Map<number, number>();
    for (const value of values) counts.set(value.windowId, (counts.get(value.windowId) ?? 0) + 1);
    return [...counts].map(([windowId, count]) => ({ windowId, count }));
  };
  return { requests: requests.size, cancellationTombstones: cancelled.size, requestOwners: owners(requests.values()), cancellationOwners: owners(cancelled.values()) };
};
export async function withThumbnailRequest<T>(input: WorkspaceCommand, windowId: number, operation: (signal: AbortSignal) => Promise<T>) {
  purge(); const caller = { ...input, requestId: input.requestId ?? randomUUID() }, id = key(caller, windowId);
  if (cancelled.has(id) || windowId > 0 && (!webContents.fromId(windowId) || webContents.fromId(windowId)!.isDestroyed())) throw thumbnailCancelled();
  if (requests.has(id) || requests.size >= 64) throw new Error("artifact-thumbnail-busy");
  const controller = new AbortController(), ticket = { windowId, controller }; requests.set(id, ticket);
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => { abort = () => reject(controller.signal.reason); controller.signal.addEventListener("abort", abort, { once: true }); });
  try { return await Promise.race([operation(controller.signal), interrupted]); }
  finally { controller.signal.removeEventListener("abort", abort); if (requests.get(id) === ticket) requests.delete(id); }
}
