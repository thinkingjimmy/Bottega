/**
 * [INPUT]: Depends on the ledger schema, PauseSaga and the mutable LedgerState draft
 * [OUTPUT]: Provides relay access, phase/CAS, release, reply to complete, start recovery, chain discard and sequence into a pure mutation
 * [POS]: The coordinator/state's relay is pure mutation; No enduring, indexing or revision
 */

import { freezePause, settleAction } from "../pause-saga";
import {
  relaySchema,
  type LedgerState,
  type RelayAdmissionInput,
  type RelayExpectation,
  type RelayRecord,
  type SectionRef,
} from "../ledger-schema";

export const legalRelayTransitions: Record<
  RelayRecord["deliveryPhase"],
  RelayRecord["deliveryPhase"][]
> = {
  reserved: ["queued", "settled"],
  queued: ["appended", "settled"],
  appended: ["claimed", "settled"],
  claimed: ["answered", "settled"],
  answered: ["replyEnqueued", "settled"],
  replyEnqueued: ["settled"],
  settled: [],
};

function sameRef(left: SectionRef, right: SectionRef) {
  return (
    left.chatId === right.chatId &&
    left.incarnationId === right.incarnationId
  );
}

export function matchesExpectation(
  relay: RelayRecord,
  expected: RelayExpectation
) {
  const phases = Array.isArray(expected.deliveryPhase)
    ? expected.deliveryPhase
    : [expected.deliveryPhase];
  return (
    phases.includes(relay.deliveryPhase) &&
    relay.pauseEpoch === expected.pauseEpoch &&
    relay.attempts.at(-1)?.attemptNo === expected.attemptNo &&
    sameRef(relay.source, expected.source) &&
    sameRef(relay.target, expected.target)
  );
}

export function normalizeSequences(state: LedgerState) {
  const records = [
    ...Object.values(state.relays),
    ...Object.values(state.manualIntents),
  ];
  for (const relay of Object.values(state.relays)) {
    relay.attempts.at(-1)!.reservationState = relay.reservationState;
  }
  let next = Math.max(
    state.nextSequence,
    ...records.map((record) => record.sequence + 1)
  );
  for (const record of records
    .filter((item) => item.sequence === 0)
    .sort(
      (left, right) =>
        left.createdAt - right.createdAt || left.id.localeCompare(right.id)
    )) {
    record.sequence = next++;
  }
  state.nextSequence = next;
  return state;
}

export function admitRelay(
  state: LedgerState,
  input: RelayAdmissionInput,
  now: number
) {
  const existing = state.relays[input.id];
  if (existing) return existing;
  const { limit, ...relayInput } = input;
  const chain = state.chains[input.rootChainId] ?? {
    id: input.rootChainId,
    used: 0,
    limit,
    pauseEpoch: 0,
    paused: false,
  };
  state.chains[chain.id] = chain;
  const available =
    !chain.paused && (chain.limit === 0 || chain.used < chain.limit);
  if (available) chain.used += 1;
  else if (!chain.paused) {
    chain.paused = true;
    chain.pauseEpoch += 1;
  }
  const relay = relaySchema.parse({
    ...relayInput,
    sequence: state.nextSequence++,
    deliveryPhase: available ? "queued" : "reserved",
    pauseEpoch: chain.pauseEpoch,
    ...(available ? {} : { pauseReason: "budget" }),
    replyDisposition: input.expectReply ? "expected" : "none",
    reservationState: available ? "held" : "waiting",
    attempts: [{
      attemptNo: 1,
      requestId: input.requestId,
      admittedEpoch: chain.pauseEpoch,
      reservationState: available ? "held" : "waiting",
    }],
  });
  state.relays[relay.id] = relay;
  if (relay.reservationState === "waiting") {
    freezePause(state, relay, "chain-paused", now);
  }
  return relay;
}

export function transitionRelay(
  state: LedgerState,
  relayId: string,
  expected: RelayExpectation,
  patch: Partial<
    Pick<
      RelayRecord,
      | "deliveryPhase"
      | "pauseEpoch"
      | "pauseReason"
      | "terminalOutcome"
      | "replyDisposition"
      | "reservationState"
      | "attempts"
      | "assistantOutbox"
    >
  >,
  now: number
) {
  const current = state.relays[relayId];
  if (!current) throw new Error("Relay 不存在");
  if (!matchesExpectation(current, expected)) return null;
  if (
    patch.deliveryPhase &&
    patch.deliveryPhase !== current.deliveryPhase &&
    !legalRelayTransitions[current.deliveryPhase].includes(
      patch.deliveryPhase
    )
  ) {
    throw new Error(
      `Relay 非法转换：${current.deliveryPhase} → ${patch.deliveryPhase}`
    );
  }
  const next = relaySchema.parse({
    ...current,
    ...patch,
    ...(patch.deliveryPhase === "settled" ? { terminalAt: now } : {}),
  });
  state.relays[relayId] = next;
  return next;
}

