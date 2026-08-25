/**
 * [INPUT]: Depends on the ledger schema, relay reservation, submission outcome, and staging ownerReceiving the mutable LedgerState draft
 * [OUTPUT]: Provides manual/create/notice phase, CreateIntent Failure with relay, atomic release, archive failure ((includes claimed+unknown, orphaned for failed+capsule) and conversation resource release Pure mutation
 * [POS]: The coordinator/state/operations personnel submit life cycle units; RelayLedger is responsible for the continuous submission, indexing and event
 */

import {
  createIntentSchema,
  manualIntentSchema,
  noticeOutboxSchema,
  type CreateIntent,
  type LedgerState,
  type ManualTurnIntent,
  type NoticeOutboxRecord,
  type SectionRef,
} from "../ledger-schema";
import {
  beginAttempt,
  failManualWithCapsule,
  releaseSubmissionResources,
  setManualOutcomePhase,
} from "../../submission-outcome";
import { stagingOwner } from "./outbox";
import { releaseRelay } from "./relay";

export function failArchived(
  state: LedgerState,
  conversationId: string,
  now: number
) {
  for (const intent of Object.values(state.manualIntents)) {
    /* claimed+unknown 是结果通道已断的孤儿（dispatch 失败或跨进程重启），
       没有执行者能推进它；归档即裁决，一并收敛为 failed+capsule，
       否则非终态永久残留、compaction 不清。 */
    const orphaned =
      intent.phase === "claimed" &&
      intent.attempts.at(-1)?.phase === "unknown";
    if (
      intent.conversationId === conversationId &&
      (["queued", "appended"].includes(intent.phase) || orphaned)
    ) {
      failManualWithCapsule(
        state,
        intent.id,
        intent.phase === "queued" ? "recoverable" : "retry-agent-turn",
        now
      );
      intent.failureCode = "ARCHIVED";
    }
  }
  for (const relay of Object.values(state.relays)) {
    if (
      relay.target.chatId === conversationId &&
      ["reserved", "queued", "appended"].includes(relay.deliveryPhase)
    ) {
      relay.deliveryPhase = "settled";
      relay.terminalOutcome = "failed";
      relay.failureCode = "ARCHIVED";
      relay.replyDisposition = "suppressed";
      relay.reservationState = "released";
      relay.terminalAt = now;
      const attempt = relay.attempts.at(-1);
      if (attempt) attempt.reservationState = "released";
    }
  }
}

export function transitionManual(
  state: LedgerState,
  intentId: string,
  expected: ManualTurnIntent["phase"] | ManualTurnIntent["phase"][],
  phase: ManualTurnIntent["phase"],
  now: number
) {
  const current = state.manualIntents[intentId];
  if (!current) throw new Error("ManualTurnIntent 不存在");
  const phases = Array.isArray(expected) ? expected : [expected];
  if (!phases.includes(current.phase)) return null;
  const legal: Record<
    ManualTurnIntent["phase"],
    ManualTurnIntent["phase"][]
  > = {
    queued: ["appended", "failed"],
    appended: ["claimed", "failed"],
    claimed: ["settled", "failed"],
    settled: [],
    failed: [],
  };
  if (!legal[current.phase].includes(phase)) {
    throw new Error(`ManualTurnIntent 非法转换：${current.phase} → ${phase}`);
  }
  if (phase === "failed") {
    failManualWithCapsule(
      state,
      intentId,
      current.phase === "queued" ? "recoverable" : "retry-agent-turn",
      now
    );
    return state.manualIntents[intentId]!;
  }
  const candidate: Record<string, unknown> = { ...current, phase };
  if (phase === "settled") {
    delete candidate.payload;
    candidate.terminalAt = now;
  }
  const next = manualIntentSchema.parse(candidate);
  state.manualIntents[intentId] = next;
  if (phase === "claimed") beginAttempt(state, intentId, now);
  else if (phase === "appended") {
    setManualOutcomePhase(state, intentId, phase, now);
  }
  return next;
}

