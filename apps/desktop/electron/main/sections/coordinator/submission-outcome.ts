/**
 * [INPUT]: Depends on shared SubmissionContent/Outcome/ACK/lifecycle constant, opaque raw payload reference and ledger v3 state/manual intent
 * [OUTPUT]: Provides outgoing raw submission→prepared intent Two-phase reservation, start failed recoverable, cross-link, attempt FSM, result outbox, capsule custody, revision outcome/ACK and release of resources pure mutation
 * [POS]: The durable submission state machine of sections/coordinator; RelayLedger is only responsible for the sequencing clone→persist→publish
 */

import {
  SUBMISSION_CAPSULE_BYTE_LIMIT,
  SUBMISSION_CAPSULE_CHAT_LIMIT,
  SUBMISSION_CAPSULE_TTL_MS,
  type SubmissionAck,
  type SubmissionContentV1,
  type SubmissionErrorCode,
  type SubmissionOutcome,
  submissionContentV1Schema,
} from "../../../../shared/submission";
import type {
  LedgerState,
  ManualAttempt,
  ManualTurnIntent,
  ManualTurnIntentInput,
} from "./state/ledger-schema";
import { manualIntentSchema } from "./state/ledger-schema";
import {
  isReservationKind,
  preparedReservationIntent,
} from "./submission/reservation-payload";

export function installSubmissionCustody(
  state: LedgerState,
  intent: ManualTurnIntent,
  now: number
) {
  const existing = state.submissionReservations[intent.id];
  if (existing) {
    if (existing.submissionHash !== intent.submissionHash) {
      throw codedError("RESERVATION_CONFLICT");
    }
    existing.state = "admitted";
    delete existing.payload;
    existing.updatedAt = now;
  } else {
    state.submissionReservations[intent.id] = {
      intentId: intent.id,
      conversationId: intent.conversationId,
      submissionHash: intent.submissionHash,
      state: "admitted",
      createdAt: now,
      updatedAt: now,
    };
  }
  state.submissionOutcomes[intent.id] = {
    intentId: intent.id,
    conversationId: intent.conversationId,
    revision: 0,
    phase: intent.phase === "settled" ? "persisted" : intent.phase,
    custody: "main-journal",
    retry: "safe",
    updatedAt: now,
  };
}

export function reserveSubmission(
  state: LedgerState,
  input: {
    intentId: string;
    conversationId: string;
    submissionHash: string;
    payload: unknown;
  },
  now: number
) {
  const intentId = input.intentId;
  const conversationId = input.conversationId;
  const submissionHash = input.submissionHash;
  if (
    !/^[A-Za-z0-9_-]{1,128}$/.test(intentId) ||
    !/^[a-f0-9]{64}$/.test(submissionHash)
  ) {
    throw codedError("RESERVATION_CONFLICT");
  }
  // 已删除会话不再接受新 reservation；崩溃窗口不给已删 chat 留孤儿。
  if (state.tombstones[conversationId]) {
    throw codedError("RESERVATION_CONFLICT");
  }
  const payload = input.payload;
  const existing = state.submissionReservations[intentId];
  if (existing) {
    if (
      existing.submissionHash !== submissionHash ||
      existing.conversationId !== conversationId
    ) {
      throw codedError("RESERVATION_CONFLICT");
    }
    if (
      existing.state === "reserved" &&
      existing.payload === undefined
    ) {
      existing.payload = payload;
      existing.updatedAt = now;
    }
    return existing;
  }
  if (
    Buffer.byteLength(JSON.stringify(payload), "utf8") >
    SUBMISSION_CAPSULE_BYTE_LIMIT
  ) {
    throw codedError("CAPSULE_LIMIT");
  }
  const protectedIntents = new Set(
    Object.values(state.retryCapsules)
      .filter(
        (capsule) =>
          capsule.conversationId === conversationId &&
          capsule.state !== "expired"
      )
      .map((capsule) => capsule.intentId)
  );
  for (const reservation of Object.values(state.submissionReservations)) {
    if (
      reservation.conversationId === conversationId &&
      reservation.state !== "released"
    ) {
      protectedIntents.add(reservation.intentId);
    }
  }
  if (protectedIntents.size >= SUBMISSION_CAPSULE_CHAT_LIMIT) {
    throw codedError("CAPSULE_LIMIT");
  }
  state.submissionReservations[intentId] = {
    intentId,
    conversationId,
    submissionHash,
    payload,
    state: "reserved",
    createdAt: now,
    updatedAt: now,
  };
  return state.submissionReservations[intentId]!;
}

