/**
 * [INPUT]: Depends on RelayLedger's read-only conversation index selector, conversationId, and durable sequence ordering
 * [OUTPUT]: Provides nextDeliverable, isRunnableDeliverable, blockedReceiptFor, and ledgerHasLiveTurn (the one ledger-side liveness rule) Claimed inputs cannot dispatch; a source pause skips only that source while other inputs remain runnable.
 * [POS]: Pure sections/coordinator scheduler selector; it separates FIFO delivery eligibility from execution ordering
 */

import type { RelayLedger } from "../relay-ledger";
import { sourceQueuePaused } from "../remote/queue-custody";

export function nextDeliverable(
  ledger: RelayLedger,
  conversationId: string
) {
  return ledger.readConversation(conversationId, ({ relays, manualIntents }) => {
    const candidates = [
      ...relays
        .filter((relay) => relay.deliveryPhase !== "settled")
        .map((relay) => ({
          kind: "relay" as const,
          id: relay.id,
          sequence: relay.sequence,
          createdAt: relay.createdAt,
          relay,
        })),
      ...manualIntents
        .filter((intent) => !["settled", "failed"].includes(intent.phase) &&
          !(intent.phase === "queued" && !intent.preparing && !intent.queueClaim && ledger.read(state => sourceQueuePaused(state, intent))))
        .map((intent) => ({
          kind: "manual" as const,
          id: intent.id,
          sequence: intent.sequence,
          createdAt: intent.createdAt,
          intent,
        })),
    ].sort(
      (left, right) =>
        left.sequence - right.sequence ||
        left.createdAt - right.createdAt ||
        left.id.localeCompare(right.id)
    );
    return candidates[0] ? structuredClone(candidates[0]) : null;
  });
}

export function isRunnableDeliverable(
  deliverable: ReturnType<typeof nextDeliverable>
) {
  return deliverable?.kind === "manual"
    ? !deliverable.intent.queueClaim && ["queued", "appended"].includes(deliverable.intent.phase)
    : Boolean(
        deliverable &&
        ["queued", "appended"].includes(deliverable.relay.deliveryPhase)
      );
}

export function blockedReceiptFor(
  ledger: RelayLedger,
  conversationId: string
) {
  const head = nextDeliverable(ledger, conversationId);
  if (head?.kind !== "relay") return {};
  return {
    blockedBy: isRunnableDeliverable(head)
      ? "relay-queue" as const
      : "chain-paused" as const,
  };
}

/* ledger 侧活性的唯一口径——协调器的 hasDurableActiveTurn 与 releaseRunningIfIdle
   共用，禁止再出现第二份「claimed 算不算活」的判断。
   只看 deliveryPhase 非终态：settled 保留 charged 记账（费用已花不退），
   用 reservationState 判活会把正常完成的终态误判成活动 turn。
   manual 的 claimed+unknown 是死亡证明（结果通道已断，无执行者能交付），
   不算活——否则它既占死 running 堵住队列，也永远挡住归档；
   由 failArchived 在归档时收敛为 failed 终态。 */
export function ledgerHasLiveTurn(ledger: RelayLedger, conversationId: string) {
  return ledger.readConversation(
    conversationId,
    ({ relays, manualIntents }) =>
      relays.some((relay) =>
        ["claimed", "answered", "replyEnqueued"].includes(
          relay.deliveryPhase
        )
      ) ||
      manualIntents.some(
        (intent) =>
          intent.phase === "claimed" &&
          intent.attempts.at(-1)?.phase !== "unknown"
      )
  );
}
