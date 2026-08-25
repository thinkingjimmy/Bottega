/**
 * [INPUT]: Depends on Node Atomic files write, zod, SerialQueue, externally submit payload store, ledger compaction/operations and Section chat/incarnation
 * [OUTPUT]: Provides close/flush relay ledger v6, atom seed, parameter conflict detection, excludes raw/prepared reservation, starts failure outcome, manual attempt/capsule, steer/ack mutation, non-v6 wire, breakdown isolation fail-closed, index and revision snapshot
 * [POS]: The durable journal of sections/coordinator; The fact that the Section has external side effects must be left here before it can be re-posted
 */

import { readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import type { RelayActionsSnapshot } from "../../../../shared/sections-ipc";
import type { SubmissionAck, SubmissionOutcome } from "../../../../shared/submission";
import { SerialQueue } from "../../persistence/serial-queue";
import { stableId } from "./coordinator-values";
import { continueChainBudget } from "./state/chain-budget";
import { actionSnapshot as snapshotActions, freezePause } from "./state/pause-saga";
import { compactLedgerState, normalizeTerminalTimes } from "./state/ledger-compaction";
import { LedgerIndices } from "./state/ledger-indices";
import { LedgerAmbiguousCommitError, persistLedgerState } from "./state/ledger-persistence";
import { deepFreeze, type DeepReadonly } from "./state/readonly-ledger";
import {
  createIntentSchema, emptyLedgerState, ledgerSchema,
  manualIntentSchema, type CreateIntent, type LedgerState,
  type ManualTurnIntent, type ManualTurnIntentInput,
  type NoticeOutboxRecord, type RelayAdmissionInput, type RelayExpectation,
  type RelayRecord, type SectionRef, type SteerIntent,
} from "./state/ledger-schema";
import {
  acknowledgeSubmission,
  failRawSubmissionRecovery,
  installSubmissionCustody,
  markDispatchUnknown,
  persistManualResult,
  prepareManualResult,
  querySubmissionOutcome,
  recoverBeforeDispatch,
  releaseSubmissionReservation,
  releaseRawSubmissionReservation,
  promoteSubmissionReservation,
  prepareSubmissionReservation,
  pendingSubmissionReservations,
  recoverSubmissionReservations,
  reserveSubmission,
  tombstoneConversation as writeConversationTombstone,
  transitionAttempt,
} from "./submission-outcome";
import { isSubmissionPayloadReference, submissionConversationId, SubmissionPayloadStore } from "./submission/payload-store";
import {
  admitRelay,
  completeAnsweredRelay as completeRelay,
  discardChain as discardRelayChain,
  normalizeSequences,
  recoverClaimedRelay as recoverRelay,
  releaseRelay as releaseRelayReservation,
  transitionRelay,
} from "./state/operations/relay";
import {
  ackManualIntents,
  ackSteerIntents,
  bindManualSequences,
  bindRelaySequences,
  liveStagingOwners,
  markSteerTurnTerminal,
  putSteerIntent,
  transferSteerToManual,
  transitionSteer,
} from "./state/operations/outbox";
import {
  acknowledgeNotice as acknowledgeNoticeRecord,
  failArchived as failArchivedConversation,
  putNoticeOutbox as putNoticeRecord,
  releaseConversationResources as releaseConversationState,
  transitionCreateIntent as transitionCreate,
  transitionManual as transitionManualIntent,
} from "./state/operations/manual";

export type {
  CreateIntent,
  ManualTurnIntent,
  ManualTurnIntentInput,
  NoticeOutboxRecord,
  RelayAdmissionInput,
  RelayExpectation,
  RelayRecord,
  SectionRef,
  SteerIntent,
} from "./state/ledger-schema";
export type { DeepReadonly } from "./state/readonly-ledger";

export class RelayLedger {
  readonly filePath: string;
  readonly submissionPayloadRoot: string;
  private readonly queue = new SerialQueue();
  private readonly actionListeners =
    new Set<(snapshot: RelayActionsSnapshot) => void>();
  private readonly outcomeListeners =
    new Set<(outcome: SubmissionOutcome) => void>();
  private state = emptyLedgerState();
  private revision = 0;
  private readonly indices = new LedgerIndices();
  private readonly now: () => number;
  private frozen: Error | null = null;
  private readonly submissionPayloads: SubmissionPayloadStore;
  private submissionReservationTail = Promise.resolve();

  constructor(userData: string, now: () => number = Date.now) {
    this.filePath = join(userData, "section-relay-ledger.json");
    this.submissionPayloadRoot = join(userData, "section-submission-payloads");
    this.submissionPayloads = new SubmissionPayloadStore(this.submissionPayloadRoot);
    this.now = now;
  }

  async initialize() {
    return this.queue.enqueue(async () => {
      await this.submissionPayloads.initialize();
      this.frozen = null;
      const loadedAt = this.now();
      let parsed: LedgerState;
      try {
        /* 断代：v6 是唯一可读 wire。任何旧版本与 v6 解析失败同罪，
           下面的隔离路径会保留原文件并如实报警——绝不静默升格。 */
        parsed = ledgerSchema.parse(
          JSON.parse(await readFile(this.filePath, "utf8"))
        );
      } catch (cause) {
        if (
          cause &&
          typeof cause === "object" &&
          "code" in cause &&
          cause.code === "ENOENT"
        ) {
          this.state = emptyLedgerState();
          await this.commitInitializedState(loadedAt);
          return { recovered: false as const };
        }
        const isolatedPath = this.filePath.replace(
          /\.json$/,
          `.corrupt-${loadedAt}.json`
        );
        await rename(this.filePath, isolatedPath);
        this.state = emptyLedgerState();
        await this.commitInitializedState(loadedAt);
        return {
          recovered: true as const,
          isolatedPath,
          warning: `Section 接力账本损坏，已隔离备份 ${isolatedPath}，历史接力状态丢失，进行中的接力链已终止`,
          cause,
        };
      }
      this.state = normalizeSequences(parsed);
      normalizeTerminalTimes(this.state, loadedAt);
      await this.commitInitializedState(loadedAt);
      return { recovered: false as const };
    });
  }

  snapshot() {
    return structuredClone(this.state);
  }

  read<T>(selector: (state: DeepReadonly<LedgerState>) => T): T {
    return selector(this.state);
  }

  readConversation<T>(
    conversationId: string,
    selector: (records: {
      relays: readonly DeepReadonly<RelayRecord>[];
      manualIntents: readonly DeepReadonly<ManualTurnIntent>[];
    }) => T
  ): T {
    return this.indices.read(this.state, conversationId, selector);
  }

  pendingConversationIds() {
    return this.indices.pendingConversationIds(this.state);
  }

  actionsSnapshot(): RelayActionsSnapshot {
    return {
      revision: this.revision,
      actions: snapshotActions(this.state.actions),
    };
  }

  onActionsChanged(listener: (snapshot: RelayActionsSnapshot) => void) {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  onSubmissionOutcome(listener: (outcome: SubmissionOutcome) => void) {
    this.outcomeListeners.add(listener);
    return () => this.outcomeListeners.delete(listener);
  }

  enqueueRelay(input: RelayAdmissionInput) {
    return this.mutate(
      (state, now) => admitRelay(state, input, now),
      (relay) => this.indices.indexRelay(relay)
    );
  }

  ensurePausedActions() {
    return this.mutate((state, now) => {
      for (const chain of Object.values(state.chains)) {
        if (!chain.paused) continue;
        const actionId = stableId(
          "action",
          `${chain.id}:${chain.pauseEpoch}`
        );
        if (state.actions[actionId]) continue;
        const waiting = Object.values(state.relays)
          .filter(
            (relay) =>
              relay.rootChainId === chain.id &&
              relay.reservationState === "waiting"
          )
          .sort(
            (left, right) =>
              left.sequence - right.sequence ||
              left.id.localeCompare(right.id)
          )[0];
        if (!waiting) continue;
        freezePause(
          state,
          waiting,
          waiting.pauseReason === "startup-recovered"
            ? "startup-recovered"
            : "chain-paused",
          now
        );
      }
    });
  }

  putCreateIntent(intent: CreateIntent) {
    return this.mutate((state) => {
      const existing = state.createIntents[intent.id];
      if (existing) {
        if (
          intent.mode === "seed" &&
          (existing.mode !== "seed" ||
            existing.parameterDigest !== intent.parameterDigest)
        ) {
          throw Object.assign(
            new Error("同一回合的 promote 参数与已入账 intent 冲突"),
            { status: 409 }
          );
        }
        return existing;
      }
      state.createIntents[intent.id] = createIntentSchema.parse(intent);
      return state.createIntents[intent.id]!;
    });
  }

  putCreateIntentAndRelay(
    intent: CreateIntent,
    relay: RelayAdmissionInput
  ) {
    return this.mutate(
      (state, now) => {
      const existingIntent = state.createIntents[intent.id];
      if (existingIntent) {
        if (existingIntent.mode !== "run") {
          throw new Error("CreateIntent mode 与 relay admission 冲突");
        }
        const existingRelay = state.relays[existingIntent.relayId];
        if (!existingRelay) {
          throw new Error("CreateIntent 已存在但唯一 relay 缺失");
        }
        return { intent: existingIntent, relay: existingRelay };
      }
      state.createIntents[intent.id] = createIntentSchema.parse(intent);
      return {
        intent: state.createIntents[intent.id]!,
        relay: admitRelay(state, relay, now),
      };
      },
      (result) => this.indices.indexRelay(result.relay)
    );
  }

  putManualIntent(intent: ManualTurnIntentInput) {
    return this.mutate(
      (state, now) => {
      const existing = state.manualIntents[intent.id];
      if (existing) return existing;
      state.manualIntents[intent.id] = manualIntentSchema.parse({
        ...intent,
        sequence: state.nextSequence++,
      });
      installSubmissionCustody(state, state.manualIntents[intent.id]!, now);
      return state.manualIntents[intent.id]!;
      },
      (record) => this.indices.indexManual(record)
    );
  }

  reserveSubmission(input: {
    submission: import("../../../../shared/sections-ipc").TrustedManualTurnSubmission;
    submissionHash: string;
  }) {
    const task = this.submissionReservationTail.then(async () => {
      const payload = await this.submissionPayloads.put(
        input.submission,
        input.submissionHash
      );
      let result;
      try {
        result = await this.mutate((state, now) =>
          reserveSubmission(
            state,
            {
              intentId: input.submission.intentId,
              conversationId: submissionConversationId(input.submission),
              submissionHash: input.submissionHash,
              payload,
            },
            now
          )
        );
      } catch (cause) {
        // ledger 拒绝（配额/冲突）时补偿清理 manifest：调用方还活着并
        // 收到错误，孤儿 manifest 只会在下次启动被错误复活或炸毁恢复。
        await this.submissionPayloads
          .remove(input.submission.intentId)
          .catch(() => undefined);
        throw cause;
      }
      if (!isSubmissionPayloadReference(result.payload)) {
        await this.submissionPayloads.remove(input.submission.intentId);
      }
      return result;
    });
    this.submissionReservationTail = task.then(
      () => undefined,
      () => undefined
    );
    return task;
  }

  async prepareSubmissionReservation(intent: ManualTurnIntentInput) {
    const result = await this.mutate((state, now) =>
      prepareSubmissionReservation(state, intent, now)
    );
    await this.submissionPayloads.remove(intent.id);
    return result;
  }

  promoteSubmissionReservation(intentId: string) {
    return this.mutate(
      (state, now) => promoteSubmissionReservation(state, intentId, now),
      () => this.indices.rebuild(this.state)
    );
  }

  recoverSubmissionReservations() {
    return this.mutate(
      (state, now) => recoverSubmissionReservations(state, now),
      () => this.indices.rebuild(this.state)
    );
  }

  async pendingSubmissionReservations() {
    const pending = pendingSubmissionReservations(this.state);
    return Promise.all(
      pending.map(({ payload }) =>
        this.submissionPayloads.readReservation(payload)
      )
    );
  }

  async releaseSubmissionReservation(intentId: string) {
    const reservation = this.state.submissionReservations[intentId];
    if (!reservation || reservation.state === "admitted") return false;
    await this.submissionPayloads.markReleased(intentId);
    const released = await this.mutate((state, now) =>
      releaseSubmissionReservation(state, intentId, now)
    );
    if (released) await this.submissionPayloads.finishRelease(intentId);
    return released;
  }

  async releaseRawSubmissionReservation(intentId: string) {
    const reservation = this.state.submissionReservations[intentId];
    if (!reservation || reservation.state !== "reserved") return false;
    await this.submissionPayloads.markReleased(intentId);
    const released = await this.mutate((state) =>
      releaseRawSubmissionReservation(state, intentId)
    );
    if (released) await this.submissionPayloads.finishRelease(intentId);
    return released;
  }

  failRawSubmissionRecovery(input: {
    intentId: string;
    content: import("../../../../shared/submission").SubmissionContentV1;
    message: string;
  }) {
    return this.mutate((state, now) =>
      failRawSubmissionRecovery(state, input, now)
    );
  }

  bindManualSequences(intentId: string, userSeq: number, assistantSeq: number) {
    return this.mutate((state) =>
      bindManualSequences(state, intentId, userSeq, assistantSeq)
    );
  }

  bindRelaySequences(relayId: string, userSeq: number, assistantSeq: number) {
    return this.mutate((state) =>
      bindRelaySequences(state, relayId, userSeq, assistantSeq)
    );
  }

  ackManualIntents(intentIds: readonly string[]) {
    return this.mutate((state, now) =>
      ackManualIntents(state, intentIds, now)
    );
  }

  putSteerIntent(intent: SteerIntent) {
    return this.mutate((state) => putSteerIntent(state, intent));
  }

  transitionSteer(
    outboxRef: string,
    expected: SteerIntent["phase"] | SteerIntent["phase"][],
    phase: SteerIntent["phase"],
    opEpoch: number,
    patch: Partial<Pick<SteerIntent, "turnTerminalAt" | "reason">> = {}
  ) {
    return this.mutate((state, now) =>
      transitionSteer(
        state,
        outboxRef,
        expected,
        phase,
        opEpoch,
        patch,
        now
      )
    );
  }

  transferSteerToManual(
    outboxRef: string,
    opEpoch: number,
    manual: ManualTurnIntentInput
  ) {
    return this.mutate(
      (state, now) =>
        transferSteerToManual(state, outboxRef, opEpoch, manual, now),
      (result) => {
        if (result) this.indices.indexManual(result.manual);
      }
    );
  }

  markSteerTurnTerminal(requestId: string) {
    return this.mutate((state, now) =>
      markSteerTurnTerminal(state, requestId, now)
    );
  }

  ackSteerIntents(outboxRefs: readonly string[]) {
    return this.mutate((state, now) =>
      ackSteerIntents(state, outboxRefs, now)
    );
  }

  liveStagingOwners() {
    return this.read(liveStagingOwners);
  }

  failArchived(conversationId: string) {
    return this.mutate((state, now) =>
      failArchivedConversation(state, conversationId, now)
    );
  }

  transitionManual(
    intentId: string,
    expected:
      | ManualTurnIntent["phase"]
      | ManualTurnIntent["phase"][],
    phase: ManualTurnIntent["phase"]
  ) {
    return this.mutate((state, now) =>
      transitionManualIntent(state, intentId, expected, phase, now)
    );
  }

  markManualDispatching(intentId: string) {
    return this.mutate((state, now) =>
      transitionAttempt(state, intentId, "claimed", "dispatching", now)
    );
  }

  markManualDispatched(intentId: string, receiptAt = this.now()) {
    return this.mutate((state, now) =>
      transitionAttempt(
        state,
        intentId,
        ["dispatching", "unknown"],
        "dispatched",
        now,
        receiptAt
      )
    );
  }

  markManualDispatchUnknown(intentId: string) {
    return this.mutate((state, now) =>
      markDispatchUnknown(state, intentId, now)
    );
  }

  recoverManualBeforeDispatch(intentId: string) {
    return this.mutate((state, now) =>
      recoverBeforeDispatch(state, intentId, now)
    );
  }

  prepareManualResult(
    intentId: string,
    input: {
      terminal: "done" | "cancelled" | "error";
      outcome: "stored" | "empty" | "missing" | "failed";
      assistantMessage?: unknown;
    }
  ) {
    return this.mutate((state, now) =>
      prepareManualResult(state, intentId, input, now)
    );
  }

  persistManualResult(intentId: string, successful: boolean) {
    return this.mutate((state, now) =>
      persistManualResult(state, intentId, successful, now)
    );
  }

  submissionOutcome(intentId: string) {
    return querySubmissionOutcome(this.state, intentId, this.now());
  }

  ackSubmission(ack: SubmissionAck) {
    return this.mutate((state, now) =>
      acknowledgeSubmission(state, ack, now)
    );
  }

  putNoticeOutbox(record: NoticeOutboxRecord) {
    return this.mutate((state) => putNoticeRecord(state, record));
  }

  acknowledgeNotice(noticeId: string) {
    return this.mutate((state) =>
      acknowledgeNoticeRecord(state, noticeId)
    );
  }

  tombstoneConversation(ref: SectionRef, deletedAt = this.now()) {
    return this.mutate((state) => {
      writeConversationTombstone(
        state,
        ref.chatId,
        ref.incarnationId,
        deletedAt
      );
    });
  }

  async releaseConversationResources(ref: SectionRef) {
    const rawIntentIds = Object.values(this.state.submissionReservations)
      .filter((reservation) => reservation.conversationId === ref.chatId)
      .map((reservation) => reservation.intentId);
    await Promise.all(
      rawIntentIds.map((intentId) =>
        this.submissionPayloads.markReleased(intentId)
      )
    );
    const released = await this.mutate(
      (state) => releaseConversationState(state, ref),
      () => this.indices.rebuild(this.state)
    );
    await Promise.all(
      rawIntentIds.map((intentId) =>
        this.submissionPayloads.finishRelease(intentId)
      )
    );
    return released;
  }

  transitionCreateIntent(
    intentId: string,
    expected:
      | CreateIntent["sagaPhase"]
      | CreateIntent["sagaPhase"][],
    patch: Partial<Pick<CreateIntent, "sagaPhase" | "sagaResult">>
  ) {
    return this.mutate((state, now) =>
      transitionCreate(state, intentId, expected, patch, now)
    );
  }

  transition(
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
    >
  ) {
    return this.mutate((state, now) =>
      transitionRelay(state, relayId, expected, patch, now)
    );
  }

  releaseRelay(
    relayId: string,
    expected: RelayExpectation,
    terminalOutcome: "failed" | "cancelled" = "cancelled"
  ) {
    return this.mutate((state, now) =>
      releaseRelayReservation(
        state,
        relayId,
        expected,
        terminalOutcome,
        now
      )
    );
  }

  completeAnsweredRelay(
    relayId: string,
    expected: RelayExpectation,
    reply?: RelayAdmissionInput
  ) {
    return this.mutate(
      (state, now) => {
        return completeRelay(state, relayId, expected, reply, now);
      },
      (result) => {
        if ("reply" in result && result.reply) {
          this.indices.indexRelay(result.reply);
        }
      }
    );
  }

  recoverClaimedRelay(
    relayId: string,
    expected: RelayExpectation,
    retry: { requestId: string; assistantMessageId: string }
  ) {
    return this.mutate((state, now) =>
      recoverRelay(state, relayId, expected, retry, now)
    );
  }

  continueChain(rootChainId: string, expectedPauseEpoch: number) {
    return this.mutate((state, now) =>
      continueChainBudget(state, rootChainId, expectedPauseEpoch, now)
    );
  }

  discardChain(rootChainId: string, expectedPauseEpoch: number) {
    return this.mutate((state, now) =>
      discardRelayChain(state, rootChainId, expectedPauseEpoch, now)
    );
  }

  async closeAndFlush() {
    await this.submissionReservationTail;
    this.queue.close();
    await this.queue.flush();
  }

  private mutate<T>(
    change: (draft: LedgerState, now: number) => T,
    afterCommit?: (result: T) => void
  ) {
    return this.queue.enqueue(async () => {
      if (this.frozen) throw this.frozen;
      const draft = structuredClone(this.state);
      const now = this.now();
      const outcomeRevisions = new Map(
        Object.values(this.state.submissionOutcomes).map((outcome) => [
          outcome.intentId,
          outcome.revision,
        ])
      );
      const result = change(draft, now);
      const finishPayloads =
        await this.submissionPayloads.prepareExpiredReleases(draft, now);
      compactLedgerState(draft, now);
      const next = ledgerSchema.parse(draft);
      try {
        await this.persist(next);
      } catch (cause) {
        if (cause instanceof LedgerAmbiguousCommitError) this.frozen = cause;
        throw cause;
      }
      this.state = next;
      await finishPayloads();
      this.indices.prune(this.state);
      afterCommit?.(result);
      this.freezeCommittedState();
      this.revision += 1;
      const actions = this.actionsSnapshot();
      for (const listener of this.actionListeners) {
        try {
          listener(actions);
        } catch (cause) {
          console.warn("[section-ledger] action listener failed", cause);
        }
      }
      // 事件仅唤醒：只广播本次 mutation 变更过 revision 的 outcome。
      for (const outcome of Object.values(this.state.submissionOutcomes)) {
        if (outcomeRevisions.get(outcome.intentId) === outcome.revision) {
          continue;
        }
        const projection = querySubmissionOutcome(
          this.state,
          outcome.intentId,
          now
        );
        for (const listener of this.outcomeListeners) {
          try {
            listener(projection);
          } catch (cause) {
            console.warn("[section-ledger] outcome listener failed", cause);
          }
        }
      }
      return structuredClone(result);
    });
  }

  private async persist(state: LedgerState) {
    await persistLedgerState(this.filePath, state);
  }

  private async commitInitializedState(now: number) {
    const finalize =
      await this.submissionPayloads.recoverLedgerState(this.state, now);
    const finishExpired =
      await this.submissionPayloads.prepareExpiredReleases(this.state, now);
    compactLedgerState(this.state, now);
    await this.persist(this.state);
    await finalize();
    await finishExpired();
    this.rebuildIndices();
    this.freezeCommittedState();
  }

  private rebuildIndices() {
    this.indices.rebuild(this.state);
  }

  private freezeCommittedState() {
    if (process.env.NODE_ENV !== "production") deepFreeze(this.state);
  }
}
