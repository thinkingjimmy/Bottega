/**
 * [INPUT]: Depends on the durable state of the ledger-schema, terminal time and the constants of the unified retained window
 * [OUTPUT]: Provides normalize TerminalTimes with compactLedgerState, by reference to achievable local mark-and-sweep
 * [POS]: The coordinator/state is a pure compaction unit; No executIOn of IO file, no speculation of side effects completed status
 */

import type { RelayActionRecord } from "./pause-saga";
import {
  TERMINAL_RETAIN_PER_GROUP,
  TERMINAL_RETENTION_MS,
  TOMBSTONE_RETENTION_MS,
  type CreateIntent,
  type LedgerState,
  type ManualTurnIntent,
  type RelayRecord,
  type SteerIntent,
} from "./ledger-schema";

type TerminalRecord = { id: string; terminalAt?: number };
type SettledAction = RelayActionRecord & { settledAt?: number };

const relayTerminal = (relay: RelayRecord) =>
  relay.deliveryPhase === "settled";
const manualTerminal = (intent: ManualTurnIntent) =>
  intent.phase === "settled" || intent.phase === "failed";
const createTerminal = (intent: CreateIntent) =>
  intent.sagaPhase === "done" || intent.sagaPhase === "failed";
const steerTerminal = (intent: SteerIntent) =>
  ["persisted", "transferred", "dismissed", "failed"].includes(intent.phase);

export function normalizeTerminalTimes(state: LedgerState, now: number) {
  for (const relay of Object.values(state.relays)) {
    if (relayTerminal(relay) && relay.terminalAt === undefined) {
      relay.terminalAt = now;
    }
  }
  for (const intent of Object.values(state.manualIntents)) {
    if (manualTerminal(intent) && intent.terminalAt === undefined) {
      intent.terminalAt = now;
    }
  }
  for (const intent of Object.values(state.steerIntents)) {
    if (steerTerminal(intent) && intent.terminalAt === undefined) {
      intent.terminalAt = now;
    }
  }
  for (const intent of Object.values(state.createIntents)) {
    if (createTerminal(intent) && intent.terminalAt === undefined) {
      intent.terminalAt = now;
    }
  }
  for (const action of Object.values(state.actions)) {
    if (action.state !== "active" && action.settledAt === undefined) {
      action.settledAt = now;
    }
  }
}

function retainedByGroup<T extends TerminalRecord>(
  records: readonly T[],
  groupOf: (record: T) => string,
  now: number
) {
  const retained = new Set<string>();
  const groups = new Map<string, T[]>();
  for (const record of records) {
    if (
      record.terminalAt !== undefined &&
      record.terminalAt >= now - TERMINAL_RETENTION_MS
    ) {
      retained.add(record.id);
    }
    const group = groupOf(record);
    const values = groups.get(group) ?? [];
    values.push(record);
    groups.set(group, values);
  }
  for (const values of groups.values()) {
    values
      .sort(
        (left, right) =>
          (right.terminalAt ?? 0) - (left.terminalAt ?? 0) ||
          right.id.localeCompare(left.id)
      )
      .slice(0, TERMINAL_RETAIN_PER_GROUP)
      .forEach((record) => retained.add(record.id));
  }
  return retained;
}

function retainedActions(
  actions: readonly SettledAction[],
  now: number
) {
  return retainedByGroup(
    actions.map((action) => ({
      ...action,
      id: action.actionId,
      terminalAt: action.settledAt,
    })),
    (action) => action.rootChainId,
    now
  );
}

function noticeActionId(message: unknown) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    return undefined;
  }
  const notice = (message as { notice?: unknown }).notice;
  if (!notice || typeof notice !== "object" || Array.isArray(notice)) {
    return undefined;
  }
  const actionId = (notice as { actionId?: unknown }).actionId;
  return typeof actionId === "string" ? actionId : undefined;
}

/**
 * Roots 先覆盖所有非终态、active/pending 与保留窗；随后沿 durable 引用扩散。
 * 调用方传入已独占的 draft，本函数只做确定性内存变换。
 */
