/**
 * [INPUT]: Depends on the message-queue model's MessageQueue/QueueItem shapes
 * [OUTPUT]: Provides selectQueueRunners and QUEUE_RUNNER_LIMIT: which off-screen Chats get a background queue runner, and whether each may claim
 * [POS]: Pure policy of runtime/background; queue-runner-host.tsx feeds it store state and mounts the result
 */

import type { MessageQueue } from "../../../../lib/chat/session/message-queue-model";

export const QUEUE_RUNNER_LIMIT = 2;

export type QueueRunnerSelection = Readonly<{ chatId: string; drainAllowed: boolean }>;

/** The next message claimNext would take: the first item that isn't ambiguous or held, if it is queued and still sendable here. */
function nextSendable(queue: MessageQueue) {
  if (queue.paused || queue.error) return null;
  const next = queue.items.find((item) => item.state !== "ambiguous" && !item.unavailableAttachment);
  return next?.state === "queued" && !next.workspaceInvalidated ? next : null;
}

const inFlight = (queue: MessageQueue) => queue.items.some((item) => item.state === "submitting" || item.state === "steering");

export function selectQueueRunners(input: Readonly<{
  queues: readonly Readonly<{ chatId: string; queue: MessageQueue }>[];
  visibleChatId: string | null;
  localChatIds: ReadonlySet<string>;
  quitting: boolean;
  mounted: readonly string[];
}>): QueueRunnerSelection[] {
  const eligible = (chatId: string, queue: MessageQueue) =>
    !input.quitting && chatId !== input.visibleChatId && input.localChatIds.has(chatId) && nextSendable(queue) !== null;
  const mounted = new Set(input.mounted);
  // A runner holding a send stays until it settles, or the released item could go out twice.
  const settling = input.queues
    .filter(({ chatId, queue }) => mounted.has(chatId) && inFlight(queue))
    .map(({ chatId, queue }) => ({ chatId, drainAllowed: eligible(chatId, queue) }));
  const taken = new Set(settling.map((runner) => runner.chatId));
  const waiting = input.queues
    .filter(({ chatId, queue }) => !taken.has(chatId) && eligible(chatId, queue))
    .map(({ chatId, queue }) => ({ chatId, oldest: nextSendable(queue)!.createdAt }))
    .sort((a, b) => a.oldest - b.oldest)
    .slice(0, Math.max(0, QUEUE_RUNNER_LIMIT - settling.length))
    .map(({ chatId }) => ({ chatId, drainAllowed: true }));
  return [...settling, ...waiting];
}
