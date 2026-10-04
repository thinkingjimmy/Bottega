/**
 * [INPUT]: Ledger state, stable action IDs, pause rules and strict create-intent schema.
 * [OUTPUT]: ensurePausedActions and putCreateIntent pure draft mutations.
 * [POS]: Coordinator ledger admission rules; the writer retains the sole commit queue.
 */
import { stableId } from "../../coordinator-values";
import { freezePause } from "../pause-saga";
import { createIntentSchema, type CreateIntent, type LedgerState } from "../ledger-schema";

export function ensurePausedActions(state: LedgerState, now: number) {
      for (const chain of Object.values(state.chains)) {
        if (!chain.paused) continue;
        const actionId = stableId(
          "action",
          `${chain.id}:${chain.pauseEpoch}`
        );
        if (state.actions[actionId]) continue;
        const waiting = Object.values(state.relays)
          .filter(
            (relay) =>
              relay.rootChainId === chain.id &&
              relay.reservationState === "waiting"
          )
          .sort(
            (left, right) =>
              left.sequence - right.sequence ||
              left.id.localeCompare(right.id)
          )[0];
        if (!waiting) continue;
        freezePause(
          state,
          waiting,
          waiting.pauseReason === "startup-recovered"
            ? "startup-recovered"
            : "chain-paused",
          now
        );
      }
}

export function putCreateIntent(state: LedgerState, intent: CreateIntent) {
      const existing = state.createIntents[intent.id];
      if (existing) {
        if (
          intent.mode === "seed" &&
          (existing.mode !== "seed" ||
            existing.parameterDigest !== intent.parameterDigest)
        ) {
          throw Object.assign(
            new Error("同一回合的 promote 参数与已入账 intent 冲突"),
            { status: 409 }
          );
        }
        return existing;
      }
      state.createIntents[intent.id] = createIntentSchema.parse(intent);
      return state.createIntents[intent.id]!;
}