export function prepareSubmissionReservation(
  state: LedgerState,
  input: ManualTurnIntentInput,
  now: number
) {
  const parsed = manualIntentSchema.parse({ ...input, sequence: 0 });
  const { sequence: _sequence, ...intent } = parsed;
  const reservation = state.submissionReservations[intent.id];
  if (
    !reservation ||
    reservation.state !== "reserved" ||
    reservation.conversationId !== intent.conversationId ||
    reservation.submissionHash !== intent.submissionHash
  ) {
    throw codedError("RESERVATION_CONFLICT");
  }
  const payload = { kind: "intent", value: intent } as const;
  if (
    Buffer.byteLength(JSON.stringify(payload), "utf8") >
    SUBMISSION_CAPSULE_BYTE_LIMIT
  ) {
    throw codedError("CAPSULE_LIMIT");
  }
  reservation.payload = payload;
  reservation.updatedAt = now;
  return reservation;
}

export function promoteSubmissionReservation(
  state: LedgerState,
  intentId: string,
  now: number
) {
  const existing = state.manualIntents[intentId];
  if (existing) return existing;
  const reservation = state.submissionReservations[intentId];
  if (!reservation || reservation.state !== "reserved") return null;
  if (reservation.payload === undefined) {
    // 旧 v3 hash-only reservation 建立在任何副作用之前，因此删除
    // 就是安全负证明；绝不能继续谎报 main 已取得 payload custody。
    delete state.submissionReservations[intentId];
    return null;
  }
  const prepared = preparedReservationIntent(reservation.payload);
  if (!prepared) return null;
  const intent = manualIntentSchema.parse({
    ...prepared,
    sequence: state.nextSequence++,
  });
  if (
    intent.id !== reservation.intentId ||
    intent.conversationId !== reservation.conversationId ||
    intent.submissionHash !== reservation.submissionHash
  ) {
    throw codedError("RESERVATION_CONFLICT");
  }
  state.manualIntents[intentId] = intent;
  installSubmissionCustody(state, intent, now);
  return intent;
}

export function recoverSubmissionReservations(
  state: LedgerState,
  now: number
) {
  const recovered: ManualTurnIntent[] = [];
  for (const intentId of Object.keys(state.submissionReservations)) {
    const intent = promoteSubmissionReservation(state, intentId, now);
    if (intent) recovered.push(intent);
  }
  return recovered;
}

export function releaseSubmissionReservation(
  state: LedgerState,
  intentId: string,
  _now: number
) {
  const reservation = state.submissionReservations[intentId];
  if (!reservation || reservation.state === "admitted") return false;
  // admission 前拒绝没有需要保留的 durable 事实；直接删除既避免
  // payload 泄漏，也让同 intentId 的合法修正重试重新取得 custody。
  delete state.submissionReservations[intentId];
  return true;
}

export function releaseRawSubmissionReservation(
  state: LedgerState,
  intentId: string
) {
  const reservation = state.submissionReservations[intentId];
  if (
    !reservation ||
    reservation.state !== "reserved" ||
    (!isReservationKind(reservation.payload, "submission") &&
      !isReservationKind(reservation.payload, "submission-ref"))
  ) {
    return false;
  }
  delete state.submissionReservations[intentId];
  return true;
}

export function pendingSubmissionReservations(state: LedgerState) {
  const submissions: Array<{ intentId: string; payload: unknown }> = [];
  for (const reservation of Object.values(state.submissionReservations)) {
    if (reservation.state !== "reserved") continue;
    if (reservation.payload !== undefined) {
      submissions.push({
        intentId: reservation.intentId,
        payload: reservation.payload,
      });
    }
  }
  return submissions;
}

