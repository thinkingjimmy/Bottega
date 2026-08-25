/**
 * [INPUT]: Depends on RelayLedger conversation The index reads only selector, conversationId and durable sequence
 * [OUTPUT]: Provides nextDeliverable and isRunnableDeliverable
 * [POS]: The first selector of the pure group of sections/coordinator/scheduler; All non-terminal projects involved in FIFO, separated by execution qualification and order
 */

import type { RelayLedger } from "../relay-ledger";

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
        .filter((intent) => !["settled", "failed"].includes(intent.phase))
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
    ? ["queued", "appended"].includes(deliverable.intent.phase)
    : Boolean(
        deliverable &&
        ["queued", "appended"].includes(deliverable.relay.deliveryPhase)
      );
}
