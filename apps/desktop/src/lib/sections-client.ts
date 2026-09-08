/**
 * [INPUT]: Depends on shared Sections IPC and the preload-exposed window.sections bridge
 * [OUTPUT]: Provides manual-turn admission, durable outcome query/ACK/events and relay chain actions; throws when the bridge is absent
 * [POS]: Conversation Coordinator is the only export of renderer lib
 */

import type {
  ManualTurnSubmission,
  RelayActionInput,
  RelayActionsSnapshot,
  SectionsBridgeApi,
} from "../../shared/sections-ipc";
import type {
  SubmissionAck,
  SubmissionOutcome,
} from "../../shared/submission";

declare global {
  interface Window {
    sections?: SectionsBridgeApi;
  }
}

const bridge = (): SectionsBridgeApi => {
  const api = window.sections;
  if (!api) throw new Error("sections bridge unavailable");
  return api;
};

export const submitManualTurn = (input: ManualTurnSubmission) =>
  bridge().submitManualTurn(input);

export const cancelManualTurn = (requestId: string) =>
  bridge().cancelManualTurn(requestId);

export const ackManualIntents = (intentIds: string[]) =>
  bridge().ackManualIntents(intentIds);

export const ackSubmissionOutcome = (input: SubmissionAck) =>
  bridge().ackSubmission(input);

export const getSubmissionOutcome = (intentId: string) =>
  bridge().submissionOutcome(intentId);

export const subscribeSubmissionOutcomes = (
  listener: (outcome: SubmissionOutcome) => void
) => bridge().onSubmissionOutcome(listener);

export const stopRelayChain = (requestId: string) =>
  bridge().stopRelayChain(requestId);

export const continueRelay = (input: RelayActionInput) =>
  bridge().continueRelay(input);

export const discardRelay = (input: RelayActionInput) =>
  bridge().discardRelay(input);

let actions: RelayActionsSnapshot | null = null;
let actionsStarted = false;
const actionListeners = new Set<
  (snapshot: RelayActionsSnapshot) => void
>();

export function subscribeRelayActions(
  listener: (snapshot: RelayActionsSnapshot) => void
) {
  actionListeners.add(listener);
  if (actions) listener(actions);
  startActionProjection();
  return () => {
    actionListeners.delete(listener);
  };
}

function startActionProjection() {
  if (actionsStarted) return;
  actionsStarted = true;
  const api = bridge();
  api.onActionsEvent(publishActions);
  void api
    .actionsSnapshot()
    .then(publishActions)
    .catch(() => publishActions({ revision: 0, actions: {} }));
}

function publishActions(snapshot: RelayActionsSnapshot) {
  if (actions && snapshot.revision < actions.revision) return;
  actions = snapshot;
  for (const listener of actionListeners) listener(snapshot);
}
