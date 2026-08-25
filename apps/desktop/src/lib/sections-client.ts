/**
 * [INPUT]: Depends on shared Sections IPC and preload window.sections
 * [OUTPUT]: Provides artificial admission, durable outcome query/ACK/events, chain action and browser obvious degradation
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

export const submitManualTurn = (input: ManualTurnSubmission) =>
  window.sections?.submitManualTurn(input) ?? null;

export const cancelManualTurn = (requestId: string) =>
  window.sections?.cancelManualTurn(requestId) ?? Promise.resolve();

export const ackManualIntents = (intentIds: string[]) =>
  window.sections?.ackManualIntents(intentIds) ?? Promise.resolve();

export const ackSubmissionOutcome = (input: SubmissionAck) =>
  window.sections?.ackSubmission?.(input) ?? Promise.resolve();

export const getSubmissionOutcome = (
  intentId: string
): Promise<SubmissionOutcome> =>
  window.sections?.submissionOutcome?.(intentId) ??
  Promise.resolve({
    kind: "notFound",
    intentId,
    revision: 0,
    // 无 bridge 的降级环境查不到 fence，绝不能伪造 absent 安全负证明。
    reservation: "unknown",
  });

export function subscribeSubmissionOutcomes(
  listener: (outcome: SubmissionOutcome) => void
) {
  return window.sections?.onSubmissionOutcome?.(listener) ?? (() => undefined);
}

export const stopRelayChain = (requestId: string) =>
  window.sections?.stopRelayChain(requestId) ??
  Promise.resolve("not-relay" as const);

export const continueRelay = (input: RelayActionInput) =>
  window.sections?.continueRelay(input) ?? Promise.resolve("stale" as const);

export const discardRelay = (input: RelayActionInput) =>
  window.sections?.discardRelay(input) ?? Promise.resolve("stale" as const);

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
  const bridge = window.sections;
  if (!bridge) {
    publishActions({ revision: 0, actions: {} });
    return;
  }
  bridge.onActionsEvent(publishActions);
  void bridge
    .actionsSnapshot()
    .then(publishActions)
    .catch(() => publishActions({ revision: 0, actions: {} }));
}

function publishActions(snapshot: RelayActionsSnapshot) {
  if (actions && snapshot.revision < actions.revision) return;
  actions = snapshot;
  for (const listener of actionListeners) listener(snapshot);
}