export function compactLedgerState(state: LedgerState, now: number) {
  const markedRelays = retainedByGroup(
    Object.values(state.relays).filter(relayTerminal),
    (relay) => relay.rootChainId,
    now
  );
  const markedManuals = retainedByGroup(
    Object.values(state.manualIntents).filter(manualTerminal),
    (intent) => intent.conversationId,
    now
  );
  const markedCreates = retainedByGroup(
    Object.values(state.createIntents).filter(createTerminal),
    (intent) => intent.rootChainId,
    now
  );
  const markedSteers = retainedByGroup(
    Object.values(state.steerIntents)
      .filter(steerTerminal)
      .map((intent) => ({ ...intent, id: intent.outboxRef })),
    (intent) => intent.conversationId,
    now
  );
  const markedActions = retainedActions(
    Object.values(state.actions).filter((action) => action.state !== "active"),
    now
  );
  const markedNotices = new Set<string>();
  const markedChains = new Set<string>();

  for (const relay of Object.values(state.relays)) {
    if (!relayTerminal(relay)) markedRelays.add(relay.id);
  }
  for (const intent of Object.values(state.manualIntents)) {
    if (
      !manualTerminal(intent) ||
      intent.ackedAt === undefined ||
      intent.submissionHash === undefined
    ) {
      markedManuals.add(intent.id);
    }
  }
  for (const intent of Object.values(state.steerIntents)) {
    if (!steerTerminal(intent) || intent.ackedAt === undefined) {
      markedSteers.add(intent.outboxRef);
    }
  }
  for (const intent of Object.values(state.createIntents)) {
    if (!createTerminal(intent)) markedCreates.add(intent.id);
  }
  for (const action of Object.values(state.actions)) {
    if (action.state === "active") markedActions.add(action.actionId);
  }
  for (const outbox of Object.values(state.noticeOutbox)) {
    if (outbox.state === "pending") markedNotices.add(outbox.id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const actionId of markedActions) {
      const action = state.actions[actionId];
      if (!action || action.state !== "active") continue;
      for (const outbox of Object.values(state.noticeOutbox)) {
        if (
          noticeActionId(outbox.message) === actionId &&
          !markedNotices.has(outbox.id)
        ) {
          markedNotices.add(outbox.id);
          changed = true;
        }
      }
    }
    for (const relayId of markedRelays) {
      const relay = state.relays[relayId];
      if (!relay) continue;
      if (!markedChains.has(relay.rootChainId)) {
        markedChains.add(relay.rootChainId);
        changed = true;
      }
      for (const intent of Object.values(state.createIntents)) {
        if (
          intent.mode === "run" &&
          intent.relayId === relayId &&
          !markedCreates.has(intent.id)
        ) {
          markedCreates.add(intent.id);
          changed = true;
        }
      }
    }
    for (const intentId of markedCreates) {
      const intent = state.createIntents[intentId];
      if (
        intent?.mode === "run" &&
        !markedRelays.has(intent.relayId)
      ) {
        markedRelays.add(intent.relayId);
        changed = true;
      }
    }
  }

  sweep(state.relays, markedRelays);
  for (const [id, intent] of Object.entries(state.manualIntents)) {
    if (markedManuals.has(id)) continue;
    state.intentTombstones[id] = {
      hash: intent.submissionHash!,
      outcome: intent.phase,
      deletedAt: now,
    };
    delete state.manualIntents[id];
    delete state.submissionReservations[id];
    if (state.manualResultOutbox[id]?.state === "persisted") {
      delete state.manualResultOutbox[id];
    }
    if (!state.retryCapsules[id]) delete state.submissionOutcomes[id];
  }
  for (const [outboxRef, intent] of Object.entries(state.steerIntents)) {
    if (markedSteers.has(outboxRef)) continue;
    state.intentTombstones[outboxRef] = {
      hash: intent.envelopeHash,
      outcome: intent.phase,
      deletedAt: now,
    };
    delete state.steerIntents[outboxRef];
  }
  sweep(state.createIntents, markedCreates);
  sweep(state.actions, markedActions);
  sweep(state.noticeOutbox, markedNotices);
  sweep(state.chains, markedChains);

  for (const [chatId, tombstone] of Object.entries(state.tombstones)) {
    if (tombstone.deletedAt < now - TOMBSTONE_RETENTION_MS) {
      delete state.tombstones[chatId];
    }
  }
  for (const [id, tombstone] of Object.entries(state.intentTombstones)) {
    if (tombstone.deletedAt < now - TOMBSTONE_RETENTION_MS) {
      delete state.intentTombstones[id];
    }
  }
  for (const [id, capsule] of Object.entries(state.retryCapsules)) {
    if (now < capsule.expiresAt) continue;
    delete state.retryCapsules[id];
    const reservation = state.submissionReservations[id];
    if (reservation?.state === "released") {
      delete state.submissionReservations[id];
    }
    const outcome = state.submissionOutcomes[id];
    if (outcome) {
      outcome.phase = "failed";
      outcome.retry = "none";
      outcome.message = "草稿已过期";
      outcome.revision += 1;
      outcome.updatedAt = now;
      outcome.expiresAt = capsule.expiresAt;
    }
  }
  // 无宿主（intent/capsule/reservation 均已消失）的终态 outcome 按
  // 终态保留窗口回收，否则每个被放弃的恢复草稿都留一条永久记录。
  for (const [id, outcome] of Object.entries(state.submissionOutcomes)) {
    if (
      state.manualIntents[id] ||
      state.retryCapsules[id] ||
      state.submissionReservations[id] ||
      state.intentTombstones[id]
    ) {
      continue;
    }
    if (outcome.phase !== "failed" && outcome.phase !== "persisted") continue;
    if (outcome.updatedAt < now - TERMINAL_RETENTION_MS) {
      delete state.submissionOutcomes[id];
    }
  }
}

function sweep<T>(records: Record<string, T>, marked: ReadonlySet<string>) {
  for (const id of Object.keys(records)) {
    if (!marked.has(id)) delete records[id];
  }
}
