/**
 * [INPUT]: Depends on coordinator ledger operations, turn commit facts, and canonical notice IDs
 * [OUTPUT]: Provides prepareTurnResult (atomic assistant-result plus dependent-notice ledger preparation) and truncation notice identity
 * [POS]: Turn preparation transaction helper shared by manual, relay, and unowned Agent turns
 */

import {
  noticeMessageContent,
  type ChatNotice,
  type TurnCommitInput,
} from "../../../../shared/chats-ipc";
import type { CoordinatorDependencies } from "./coordinator-runtime";
import { relayExpectation, stableId } from "./coordinator-values";

export type TurnPreparationEvent = {
  conversationId: string;
  requestId: string;
  assistantMessageId: string;
  terminal: "done" | "cancelled" | "error";
  facts?: { skillDescriptionsTruncated?: true };
  commit: TurnCommitInput;
};

export function skillTruncationNoticeId(chatId: string, turnId: string) {
  return stableId("notice", `skills-truncated:${chatId}:${turnId}`);
}

/* ============================================================
 * 三条机制各管一件事，缺一不可：
 *   stable ID        → 不重（`chat-store` 撞 id 复用既有 seq，重放天然幂等）
 *   outbox + reconcile → 不丢（两次写入之间崩溃，pending 条目会被重放冲出）
 *   dependsOnMessageId → 不早、不孤（assistant 落盘前不许冲）
 *
 * ⚠️ 整条记录必须是本轮事实的**确定性函数**——不只是 `id`。`putNoticeOutbox`
 * 按 canonical payload 逐字比对既有条目（`state/operations/manual.ts`），
 * 所以 `createdAt` 掺进 `Date.now()`/随机数的那一刻：id 相同而 payload 不同，
 * persist 重试会当场抛「canonical payload 冲突」，把整轮 turn 一起拖红。
 * 沿用同轮 assistant 的 `createdAt`，重试第 n 次与第一次逐字相同。
 * ============================================================ */
function skillTruncationNotice(event: TurnPreparationEvent) {
  if (!event.facts?.skillDescriptionsTruncated) return undefined;
  const notice: ChatNotice = {
    kind: "skill-descriptions-truncated",
    turnId: event.requestId,
  };
  const id = skillTruncationNoticeId(event.conversationId, event.requestId);
  return {
    id,
    chatId: event.conversationId,
    dependsOnMessageId: event.assistantMessageId,
    message: {
      id,
      role: "notice" as const,
      content: noticeMessageContent(notice),
      notice,
      createdAt: event.commit.message?.createdAt ?? 0,
    },
    state: "pending" as const,
  };
}

export async function prepareTurnResult(
  dependencies: CoordinatorDependencies,
  event: TurnPreparationEvent
) {
  const notice = skillTruncationNotice(event);
  const snapshot = dependencies.ledger.snapshot();
  const manual = Object.values(snapshot.manualIntents).find(
    (candidate) =>
      candidate.requestId === event.requestId && candidate.phase === "claimed"
  );
  if (manual) {
    await dependencies.ledger.prepareManualResult(
      manual.id,
      {
        terminal: event.terminal,
        outcome: event.commit.message ? "stored" : "empty",
        ...(event.commit.message
          ? { assistantMessage: event.commit.message }
          : {}),
      },
      notice
    );
    return;
  }
  const relay = Object.values(snapshot.relays).find(
    (candidate) =>
      candidate.requestId === event.requestId &&
      candidate.deliveryPhase === "claimed"
  );
  if (!relay) {
    if (notice) await dependencies.ledger.putNoticeOutbox(notice);
    return;
  }
  await dependencies.ledger.transition(
    relay.id,
    relayExpectation(relay, "claimed"),
    {
      assistantOutbox: {
        terminal: event.terminal,
        ...(event.commit.message ? { message: event.commit.message } : {}),
        state: "pending",
      },
    },
    notice
  );
}