export function releaseRelay(
  state: LedgerState,
  relayId: string,
  expected: RelayExpectation,
  terminalOutcome: "failed" | "cancelled",
  now: number
) {
  const current = state.relays[relayId];
  if (!current) throw new Error("Relay 不存在");
  if (!matchesExpectation(current, expected)) return null;
  if (!["waiting", "held"].includes(current.reservationState)) {
    throw new Error("只有未 claim reservation 可以释放");
  }
  const chain = state.chains[current.rootChainId];
  if (!chain) throw new Error("Relay chain 不存在");
  if (current.reservationState === "held") {
    chain.used = Math.max(0, chain.used - 1);
  }
  const attempts = structuredClone(current.attempts);
  attempts.at(-1)!.reservationState = "released";
  const next = relaySchema.parse({
    ...current,
    deliveryPhase: "settled",
    terminalOutcome,
    replyDisposition: "suppressed",
    reservationState: "released",
    attempts,
    terminalAt: now,
  });
  state.relays[relayId] = next;
  return next;
}

export function completeAnsweredRelay(
  state: LedgerState,
  relayId: string,
  expected: RelayExpectation,
  reply: RelayAdmissionInput | undefined,
  now: number
) {
  const current = state.relays[relayId];
  if (!current) throw new Error("Relay 不存在");
  if (!matchesExpectation(current, expected)) {
    return { status: "stale" as const };
  }
  if (current.deliveryPhase !== "answered") {
    throw new Error("只有 answered relay 可以完成回信 saga");
  }
  const admitted = reply ? admitRelay(state, reply, now) : undefined;
  const next = relaySchema.parse({
    ...current,
    deliveryPhase: "settled",
    terminalOutcome: "done",
    terminalAt: now,
    ...(admitted ? { replyDisposition: "enqueued" } : {}),
  });
  state.relays[relayId] = next;
  return {
    status: "completed" as const,
    relay: next,
    ...(admitted ? { reply: admitted } : {}),
  };
}

export function recoverClaimedRelay(
  state: LedgerState,
  relayId: string,
  expected: RelayExpectation,
  retry: { requestId: string; assistantMessageId: string },
  now: number
) {
  const current = state.relays[relayId];
  if (!current) throw new Error("Relay 不存在");
  if (!matchesExpectation(current, expected)) return null;
  if (current.deliveryPhase !== "claimed") {
    throw new Error("只有 claimed relay 可以生成恢复 attempt");
  }
  const chain = state.chains[current.rootChainId];
  if (!chain) throw new Error("Relay chain 不存在");
  chain.paused = true;
  chain.pauseEpoch += 1;
  const attemptNo = current.attempts.at(-1)!.attemptNo + 1;
  const candidate: Record<string, unknown> = {
    ...current,
    deliveryPhase: "reserved",
    pauseEpoch: chain.pauseEpoch,
    pauseReason: "startup-recovered",
    reservationState: "waiting",
    requestId: retry.requestId,
    assistantMessageId: retry.assistantMessageId,
    attempts: [
      ...current.attempts,
      {
        attemptNo,
        requestId: retry.requestId,
        admittedEpoch: chain.pauseEpoch,
        reservationState: "waiting",
      },
    ],
  };
  delete candidate.terminalOutcome;
  delete candidate.assistantOutbox;
  const next = relaySchema.parse(candidate);
  state.relays[relayId] = next;
  freezePause(state, next, "startup-recovered", now);
  return next;
}

export function discardChain(
  state: LedgerState,
  rootChainId: string,
  expectedPauseEpoch: number,
  now: number
) {
  const chain = state.chains[rootChainId];
  if (!chain || chain.pauseEpoch !== expectedPauseEpoch) {
    return "stale" as const;
  }
  settleAction(state, rootChainId, expectedPauseEpoch, "discarded", now);
  chain.paused = true;
  chain.pauseEpoch += 1;
  for (const relay of Object.values(state.relays)) {
    if (
      relay.rootChainId !== rootChainId ||
      relay.deliveryPhase === "settled"
    ) {
      continue;
    }
    relay.deliveryPhase = "settled";
    relay.terminalOutcome = "cancelled";
    relay.replyDisposition = "suppressed";
    relay.pauseEpoch = chain.pauseEpoch;
    relay.reservationState =
      relay.reservationState === "charged" ? "charged" : "released";
    relay.attempts.at(-1)!.reservationState = relay.reservationState;
    relay.terminalAt = now;
  }
  return "discarded" as const;
}
