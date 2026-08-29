/**
 * [INPUT]: Depends on zod, canonical Hash, shared Agent backend vocabulary, manual-only durable turn origin and PauseSaga action schema
 * [OUTPUT]: Provides ledger v6 run/seed CreateIntent ((seed with original promote) parameters abstract with full source provenance), manual/steer/outbox/capsule schema, retained window, derivative type and empty state; v6 is the only readable version
 * [POS]: The truth source of the coordinator/state durable wire; RelayLedger is only responsible for sorting atomic mutatIOn and IO files
 */

import { z } from "zod";
import { agentBackendIdSchema } from "../../../../../shared/agent-schema";
import { canonicalHash } from "../coordinator-values";
import { relayActionSchema } from "./pause-saga";
import { submissionContentV1Schema } from "../../../../../shared/submission";

/** 终态幂等键至少保留 24 小时；每组最近 50 条与时间窗取并集。 */
export const TERMINAL_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const TERMINAL_RETAIN_PER_GROUP = 50;
export const TOMBSTONE_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

const refSchema = z
  .object({
    chatId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    incarnationId: z.string().regex(/^[a-f0-9]{32}$/),
  })
  .strict();
const reservationSchema = z.enum(["waiting", "held", "charged", "released"]);
const phaseSchema = z.enum([
  "reserved",
  "queued",
  "appended",
  "claimed",
  "answered",
  "replyEnqueued",
  "settled",
]);
export const relaySchema = z
  .object({
    id: z.string().min(1).max(128),
    rootChainId: z.string().min(1).max(128),
    source: refSchema,
    target: refSchema,
    message: z.string().min(1).max(32 * 1024),
    expectReply: z.boolean(),
    createdAt: z.number().int().nonnegative(),
    sequence: z.number().int().nonnegative().default(0),
    deliveryPhase: phaseSchema,
    pauseEpoch: z.number().int().nonnegative(),
    pauseReason: z
      .enum(["budget", "chain-paused", "startup-recovered"])
      .optional(),
    terminalOutcome: z.enum(["done", "failed", "cancelled"]).optional(),
    failureCode: z.literal("ARCHIVED").optional(),
    terminalAt: z.number().int().nonnegative().optional(),
    replyDisposition: z.enum(["expected", "none", "enqueued", "suppressed"]),
    reservationState: reservationSchema,
    requestId: z.string().min(1).max(128),
    userMessageId: z.string().min(1).max(128),
    assistantMessageId: z.string().min(1).max(128),
    userSeq: z.number().int().positive().optional(),
    assistantSeq: z.number().int().positive().optional(),
    assistantOutbox: z
      .object({
        terminal: z.enum(["done", "cancelled", "error"]),
        message: z.unknown().optional(),
        state: z.enum(["pending", "appended"]),
      })
      .strict()
      .optional(),
    attempts: z
      .array(
        z
          .object({
            attemptNo: z.number().int().positive(),
            requestId: z.string().min(1).max(128),
            admittedEpoch: z.number().int().nonnegative(),
            reservationState: reservationSchema,
          })
          .strict()
      )
      .min(1),
  })
  .strict()
  .superRefine((relay, context) => {
    const beforeClaim = ["reserved", "queued", "appended"].includes(
      relay.deliveryPhase
    );
    if (beforeClaim && !["waiting", "held"].includes(relay.reservationState)) {
      context.addIssue({
        code: "custom",
        path: ["reservationState"],
        message: "未 claim relay 只能 waiting/held",
      });
    }
    if (
      ["claimed", "answered", "replyEnqueued"].includes(relay.deliveryPhase) &&
      relay.reservationState !== "charged"
    ) {
      context.addIssue({
        code: "custom",
        path: ["reservationState"],
        message: "claim 后 relay 必须 charged",
      });
    }
    if (
      relay.deliveryPhase === "settled" &&
      !["charged", "released"].includes(relay.reservationState)
    ) {
      context.addIssue({
        code: "custom",
        path: ["reservationState"],
        message: "settled relay 不得保留 waiting/held",
      });
    }
    if (relay.attempts.at(-1)?.reservationState !== relay.reservationState) {
      context.addIssue({
        code: "custom",
        path: ["attempts"],
        message: "relay 与最新 attempt 的 reservationState 必须一致",
      });
    }
  });
