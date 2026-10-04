/**
 * [INPUT]: Depends on lifecycle intent identities and the relay ledger's manual intents and submission reservations.
 * [OUTPUT]: Provides relayOwnsIntent (whether the relay journal still owns an intent's Chat Home) and chatHomeLiveness (an async refresh of
 *           pending lifecycle owners plus a synchronous verdict on the current relay state), so compensation cannot race creation.
 * [POS]: Chat Home recovery policy boundary; prevents one durable journal from compensating work still owned by another journal (R01).
 */

import type { LifecycleIntent } from "../lifecycle/intent-types";

const CHAT_HOME_LIFECYCLE_KINDS = new Set<LifecycleIntent["kind"]>([
  "chat-slot",
  "chat-materialize",
]);
const LIVE_PHASES = new Set(["queued", "appended", "claimed"]);

export type RelayLiveState = Readonly<{
  manualIntents: Readonly<Record<string, { phase: string }>>;
  submissionReservations: Readonly<Record<string, { state: string }>>;
}>;
type LifecycleOwner = Pick<LifecycleIntent, "intentId" | "kind" | "terminal">;

/**
 * R01: a Home is still owned while its submission is in flight. A raw reservation exists from before `beginCreation` until it is admitted
 * or released; an admitted one counts only while its manual intent is live, or absent (the prepare → promote gap). A finished intent or a
 * released reservation protects nothing, so its uncommitted Home is reclaimed.
 */
export function relayOwnsIntent(state: RelayLiveState, intentId: string) {
  const intent = state.manualIntents[intentId];
  if (intent && LIVE_PHASES.has(intent.phase)) return true;
  const reservation = state.submissionReservations[intentId];
  return reservation?.state === "reserved" || (reservation?.state === "admitted" && !intent);
}

export type ChatHomeLiveness = Readonly<{
  /** Re-reads the pending lifecycle owners; awaited before each verdict. */
  refresh(): Promise<void>;
  /** Synchronous, on the relay ledger as it is now: the last step before a commit or rollback, with no await in between. */
  live(intentId: string): boolean;
}>;
export function chatHomeLiveness(ports: Readonly<{ relay(): RelayLiveState; lifecycle(): Promise<Iterable<LifecycleOwner>> }>): ChatHomeLiveness {
  let owners = new Set<string>();
  return {
    async refresh() {
      owners = new Set([...await ports.lifecycle()].filter(intent => !intent.terminal && CHAT_HOME_LIFECYCLE_KINDS.has(intent.kind)).map(intent => intent.intentId));
    },
    live: intentId => owners.has(intentId) || relayOwnsIntent(ports.relay(), intentId),
  };
}
