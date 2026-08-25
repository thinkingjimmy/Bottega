/**
 * [INPUT]: Depends on PauseSaga action/outbox Atomic solidification and chain/relay reservation structure
 * [OUTPUT]: Provides continueChainBudget, in durable sequence, to set a row and create the next action for the remaining item
 * [POS]: The ChainBudget pure state unit of the coordinator/state; Submit the quantity, epoch, relay attempt with the next pause window
 */

import {
  freezePause,
  settleAction,
  type RelayActionRecord,
} from "./pause-saga";

type BudgetRelay = {
  id: string;
  rootChainId: string;
  source: { chatId: string };
  target: { chatId: string };
  createdAt: number;
  sequence: number;
  deliveryPhase:
    | "reserved"
    | "queued"
    | "appended"
    | "claimed"
    | "answered"
    | "replyEnqueued"
    | "settled";
  pauseEpoch: number;
  pauseReason?: "budget" | "chain-paused" | "startup-recovered";
  reservationState: "waiting" | "held" | "charged" | "released";
  attempts: Array<{
    attemptNo: number;
    admittedEpoch: number;
    reservationState: "waiting" | "held" | "charged" | "released";
  }>;
};

type BudgetState = {
  chains: Record<
    string,
    {
      id: string;
      used: number;
      limit: number;
      pauseEpoch: number;
      paused: boolean;
    }
  >;
  relays: Record<string, BudgetRelay>;
  actions: Record<string, RelayActionRecord>;
  noticeOutbox: Record<
    string,
    {
      id: string;
      chatId: string;
      message: unknown;
      state: "pending" | "appended";
    }
  >;
};

export function continueChainBudget(
  state: BudgetState,
  rootChainId: string,
  expectedPauseEpoch: number,
  now = Date.now()
) {
  const chain = state.chains[rootChainId];
  if (!chain || chain.pauseEpoch !== expectedPauseEpoch || !chain.paused) {
    return "stale" as const;
  }
  settleAction(state, rootChainId, expectedPauseEpoch, "continued", now);
  chain.pauseEpoch += 1;
  chain.used = 0;
  const waiting = Object.values(state.relays)
    .filter(
      (relay) =>
        relay.rootChainId === rootChainId &&
        relay.reservationState === "waiting"
    )
    .sort(
      (left, right) =>
        left.sequence - right.sequence || left.id.localeCompare(right.id)
    );
  for (const relay of waiting) {
    const available = chain.limit === 0 || chain.used < chain.limit;
    relay.pauseEpoch = chain.pauseEpoch;
    relay.attempts.at(-1)!.admittedEpoch = chain.pauseEpoch;
    if (available) {
      chain.used += 1;
      relay.deliveryPhase = "queued";
      relay.reservationState = "held";
      relay.attempts.at(-1)!.reservationState = "held";
      delete relay.pauseReason;
      continue;
    }
    relay.deliveryPhase = "reserved";
    relay.pauseReason = "budget";
  }
  const remaining = waiting.find(
    (relay) => relay.reservationState === "waiting"
  );
  chain.paused = Boolean(remaining);
  if (remaining) freezePause(state, remaining, "chain-paused", now);
  return "continued" as const;
}