const chainSchema = z
  .object({
    id: z.string().min(1).max(128),
    used: z.number().int().nonnegative(),
    limit: z.number().int().min(0).max(1_000),
    pauseEpoch: z.number().int().nonnegative(),
    paused: z.boolean(),
  })
  .strict();
const createIntentCommon = z.object({
    id: z.string().min(1).max(128),
    sectionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    incarnationId: z.string().regex(/^[a-f0-9]{32}$/),
    source: refSchema,
    rootChainId: z.string().min(1).max(128),
    title: z.string().min(1).max(200).optional(),
    agent: agentBackendIdSchema,
    contextSections: z.array(refSchema).max(8),
    projectId: z.string().min(1).max(128).optional(),
    createdAt: z.number().int().nonnegative(),
    terminalAt: z.number().int().nonnegative().optional(),
    sagaPhase: z.enum([
      "validated",
      "chatCreated",
      "relayAdmitted",
      "done",
      "failed",
    ]),
    sagaResult: z
      .object({
        sectionId: z.string(),
        firstTurn: z.enum(["started", "paused", "rejected", "idle"]),
      })
      .strict()
      .optional(),
  }).strict();

export const createIntentSchema = z.discriminatedUnion("mode", [
  createIntentCommon.extend({
    mode: z.literal("run"),
    firstMessageId: z.string().min(1).max(128),
    relayId: z.string().min(1).max(128),
    firstMessage: z.string().min(1).max(32 * 1024),
  }).strict(),
  createIntentCommon.extend({
    mode: z.literal("seed"),
    parameterDigest: z.string().regex(/^[a-f0-9]{64}$/),
    messages: z.array(z.string().min(1).max(32 * 1024)).min(1).max(16),
    promotedFrom: z.object({
      agentThreadId: z.string().min(1).max(256),
      sourceChatId: z.string().min(1).max(128),
      sourceIncarnationId: z.string().min(1).max(128),
      subagentAgent: agentBackendIdSchema,
      subagentStatus: z.enum([
        "completed",
        "errored",
        "shutdown",
        "interrupted",
      ]),
      byteSize: z.number().int().nonnegative(),
      truncated: z.boolean(),
    }).strict(),
  }).strict(),
]);

function manualRequestId(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return undefined;
  }
  const turn = (payload as { turn?: unknown }).turn;
  if (!turn || typeof turn !== "object" || Array.isArray(turn)) {
    return undefined;
  }
  const requestId = (turn as { requestId?: unknown }).requestId;
  return typeof requestId === "string" ? requestId : undefined;
}

export const manualIntentSchema = z
  .object({
    id: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    /** durable turn intent 只允许 manual；旧 workflow wire 由 state-reset.v3 清理，
     * 存量文件里已写入的 `{kind:"manual"}` 继续可解析。 */
    origin: z
      .object({ kind: z.literal("manual") })
      .strict()
      .default({ kind: "manual" }),
    payload: z.unknown().optional(),
    submissionHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    requestId: z.string().min(1).max(128).optional(),
    createdAt: z.number().int().nonnegative(),
    terminalAt: z.number().int().nonnegative().optional(),
    ackedAt: z.number().int().nonnegative().optional(),
    userSeq: z.number().int().positive().optional(),
    assistantSeq: z.number().int().positive().optional(),
    sequence: z.number().int().nonnegative().default(0),
    phase: z.enum(["queued", "appended", "claimed", "settled", "failed"]),
    attempts: z
      .array(
        z
          .object({
            attemptNo: z.number().int().positive(),
            epoch: z.number().int().nonnegative(),
            requestId: z.string().min(1).max(128),
            phase: z.enum([
              "claimed",
              "dispatching",
              "unknown",
              "dispatched",
              "result-prepared",
              "persisted",
              "failed",
            ]),
            updatedAt: z.number().int().nonnegative(),
            receiptAt: z.number().int().nonnegative().optional(),
          })
          .strict()
      )
      .default([]),
    failureCode: z.literal("ARCHIVED").optional(),
    userMessage: z.unknown(),
  })
  .strict()
  .superRefine((intent, context) => {
    if (
      ["queued", "appended", "claimed"].includes(intent.phase) &&
      intent.payload === undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["payload"],
        message: "未终态 ManualTurnIntent 必须保留完整 payload",
      });
    }
    if (!intent.requestId && !manualRequestId(intent.payload)) {
      context.addIssue({
        code: "custom",
        path: ["requestId"],
        message: "ManualTurnIntent 缺少 requestId",
      });
    }
    if (!intent.submissionHash && intent.payload === undefined) {
      context.addIssue({
        code: "custom",
        path: ["submissionHash"],
        message: "已压缩 ManualTurnIntent 缺少 submissionHash",
      });
    }
  })
  .transform((intent) => ({
    ...intent,
    requestId: intent.requestId ?? manualRequestId(intent.payload)!,
    submissionHash: intent.submissionHash ?? canonicalHash(intent.payload),
  }));