export function failRawSubmissionRecovery(
  state: LedgerState,
  input: {
    intentId: string;
    content: SubmissionContentV1;
    message: string;
  },
  now: number
) {
  const reservation = state.submissionReservations[input.intentId];
  if (!reservation || reservation.state !== "reserved") return false;
  const content = recoveryCapsuleContent(input.content);
  const active = Object.values(state.retryCapsules).filter(
    (capsule) =>
      capsule.conversationId === reservation.conversationId &&
      capsule.state !== "expired" &&
      capsule.intentId !== input.intentId
  ).length;
  if (active >= SUBMISSION_CAPSULE_CHAT_LIMIT) {
    throw codedError("CAPSULE_LIMIT");
  }
  const expiresAt = now + SUBMISSION_CAPSULE_TTL_MS;
  state.retryCapsules[input.intentId] = {
    intentId: input.intentId,
    conversationId: reservation.conversationId,
    content,
    createdAt: now,
    expiresAt,
    state: "recoverable",
  };
  reservation.state = "released";
  reservation.updatedAt = now;
  const current = state.submissionOutcomes[input.intentId];
  state.submissionOutcomes[input.intentId] = {
    intentId: input.intentId,
    conversationId: reservation.conversationId,
    revision: (current?.revision ?? -1) + 1,
    phase: "failed",
    custody: "main-journal",
    retry: "recoverable",
    message: input.message.slice(0, 2_000),
    expiresAt,
    ...(current?.admissionAckedAt
      ? { admissionAckedAt: current.admissionAckedAt }
      : {}),
    ...(current?.recoveryAckedAt
      ? { recoveryAckedAt: current.recoveryAckedAt }
      : {}),
    updatedAt: now,
  };
  return true;
}

export function beginAttempt(
  state: LedgerState,
  intentId: string,
  now: number
) {
  const intent = requireIntent(state, intentId);
  const attempt: ManualAttempt = {
    attemptNo: (intent.attempts.at(-1)?.attemptNo ?? 0) + 1,
    epoch: (intent.attempts.at(-1)?.epoch ?? -1) + 1,
    requestId: intent.requestId,
    phase: "claimed",
    updatedAt: now,
  };
  intent.attempts.push(attempt);
  updateOutcome(state, intent, "claimed", "chat-persisted", "none", now);
  return attempt;
}

export function setManualOutcomePhase(
  state: LedgerState,
  intentId: string,
  phase: "queued" | "appended" | "failed",
  now: number
) {
  const intent = requireIntent(state, intentId);
  updateOutcome(
    state,
    intent,
    phase,
    phase === "queued" ? "main-journal" : "chat-persisted",
    phase === "failed" ? "recoverable" : "safe",
    now
  );
}

export function transitionAttempt(
  state: LedgerState,
  intentId: string,
  expected: ManualAttempt["phase"] | ManualAttempt["phase"][],
  phase: ManualAttempt["phase"],
  now: number,
  receiptAt?: number
) {
  const intent = requireIntent(state, intentId);
  const current = intent.attempts.at(-1);
  if (!current) throw new Error("Manual attempt 不存在");
  const expectedPhases = Array.isArray(expected) ? expected : [expected];
  if (!expectedPhases.includes(current.phase)) return null;
  const legal: Record<ManualAttempt["phase"], ManualAttempt["phase"][]> = {
    claimed: ["dispatching", "failed"],
    dispatching: ["dispatched", "unknown"],
    // 结果到达本身是比 receipt 更强的 handoff 证明：dispatched 持久化
    // 失败后停在 unknown 的 attempt 必须能接住迟到的终态。
    unknown: ["dispatched", "result-prepared", "failed"],
    // 重启后 receipt ≠ result：结果通道已死的 dispatched 归 unknown 对账。
    dispatched: ["result-prepared", "unknown", "failed"],
    "result-prepared": ["persisted", "failed"],
    persisted: [],
    failed: [],
  };
  if (!legal[current.phase].includes(phase)) {
    throw new Error(`Manual attempt 非法转换：${current.phase} → ${phase}`);
  }
  current.phase = phase;
  current.updatedAt = now;
  if (receiptAt !== undefined) current.receiptAt = receiptAt;
  const projection = attemptProjection(phase);
  updateOutcome(
    state,
    intent,
    projection.phase,
    projection.custody,
    projection.retry,
    now,
    projection.message
  );
  return current;
}

