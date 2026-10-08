/**
 * [INPUT]: Depends on shared SubmissionContent and capsule limits, coordinator-values coded errors, the ledger v7 state and manual-intent schema, and submission/reservation-payload for raw references and prepared intents
 * [OUTPUT]: Submission reservations: reserve, prepare, promote into main-journal custody, recover, release (plain and raw) and list pending ones, and a failed raw recovery settled with a bounded capsule Promotion exchanges queue identity at its original position; reserved replacement capacity and claim release preserve rollback.
 * [POS]: The reservation half of the coordinator's submission state machine; ../submission-outcome.ts owns attempts and outcomes after admission, RelayLedger sequences both
 */

import {
  SUBMISSION_CAPSULE_BYTE_LIMIT,
  SUBMISSION_CAPSULE_CHAT_LIMIT,
  SUBMISSION_CAPSULE_TTL_MS,
  type SubmissionContentV1,
  submissionContentV1Schema,
} from "../../../../../shared/content/submission/submission";
import { codedError } from "../coordinator-values";
import type {
  LedgerState,
  ManualTurnIntent,
  ManualTurnIntentInput,
} from "../state/ledger-schema";
import { manualIntentSchema } from "../state/ledger-schema";
import { releaseQueuedInput, transferQueuedInput } from "../remote/queue-custody";
import {
  isReservationKind,
  preparedReservationIntent,
} from "./reservation-payload";

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
    replacesIntentId?: string;
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
  if (input.replacesIntentId) protectedIntents.delete(input.replacesIntentId);
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
  const context = intent.remoteSubmission?.context;
  if (context?.queueExchange) intent.sequence = transferQueuedInput(state, context, context.queueExchange, now);
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
  releaseQueuedInput(state, intentId);
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
  releaseQueuedInput(state, intentId);
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
  releaseQueuedInput(state, input.intentId);
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
