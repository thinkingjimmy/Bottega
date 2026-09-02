/**
 * [INPUT]: Depends on shared SubmissionOutcome/SubmissionAck, message-queue pure state machine, and renderer locale/catalog runtime
 * [OUTPUT]: Provides derived manual custody Final check, settled and generated ACK only when chat-persisted
 * [POS]: The manual outcome of runtime/message-queue is the purely projection boundary; React hook is only responsible for executing the returned ACK side effects
 */

import type {
  SubmissionAck,
  SubmissionOutcome,
} from "../../../../../shared/submission";
import {
  setQueueError,
  settleItem,
  type MessageQueue,
} from "@/lib/message-queue-model";
import { effectiveLocale } from "@/lib/i18n-locale";
import { translate } from "../../../../../shared/i18n/runtime";

type ManualCustodyReconciliation = {
  queue: MessageQueue;
  outcomeAck?: SubmissionAck;
  steerAck?: string;
};

export function reconcileManualCustody(
  queue: MessageQueue,
  outcome: SubmissionOutcome
): ManualCustodyReconciliation {
  const item = queue.items.find(
    (candidate) =>
      candidate.state === "ambiguous" &&
      candidate.custodyIntentId === outcome.intentId
  );
  if (!item) return { queue };

  if (
    outcome.kind === "live" &&
    outcome.phase === "failed" &&
    (outcome.retry === "recoverable" ||
      outcome.retry === "retry-agent-turn")
  ) {
    return {
      queue: setQueueError(
        queue,
        outcome.message ??
          (outcome.retry === "recoverable"
            ? translate(effectiveLocale(), "chat.runtime.queue.recoverable")
            : translate(effectiveLocale(), "chat.runtime.queue.retryAgentTurn"))
      ),
    };
  }
  if (
    outcome.kind === "live" &&
    (outcome.phase === "unknown" || outcome.retry === "reconcile")
  ) {
    return {
      queue: setQueueError(
        queue,
        outcome.message ??
          translate(effectiveLocale(), "chat.runtime.queue.reconciling")
      ),
    };
  }
  if (outcome.kind === "tombstone") {
    if (outcome.outcome !== "persisted") {
      return {
        queue: setQueueError(
          queue,
          translate(
            effectiveLocale(),
            "chat.runtime.queue.failedResourcesReleased"
          )
        ),
      };
    }
    return {
      queue: settleItem(queue, item.id),
      outcomeAck: {
        intentId: outcome.intentId,
        outcomeRevision: outcome.revision,
        kind: "admission",
      },
      steerAck: item.outboxRef,
    };
  }
  if (outcome.kind === "notFound") return { queue };
  if (outcome.phase !== "failed" && outcome.custody === "chat-persisted") {
    return {
      queue: settleItem(queue, item.id),
      outcomeAck: {
        intentId: outcome.intentId,
        outcomeRevision: outcome.revision,
        kind: "admission",
      },
      steerAck: item.outboxRef,
    };
  }
  if (outcome.phase === "failed") {
    return {
      queue: setQueueError(
        queue,
        outcome.message ?? translate(effectiveLocale(), "chat.runtime.queue.failed")
      ),
    };
  }
  // queued/main-journal 与 notFound 都保持 ambiguous：前者等待
  // canonical user 落盘，后者由重发路径按 reservation fence 消费。
  return { queue };
}