export function prepareManualResult(
  state: LedgerState,
  intentId: string,
  input: {
    terminal: "done" | "cancelled" | "error";
    outcome: "stored" | "empty" | "missing" | "failed";
    assistantMessage?: unknown;
  },
  now: number
) {
  const intent = requireIntent(state, intentId);
  state.manualResultOutbox[intentId] = {
    intentId,
    conversationId: intent.conversationId,
    terminal: input.terminal,
    outcome: input.outcome,
    ...(input.assistantMessage === undefined
      ? {}
      : { assistantMessage: input.assistantMessage }),
    state: "prepared",
    createdAt: state.manualResultOutbox[intentId]?.createdAt ?? now,
    updatedAt: now,
  };
  return transitionAttempt(
    state,
    intentId,
    ["dispatched", "unknown"],
    "result-prepared",
    now
  );
}

export function persistManualResult(
  state: LedgerState,
  intentId: string,
  successful: boolean,
  now: number
) {
  const intent = requireIntent(state, intentId);
  const outbox = state.manualResultOutbox[intentId];
  if (!outbox) throw new Error("Manual result outbox 不存在");
  if (successful) {
    outbox.state = "persisted";
    outbox.updatedAt = now;
    transitionAttempt(state, intentId, "result-prepared", "persisted", now);
    intent.phase = "settled";
    intent.terminalAt = now;
    delete intent.payload;
    updateOutcome(state, intent, "persisted", "chat-persisted", "none", now);
    // 恢复路径必须假设世界是脏的：历史数据里可能存在无 reservation 的
    // intent，terminal 转换不允许因此失败。
    const reservation = state.submissionReservations[intentId];
    if (reservation) {
      reservation.state = "released";
      reservation.updatedAt = now;
    }
    return;
  }
  updateOutcome(
    state,
    intent,
    "result-prepared",
    "chat-persisted",
    "reconcile",
    now,
    "Agent 已执行，结果 outbox 尚未持久化；重启后将前向恢复"
  );
}

export function failManualWithCapsule(
  state: LedgerState,
  intentId: string,
  mode: "recoverable" | "retry-agent-turn",
  now: number
) {
  const intent = requireIntent(state, intentId);
  // 终态转换不可失败：capsule 预算满/内容超限时丢 capsule 保终态，
  // 否则归档/取消会被配额劫持，intent 永远无法终结。
  let capsuleInstalled = true;
  try {
    installRetryCapsule(state, intent, mode, now);
  } catch {
    capsuleInstalled = false;
  }
  intent.phase = "failed";
  intent.terminalAt = now;
  delete intent.payload;
  const reservation = state.submissionReservations[intentId];
  if (reservation) {
    reservation.state = "released";
    reservation.updatedAt = now;
  }
  updateOutcome(
    state,
    intent,
    "failed",
    "main-journal",
    capsuleInstalled ? mode : "none",
    now,
    !capsuleInstalled
      ? "失败终态已落，但重试 capsule 超出预算未能保留；请重新编辑发送"
      : mode === "recoverable"
        ? "消息未进入 canonical 转录，可恢复编辑后派生新身份"
        : "用户消息已持久化，可重试 Agent turn"
  );
}

export function markDispatchUnknown(
  state: LedgerState,
  intentId: string,
  now: number
) {
  return transitionAttempt(
    state,
    intentId,
    ["dispatching", "dispatched"],
    "unknown",
    now
  );
}

export function recoverBeforeDispatch(
  state: LedgerState,
  intentId: string,
  now: number
) {
  const intent = requireIntent(state, intentId);
  const attempt = intent.attempts.at(-1);
  if (intent.phase !== "claimed" || attempt?.phase !== "claimed") return false;
  attempt.phase = "failed";
  attempt.updatedAt = now;
  intent.phase = "appended";
  delete intent.terminalAt;
  updateOutcome(state, intent, "appended", "chat-persisted", "safe", now);
  return true;
}