export const noticeOutboxSchema = z
  .object({
    id: z.string().min(1).max(128),
    chatId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    message: z.unknown(),
    dependsOnMessageId: z.string().min(1).max(128).optional(),
    state: z.enum(["pending", "appended"]),
  })
  .strict();
export const tombstoneSchema = z
  .object({
    chatId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
    incarnationId: z.string().regex(/^[a-f0-9]{32}$/),
    deletedAt: z.number().int().nonnegative(),
  })
  .strict();
export const steerIntentSchema = z
  .object({
    outboxRef: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    requestId: z.string().min(1).max(128),
    envelope: z.unknown(),
    stagedSnapshot: z.unknown(),
    envelopeHash: z.string().regex(/^[a-f0-9]{64}$/),
    seq: z.number().int().positive(),
    assistantSeq: z.number().int().positive().optional(),
    phase: z.enum([
      "journaled",
      "injected",
      "awaitingDecision",
      "persisted",
      "transferred",
      "dismissed",
      "failed",
    ]),
    opEpoch: z.number().int().nonnegative(),
    createdAt: z.number().int().nonnegative(),
    reason: z.string().max(2_000).optional(),
    terminalAt: z.number().int().nonnegative().optional(),
    turnTerminalAt: z.number().int().nonnegative().optional(),
    ackedAt: z.number().int().nonnegative().optional(),
  })
  .strict();
const intentTombstoneSchema = z
  .object({
    hash: z.string().regex(/^[a-f0-9]{64}$/),
    outcome: z.string().min(1).max(64),
    deletedAt: z.number().int().nonnegative(),
  })
  .strict();

