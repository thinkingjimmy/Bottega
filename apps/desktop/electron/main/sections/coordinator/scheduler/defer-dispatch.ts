/**
 * [INPUT]: Depends on Durable manual/relay ledger state and an attempt proven not to have started.
 * [OUTPUT]: Provides attempt rollback that preserves durable intent, queued custody, staging, and held quota.
 * [POS]: Coordinator ledger transition for startup holds; no synthetic failure or duplicate message is recorded.
 */
import type { LedgerState } from "../state/ledger-schema";
export function deferManualDispatch(state: LedgerState, intentId: string, now: number) {
      const intent = state.manualIntents[intentId];
      const attempt = intent?.attempts.at(-1);
      if (intent?.phase !== "claimed" || !attempt ||
          !["claimed", "dispatching"].includes(attempt.phase)) throw new Error("MANUAL_DEFER_CONFLICT");
      // No executor was registered: remove only this attempt, preserving durable custody.
      intent.attempts.pop();
      intent.phase = "appended";
      const outcome = state.submissionOutcomes[intentId];
      if (outcome) Object.assign(outcome, { phase: "appended", custody: "chat-persisted", retry: "safe", updatedAt: now, revision: outcome.revision + 1 });
}
export function deferRelayDispatch(state: LedgerState, relayId: string) {
      const relay = state.relays[relayId];
      if (relay?.deliveryPhase !== "claimed") throw new Error("RELAY_DEFER_CONFLICT");
      relay.deliveryPhase = "appended";
      relay.reservationState = "held";
      const attempt = relay.attempts.at(-1);
      if (attempt) attempt.reservationState = "held";
}
