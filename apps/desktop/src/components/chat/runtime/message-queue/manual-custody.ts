/**
 * [INPUT]: Depends on shared SubmissionOutcome/SubmissionAck with message-queue pure state machine
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
            ? "消息可恢复；重发会派生新提交身份。"
            : "用户消息已持久化，请使用“重试 Agent turn”。")
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
        outcome.message ?? "提交仍在对账，普通重试可能重复执行。"
      ),
    };
  }
  if (outcome.kind === "tombstone") {
    if (outcome.outcome !== "persisted") {
      return {
        queue: setQueueError(
          queue,
          "提交已失败，main 已回收重试资源；请重新编辑发送。"
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
      queue: setQueueError(queue, outcome.message ?? "提交已失败。"),
    };
  }
  // queued/main-journal 与 notFound 都保持 ambiguous：前者等待
  // canonical user 落盘，后者由重发路径按 reservation fence 消费。
  return { queue };
}
