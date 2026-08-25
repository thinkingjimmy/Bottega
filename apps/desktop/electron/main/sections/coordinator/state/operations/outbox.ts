/**
 * [INPUT]: Depends on the ledger v6 manual/steer schema and mutable LedgerState draft
 * [OUTPUT]: Provides seq/ only terminal ack/outbox phase, prepared reservation staging owner with steer→manual Atom mutation
 * [POS]: The manual/steer mutation of the coordinator/state; IO and index submitted by RelayLedger packaging
 */

import {
  manualIntentSchema,
  steerIntentSchema,
  type LedgerState,
  type ManualTurnIntentInput,
  type SteerIntent,
} from "../ledger-schema";
import type { DeepReadonly } from "../readonly-ledger";
import { installSubmissionCustody } from "../../submission-outcome";

export function stagingOwner(payload: unknown, fallback: string) {
  const directory =
    payload && typeof payload === "object"
      ? (payload as { stagingDir?: unknown }).stagingDir
      : undefined;
  if (typeof directory !== "string" || !directory) return fallback;
  return directory.split(/[\\/]/).filter(Boolean).at(-1) ?? fallback;
}

export function bindManualSequences(
  state: LedgerState,
  intentId: string,
  userSeq: number,
  assistantSeq: number
) {
  const intent = state.manualIntents[intentId];
  if (!intent) return null;
  if (
    intent.userSeq !== undefined &&
    (intent.userSeq !== userSeq || intent.assistantSeq !== assistantSeq)
  ) {
    throw new Error("ManualTurnIntent 消息序号与既有绑定冲突");
  }
  intent.userSeq = userSeq;
  intent.assistantSeq = assistantSeq;
  return intent;
}

export function bindRelaySequences(
  state: LedgerState,
  relayId: string,
  userSeq: number,
  assistantSeq: number
) {
  const relay = state.relays[relayId];
  if (!relay) return null;
  if (
    relay.userSeq !== undefined &&
    (relay.userSeq !== userSeq || relay.assistantSeq !== assistantSeq)
  ) {
    throw new Error("Relay 消息序号与既有绑定冲突");
  }
  relay.userSeq = userSeq;
  relay.assistantSeq = assistantSeq;
  return relay;
}

export function ackManualIntents(
  state: LedgerState,
  intentIds: readonly string[],
  now: number
) {
  let changed = 0;
  for (const intentId of new Set(intentIds)) {
    const intent = state.manualIntents[intentId];
    if (intent?.ackedAt === undefined) {
      intent.ackedAt = now;
      changed += 1;
    }
  }
  return changed;
}

export function putSteerIntent(state: LedgerState, input: SteerIntent) {
  const intent = steerIntentSchema.parse(input);
  const existing = state.steerIntents[intent.outboxRef];
  if (existing) {
    if (existing.envelopeHash !== intent.envelopeHash) {
      throw new Error("Steer outboxRef 与既有 payload 冲突");
    }
    return existing;
  }
  state.steerIntents[intent.outboxRef] = intent;
  return intent;
}

export function transitionSteer(
  state: LedgerState,
  outboxRef: string,
  expected: SteerIntent["phase"] | SteerIntent["phase"][],
  phase: SteerIntent["phase"],
  opEpoch: number,
  patch: Partial<Pick<SteerIntent, "turnTerminalAt" | "reason">>,
  now: number
) {
  const current = state.steerIntents[outboxRef];
  if (!current || current.opEpoch !== opEpoch) return null;
  const phases = Array.isArray(expected) ? expected : [expected];
  if (!phases.includes(current.phase)) return null;
  const terminal =
    phase === "persisted" ||
    phase === "transferred" ||
    phase === "dismissed" ||
    phase === "failed";
  const next = steerIntentSchema.parse({
    ...current,
    ...patch,
    phase,
    ...(terminal ? { terminalAt: now } : {}),
  });
  state.steerIntents[outboxRef] = next;
  return next;
}

export function transferSteerToManual(
  state: LedgerState,
  outboxRef: string,
  opEpoch: number,
  manual: ManualTurnIntentInput,
  now: number
) {
  const steer = state.steerIntents[outboxRef];
  if (
    !steer ||
    steer.opEpoch !== opEpoch ||
    !["journaled", "awaitingDecision", "failed"].includes(steer.phase)
  ) {
    return null;
  }
  const intent =
    state.manualIntents[manual.id] ??
    manualIntentSchema.parse({ ...manual, sequence: state.nextSequence++ });
  state.manualIntents[intent.id] = intent;
  // 派生的 manual intent 与直接提交同权：必须同时安装 reservation/
  // outcome custody，否则 settle/恢复路径会踩到缺失的 reservation。
  installSubmissionCustody(state, intent, now);
  state.steerIntents[outboxRef] = steerIntentSchema.parse({
    ...steer,
    phase: "transferred",
    terminalAt: now,
  });
  return { steer: state.steerIntents[outboxRef]!, manual: intent };
}

export function markSteerTurnTerminal(
  state: LedgerState,
  requestId: string,
  now: number
) {
  const changed: SteerIntent[] = [];
  for (const intent of Object.values(state.steerIntents)) {
    if (intent.requestId !== requestId || intent.turnTerminalAt !== undefined) {
      continue;
    }
    intent.turnTerminalAt = now;
    changed.push(structuredClone(intent));
  }
  return changed;
}

export function ackSteerIntents(
  state: LedgerState,
  outboxRefs: readonly string[],
  now: number
) {
  let changed = 0;
  for (const outboxRef of new Set(outboxRefs)) {
    const intent = state.steerIntents[outboxRef];
    if (
      intent &&
      !["persisted", "transferred", "dismissed", "failed"].includes(
        intent.phase
      )
    ) {
      throw new Error(`Steer ${outboxRef} 尚未终结，拒绝 ACK`);
    }
    if (intent?.ackedAt === undefined) {
      intent.ackedAt = now;
      changed += 1;
    }
  }
  return changed;
}

export function liveStagingOwners(state: DeepReadonly<LedgerState>) {
  return new Set([
    ...Object.values(state.submissionReservations)
      .filter(
        (reservation) =>
          reservation.state === "reserved" &&
          reservation.payload !== undefined
      )
      .map((reservation) =>
        stagingOwner(
          reservationPayloadValue(reservation.payload),
          reservation.intentId
        )
      ),
    ...Object.values(state.manualIntents)
      .filter((intent) => intent.payload !== undefined)
      .map((intent) => stagingOwner(intent.payload, intent.id)),
    ...Object.values(state.steerIntents)
      .filter(
        (intent) =>
          intent.ackedAt === undefined ||
          (intent.phase === "persisted" && intent.turnTerminalAt === undefined)
      )
      .map((intent) => stagingOwner(intent.stagedSnapshot, intent.outboxRef)),
  ]);
}

function reservationPayloadValue(payload: unknown) {
  return payload &&
    typeof payload === "object" &&
    "kind" in payload &&
    payload.kind === "intent" &&
    "value" in payload
    ? payload.value
    : payload;
}