export function putNoticeOutbox(
  state: LedgerState,
  record: NoticeOutboxRecord
) {
  const existing = state.noticeOutbox[record.id];
  const canonical = noticeOutboxSchema.parse(record);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(canonical)) {
      throw new Error("Notice outbox id 与既有 canonical payload 冲突");
    }
    return existing;
  }
  state.noticeOutbox[record.id] = canonical;
  return canonical;
}

export function acknowledgeNotice(state: LedgerState, noticeId: string) {
  const current = state.noticeOutbox[noticeId];
  if (!current) throw new Error("Notice outbox 不存在");
  const next = noticeOutboxSchema.parse({ ...current, state: "appended" });
  state.noticeOutbox[noticeId] = next;
  return next;
}

export function releaseConversationResources(
  state: LedgerState,
  ref: SectionRef
) {
  const staging = new Map<string, unknown>();
  const retainStaging = (payload: unknown, fallback: string) => {
    staging.set(stagingOwner(payload, fallback), payload);
  };
  for (const [relayId, relay] of Object.entries(state.relays)) {
    if (
      relay.source.chatId === ref.chatId ||
      relay.target.chatId === ref.chatId
    ) {
      delete state.relays[relayId];
    }
  }
  for (const [intentId, intent] of Object.entries(state.createIntents)) {
    if (
      intent.sectionId === ref.chatId ||
      intent.source.chatId === ref.chatId
    ) {
      delete state.createIntents[intentId];
    }
  }
  releaseSubmissionResources(state, ref.chatId).forEach((payload, index) =>
    retainStaging(payload, `manual-${index}`)
  );
  for (const [outboxRef, intent] of Object.entries(state.steerIntents)) {
    if (intent.conversationId !== ref.chatId) continue;
    retainStaging(intent.stagedSnapshot, intent.outboxRef);
    delete state.steerIntents[outboxRef];
  }
  for (const [noticeId, notice] of Object.entries(state.noticeOutbox)) {
    if (notice.chatId === ref.chatId) delete state.noticeOutbox[noticeId];
  }
  return [...staging.values()];
}

export function transitionCreateIntent(
  state: LedgerState,
  intentId: string,
  expected: CreateIntent["sagaPhase"] | CreateIntent["sagaPhase"][],
  patch: Partial<Pick<CreateIntent, "sagaPhase" | "sagaResult">>,
  now: number
) {
  const current = state.createIntents[intentId];
  if (!current) throw new Error("CreateIntent 不存在");
  const phases = Array.isArray(expected) ? expected : [expected];
  if (!phases.includes(current.sagaPhase)) return null;
  const nextPhase = patch.sagaPhase ?? current.sagaPhase;
  const legal: Record<
    CreateIntent["sagaPhase"],
    CreateIntent["sagaPhase"][]
  > = {
    validated: ["chatCreated", "failed"],
    chatCreated: current.mode === "seed"
      ? ["done", "failed"]
      : ["relayAdmitted", "failed"],
    relayAdmitted: ["done", "failed"],
    done: [],
    failed: [],
  };
  if (
    nextPhase !== current.sagaPhase &&
    !legal[current.sagaPhase].includes(nextPhase)
  ) {
    throw new Error(
      `CreateIntent 非法转换：${current.sagaPhase} → ${nextPhase}`
    );
  }
  const next = createIntentSchema.parse({
    ...current,
    ...patch,
    ...(["done", "failed"].includes(nextPhase) ? { terminalAt: now } : {}),
  });
  if (nextPhase === "failed") {
    const relay = current.mode === "run" ? state.relays[current.relayId] : undefined;
    if (relay && ["waiting", "held"].includes(relay.reservationState)) {
      releaseRelay(
        state,
        relay.id,
        {
          deliveryPhase: relay.deliveryPhase,
          pauseEpoch: relay.pauseEpoch,
          attemptNo: relay.attempts.at(-1)!.attemptNo,
          source: relay.source,
          target: relay.target,
        },
        "failed",
        now
      );
    }
  }
  state.createIntents[intentId] = next;
  return next;
}