export const submissionReservationSchema = z
  .object({
    intentId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    submissionHash: z.string().regex(/^[a-f0-9]{64}$/),
    /**
     * v3.1 之后 reservation 必须携带完整 binary-free payload：
     * submission 在所有 await 前取得原始内容 custody，intent 在准备
     * 完成后替换它。optional 只用于识别并安全清理旧 v3 hash-only
     * reservation。
     */
    payload: z.unknown().optional(),
    state: z.enum(["reserved", "admitted", "released"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const manualResultOutboxSchema = z
  .object({
    intentId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    terminal: z.enum(["done", "cancelled", "error"]),
    outcome: z.enum(["stored", "empty", "missing", "failed"]),
    assistantMessage: z.unknown().optional(),
    state: z.enum(["prepared", "persisted"]),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const retryCapsuleSchema = z
  .object({
    intentId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    content: submissionContentV1Schema,
    createdAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
    state: z.enum(["recoverable", "retry-agent-turn", "expired"]),
  })
  .strict();

export const submissionOutcomeRecordSchema = z
  .object({
    intentId: z.string().min(1).max(128),
    conversationId: z.string().min(1).max(128),
    revision: z.number().int().nonnegative(),
    phase: z.enum([
      "queued",
      "appended",
      "claimed",
      "dispatching",
      "dispatched",
      "unknown",
      "result-prepared",
      "persisted",
      "failed",
    ]),
    custody: z.enum(["main-journal", "local-queue", "chat-persisted"]),
    retry: z.enum([
      "none",
      "safe",
      "reconcile",
      "recoverable",
      "retry-agent-turn",
    ]),
    message: z.string().max(2_000).optional(),
    expiresAt: z.number().int().positive().optional(),
    admissionAckedAt: z.number().int().nonnegative().optional(),
    recoveryAckedAt: z.number().int().nonnegative().optional(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();

export const ledgerSchema = z
  .object({
    schemaVersion: z.literal(6),
    nextSequence: z.number().int().positive().default(1),
    chains: z.record(z.string(), chainSchema),
    relays: z.record(z.string(), relaySchema),
    createIntents: z.record(z.string(), createIntentSchema),
    manualIntents: z.record(z.string(), manualIntentSchema),
    steerIntents: z.record(z.string(), steerIntentSchema).default({}),
    noticeOutbox: z.record(z.string(), noticeOutboxSchema).default({}),
    actions: z.record(z.string(), relayActionSchema).default({}),
    tombstones: z.record(z.string(), tombstoneSchema).default({}),
    intentTombstones: z.record(z.string(), intentTombstoneSchema).default({}),
    submissionReservations: z
      .record(z.string(), submissionReservationSchema)
      .default({}),
    manualResultOutbox: z
      .record(z.string(), manualResultOutboxSchema)
      .default({}),
    retryCapsules: z.record(z.string(), retryCapsuleSchema).default({}),
    submissionOutcomes: z
      .record(z.string(), submissionOutcomeRecordSchema)
      .default({}),
  })
  .strict();

export type SectionRef = z.infer<typeof refSchema>;
export type RelayRecord = z.infer<typeof relaySchema>;
export type CreateIntent = z.infer<typeof createIntentSchema>;
export type ManualTurnIntent = z.infer<typeof manualIntentSchema>;
export type SteerIntent = z.infer<typeof steerIntentSchema>;
export type ManualTurnIntentInput = Omit<
  ManualTurnIntent,
  "sequence" | "userSeq" | "assistantSeq" | "attempts" | "origin"
> & {
  userSeq: number;
  assistantSeq: number;
  attempts?: ManualTurnIntent["attempts"];
};
export type NoticeOutboxRecord = z.infer<typeof noticeOutboxSchema>;
export type ManualAttempt = z.infer<
  typeof manualIntentSchema
>["attempts"][number];
export type SubmissionReservation = z.infer<
  typeof submissionReservationSchema
>;
export type ManualResultOutbox = z.infer<typeof manualResultOutboxSchema>;
export type RetryCapsule = z.infer<typeof retryCapsuleSchema>;
export type SubmissionOutcomeRecord = z.infer<
  typeof submissionOutcomeRecordSchema
>;
export type LedgerState = z.infer<typeof ledgerSchema>;
export type RelayExpectation = {
  deliveryPhase:
    | RelayRecord["deliveryPhase"]
    | RelayRecord["deliveryPhase"][];
  pauseEpoch: number;
  attemptNo: number;
  source: SectionRef;
  target: SectionRef;
};
export type RelayAdmissionInput = Omit<
  RelayRecord,
  | "deliveryPhase"
  | "sequence"
  | "pauseEpoch"
  | "pauseReason"
  | "terminalOutcome"
  | "replyDisposition"
  | "reservationState"
  | "attempts"
  | "assistantOutbox"
> & { limit: number };

export const emptyLedgerState = (): LedgerState => ({
  schemaVersion: 6,
  nextSequence: 1,
  chains: {},
  relays: {},
  createIntents: {},
  manualIntents: {},
  steerIntents: {},
  noticeOutbox: {},
  actions: {},
  tombstones: {},
  intentTombstones: {},
  submissionReservations: {},
  manualResultOutbox: {},
  retryCapsules: {},
  submissionOutcomes: {},
});