export function querySubmissionOutcome(
  state: LedgerState,
  intentId: string,
  now: number
): SubmissionOutcome {
  const live = state.submissionOutcomes[intentId];
  if (live) {
    const expired =
      live.expiresAt !== undefined &&
      now >= live.expiresAt &&
      live.retry !== "none";
    return {
      kind: "live",
      intentId,
      revision: live.revision,
      phase: expired ? "failed" : live.phase,
      custody: live.custody,
      retry: expired ? "none" : live.retry,
      ...(expired
        ? { message: "草稿已过期" }
        : live.message
          ? { message: live.message }
          : {}),
      ...(live.expiresAt ? { expiresAt: live.expiresAt } : {}),
    };
  }
  const tombstone = state.intentTombstones[intentId];
  if (tombstone) {
    const outcome = ["settled", "persisted"].includes(tombstone.outcome)
      ? ("persisted" as const)
      : ("failed" as const);
    return {
      kind: "tombstone",
      intentId,
      revision: 0,
      outcome,
      deletedAt: tombstone.deletedAt,
    };
  }
  const reservation = state.submissionReservations[intentId];
  return {
    kind: "notFound",
    intentId,
    revision: 0,
    reservation:
      reservation?.state === "reserved"
        ? "inFlight"
        : reservation
          ? "unknown"
          : "absent",
  };
}

export function acknowledgeSubmission(
  state: LedgerState,
  ack: SubmissionAck,
  now: number
) {
  const outcome = state.submissionOutcomes[ack.intentId];
  if (!outcome) return false;
  if (ack.outcomeRevision > outcome.revision) {
    throw codedError("OUTCOME_CONFLICT");
  }
  if (ack.outcomeRevision !== outcome.revision) return false;
  if (ack.kind === "admission") outcome.admissionAckedAt ??= now;
  else outcome.recoveryAckedAt ??= now;
  return true;
}

export function tombstoneConversation(
  state: LedgerState,
  chatId: string,
  incarnationId: string,
  deletedAt: number
) {
  state.tombstones[chatId] = { chatId, incarnationId, deletedAt };
}

export function releaseSubmissionResources(
  state: LedgerState,
  chatId: string
) {
  const released: unknown[] = [];
  for (const [intentId, intent] of Object.entries(state.manualIntents)) {
    if (intent.conversationId !== chatId) continue;
    if (intent.payload !== undefined) released.push(intent.payload);
    delete state.manualIntents[intentId];
    delete state.submissionReservations[intentId];
    delete state.manualResultOutbox[intentId];
    delete state.retryCapsules[intentId];
    delete state.submissionOutcomes[intentId];
  }
  for (const [intentId, reservation] of Object.entries(
    state.submissionReservations
  )) {
    if (reservation.conversationId !== chatId) continue;
    delete state.submissionReservations[intentId];
    delete state.retryCapsules[intentId];
    delete state.submissionOutcomes[intentId];
  }
  return released;
}

function updateOutcome(
  state: LedgerState,
  intent: ManualTurnIntent,
  phase: LedgerState["submissionOutcomes"][string]["phase"],
  custody: LedgerState["submissionOutcomes"][string]["custody"],
  retry: LedgerState["submissionOutcomes"][string]["retry"],
  now: number,
  message?: string
) {
  const current = state.submissionOutcomes[intent.id];
  state.submissionOutcomes[intent.id] = {
    intentId: intent.id,
    conversationId: intent.conversationId,
    revision: (current?.revision ?? -1) + 1,
    phase,
    custody,
    retry,
    ...(message ? { message } : {}),
    ...(state.retryCapsules[intent.id]
      ? { expiresAt: state.retryCapsules[intent.id]!.expiresAt }
      : {}),
    ...(current?.admissionAckedAt
      ? { admissionAckedAt: current.admissionAckedAt }
      : {}),
    ...(current?.recoveryAckedAt
      ? { recoveryAckedAt: current.recoveryAckedAt }
      : {}),
    updatedAt: now,
  };
}

function installRetryCapsule(
  state: LedgerState,
  intent: ManualTurnIntent,
  mode: "recoverable" | "retry-agent-turn",
  now: number
) {
  const content = recoverContent(intent);
  if (
    Buffer.byteLength(JSON.stringify(content), "utf8") >
    SUBMISSION_CAPSULE_BYTE_LIMIT
  ) {
    throw codedError("CAPSULE_LIMIT");
  }
  const count = Object.values(state.retryCapsules).filter(
    (capsule) =>
      capsule.conversationId === intent.conversationId &&
      capsule.state !== "expired"
  ).length;
  if (count >= SUBMISSION_CAPSULE_CHAT_LIMIT) throw codedError("CAPSULE_LIMIT");
  state.retryCapsules[intent.id] = {
    intentId: intent.id,
    conversationId: intent.conversationId,
    content,
    createdAt: now,
    expiresAt: now + SUBMISSION_CAPSULE_TTL_MS,
    state: mode,
  };
}

function recoverContent(intent: ManualTurnIntent): SubmissionContentV1 {
  const payload =
    intent.payload && typeof intent.payload === "object"
      ? (intent.payload as {
          content?: unknown;
          input?: unknown;
          turn?: { input?: unknown };
        })
      : undefined;
  if (payload) {
    const parsed = submissionContentV1Schema.safeParse(
      payload.content
    );
    if (parsed.success) return parsed.data;
  }
  const candidateInput = payload?.turn?.input ?? payload?.input;
  const input = Array.isArray(candidateInput)
    ? (candidateInput as Array<{ type?: unknown; text?: unknown }>)
    : [];
  const text = input
    .filter(
      (item): item is { type: "text"; text: string } =>
        item.type === "text" && typeof item.text === "string"
    )
    .map((item) => item.text)
    .join("\n");
  return submissionContentV1Schema.parse({
    schemaVersion: 1,
    content: {
      richValue: [{ id: `recovery_${intent.id}`, type: "text", value: text }],
      displayText: text,
      files: [],
    },
    origin: "composer",
    capabilityEpoch: 0,
    backendEpoch: 0,
  });
}

function recoveryCapsuleContent(
  content: SubmissionContentV1
): SubmissionContentV1 {
  const stripped = {
    ...content,
    content: {
      ...content.content,
      files: content.content.files.map((file) => {
        const { url: _url, nativeFile: _nativeFile, ...metadata } = file as
          typeof file & { nativeFile?: unknown };
        return metadata;
      }),
    },
  };
  const parsed = submissionContentV1Schema.parse(stripped);
  if (
    Buffer.byteLength(JSON.stringify(parsed), "utf8") <=
    SUBMISSION_CAPSULE_BYTE_LIMIT
  ) {
    return parsed;
  }
  const displayText = content.content.displayText.slice(0, 32 * 1024);
  return submissionContentV1Schema.parse({
    schemaVersion: 1,
    content: {
      richValue: [
        {
          id: "recovery-content",
          type: "text",
          value: displayText,
        },
      ],
      displayText,
      files: [],
    },
    origin: content.origin,
    capabilityEpoch: content.capabilityEpoch,
    backendEpoch: content.backendEpoch,
  });
}

function requireIntent(state: LedgerState, intentId: string) {
  const intent = state.manualIntents[intentId];
  if (!intent) throw new Error("ManualTurnIntent 不存在");
  return intent;
}

function attemptProjection(phase: ManualAttempt["phase"]) {
  if (phase === "unknown") {
    return {
      phase,
      custody: "chat-persisted" as const,
      retry: "reconcile" as const,
      message: "Agent dispatch 结果不明；普通重试可能重复执行",
    };
  }
  if (phase === "failed") {
    return {
      phase,
      custody: "main-journal" as const,
      retry: "recoverable" as const,
      message: "Agent 未确认接收，可从 custody 恢复",
    };
  }
  return {
    phase,
    custody: "chat-persisted" as const,
    retry: "none" as const,
  };
}

function codedError(code: SubmissionErrorCode) {
  return Object.assign(new Error(code), { code });
}
