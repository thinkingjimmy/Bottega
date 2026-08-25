/**
 * [INPUT]: Depends on RelayLedger, ChatsService, PreparedManualTurn staging/hydration with route-independent content, steer-projection, read model and bridge steer operation gate
 * [OUTPUT]: Provides route identity/content separation, universal Workspace lifecycle gate, durable steer access for double CAS, fence finalizer and staging gate
 * [POS]: The Steer outbox of sections/coordinator is the sole owner; Conversation Coordinator is responsible for life cycle assignments only
 */

import type {
  SteerAdmission,
  SteerDecision,
  SteerIpcReceipt,
} from "../../../../../shared/agent-ipc";
import type {
  UnsequencedUserMessage,
} from "../../../../../shared/chats-ipc";
import type {
  TrustedManualTurnSubmission as ManualTurnSubmission,
} from "../../../../../shared/sections-ipc";
import {
  steerSubmissionEnvelopeV1Schema,
  submissionContentV1Schema,
  workspacePreconditionSchema,
} from "../../../../../shared/submission";
import type { AdapterSteerOutcome } from "../../../backends/types";
import type { CoordinatorDependencies } from "../coordinator-runtime";
import {
  canonicalHash,
  stableId,
} from "../coordinator-values";
import {
  assertPreparedContentHash,
  hydratePreparedTurn,
  prepareTextOnlyManualTurn,
  releasePreparedStaging,
  type PreparedManualLease,
  type PreparedManualTurn,
} from "./prepared-manual-turn";
import {
  projectSteerIntent,
  steerDerivedIntentId,
  steerReceipt,
} from "./steer-projection";
import {
  assertConversationWorkspacePrecondition,
  withConversationWorkspacePrecondition,
} from "./workspace-precondition";

type SteerOperation = ReturnType<
  NonNullable<CoordinatorDependencies["registerSteerOperation"]>
>;

type SteerOutboxDependencies = Pick<
  CoordinatorDependencies,
  | "ledger" | "chats" | "prepareManual" | "assertGallery"
  | "registerSteerOperation" | "steerTurn" | "withWorkspaceLifecycle"
  | "getProjectWorkspaceSnapshot"
> & {
  kick(conversationId: string): void;
};

export class SteerOutbox {
  private readonly persistenceJobs = new Map<string, Promise<void>>();
  private readonly leases = new Map<string, PreparedManualLease>();

  constructor(private readonly dependencies: SteerOutboxDependencies) {}

  async initialize() {
    for (const intent of Object.values(
      this.dependencies.ledger.snapshot().steerIntents
    )) {
      if (intent.phase === "journaled") {
        await this.dependencies.ledger.transitionSteer(
          intent.outboxRef,
          "journaled",
          "awaitingDecision",
          intent.opEpoch,
          { reason: "应用重启，无法确认 steering 是否已送达" }
        );
        continue;
      }
      if (intent.phase === "injected") {
        await this.persistInjected(intent.outboxRef, true);
      } else if (intent.phase === "persisted" && !intent.turnTerminalAt) {
        const settled = await this.dependencies.ledger.transitionSteer(
          intent.outboxRef,
          "persisted",
          "persisted",
          intent.opEpoch,
          { turnTerminalAt: Date.now() }
        );
        if (settled) {
          await releasePreparedStaging(
            settled.stagedSnapshot as PreparedManualTurn
          );
        }
      }
    }
  }

  async snapshot(conversationId: string) {
    const intents = this.dependencies.ledger.read((state) =>
      Object.values(state.steerIntents).filter(
        (intent) =>
          intent.conversationId === conversationId &&
          intent.ackedAt === undefined
      )
    );
    return Promise.all(intents.map(projectSteerIntent));
  }

  async admit(input: SteerAdmission): Promise<SteerIpcReceipt> {
    this.assertAdmission(input);
    const replay = this.replayReceipt(input);
    if (replay) return replay;
    if (
      !this.dependencies.registerSteerOperation ||
      !this.dependencies.steerTurn
    ) {
      return {
        outcome: "failed",
        outboxRef: input.outboxRef,
        reason: "steering 服务未配置",
      };
    }
    let operation: SteerOperation;
    try {
      operation = this.dependencies.registerSteerOperation(input.requestId);
    } catch (cause) {
      return {
        outcome: "failed",
        outboxRef: input.outboxRef,
        reason: cause instanceof Error ? cause.message : String(cause),
      };
    }
    let lease: PreparedManualLease | undefined;
    let journaled = false;
    try {
      return await withConversationWorkspacePrecondition(
        operation.conversationId,
        input.workspacePrecondition,
        this.dependencies,
        async (record) => {
          operation.assertCurrent();
          const incarnationId = record.incarnationId;
          steerSubmissionEnvelopeV1Schema.parse({
            schemaVersion: 1,
            route: "steer",
            outboxRef: input.outboxRef,
            requestId: input.requestId,
            conversationId: operation.conversationId,
            workspacePrecondition: input.workspacePrecondition,
            content: input.content,
          });
          await this.dependencies.assertGallery?.(input.content, {
            conversationId: operation.conversationId,
            backend: operation.payload.turnOptions.backend,
          });
          operation.assertCurrent();
          const submission = this.submission(input, operation, incarnationId);
          lease = this.dependencies.prepareManual
            ? await this.dependencies.prepareManual(submission)
            : {
                prepared: prepareTextOnlyManualTurn(
                  submission,
                  record.projectId
                ),
                commit() {},
                async rollback() {},
              };
          operation.assertCurrent();
          const [userSeq, assistantSeq] =
            await this.dependencies.chats.store.reserveSequences(
              operation.conversationId,
              2
            );
          operation.assertCurrent();
          await this.dependencies.ledger.putSteerIntent({
            outboxRef: input.outboxRef,
            conversationId: operation.conversationId,
            requestId: input.requestId,
            envelope: {
              requestId: input.requestId,
              outboxRef: input.outboxRef,
              createdAt: input.createdAt,
              input: lease.prepared.input,
              displayText: input.displayText,
              userMessage: input.userMessage,
            },
            stagedSnapshot: lease.prepared,
            envelopeHash: canonicalHash(input),
            seq: userSeq!,
            assistantSeq: assistantSeq!,
            phase: "journaled",
            opEpoch: operation.epoch,
            createdAt: input.createdAt,
          });
          journaled = true;
          operation.assertCurrent();
          const hydrated = await hydratePreparedTurn(lease.prepared);
          operation.assertCurrent();
          await assertConversationWorkspacePrecondition(
            operation.conversationId,
            input.workspacePrecondition,
            this.dependencies
          );
          const outcome = await this.dependencies.steerTurn!(
            input.requestId,
            hydrated.resolvedInput.input
          );
          operation.assertCurrent();
          return await this.finishOutcome(
            input,
            operation,
            lease,
            hydrated.submission,
            userSeq!,
            assistantSeq!,
            outcome
          );
        }
      );
    } catch (cause) {
      return await this.finishFailure(
        input,
        operation,
        lease,
        journaled,
        cause
      );
    } finally {
      operation.finish();
    }
  }

  async decide(input: SteerDecision): Promise<SteerIpcReceipt> {
    const intent = this.dependencies.ledger.read(
      (state) => state.steerIntents[input.outboxRef]
    );
    if (!intent) {
      return {
        outcome: "failed",
        outboxRef: input.outboxRef,
        reason: "steer outbox 不存在",
      };
    }
    if (input.action === "dismiss") {
      const dismissed = await this.dependencies.ledger.transitionSteer(
        input.outboxRef,
        ["awaitingDecision", "failed"],
        "dismissed",
        intent.opEpoch
      );
      if (!dismissed) return steerReceipt(intent);
      return {
        outcome: "dismissed",
        outboxRef: input.outboxRef,
        reason: "用户已删除无法确认送达的消息",
      };
    }
    const prepared = intent.stagedSnapshot as PreparedManualTurn;
    assertPreparedContentHash(prepared);
    const envelope =
      intent.envelope as { userMessage: UnsequencedUserMessage };
    const transferred = await withConversationWorkspacePrecondition(
      intent.conversationId,
      prepared.workspacePrecondition,
      this.dependencies,
      async () => {
        const assistantSeq =
          intent.assistantSeq ??
          (
            await this.dependencies.chats.store.reserveSequences(
              intent.conversationId,
              1
            )
          )[0]!;
        return this.transfer(
          input.outboxRef,
          intent.opEpoch,
          prepared,
          envelope.userMessage,
          intent.seq,
          assistantSeq
        );
      }
    );
    if (!transferred) return steerReceipt(intent);
    this.leases.get(input.outboxRef)?.commit();
    this.leases.delete(input.outboxRef);
    this.dependencies.kick(intent.conversationId);
    return {
      outcome: "unconsumed",
      outboxRef: input.outboxRef,
      reason: "用户已选择作为下一轮重发",
      derivedIntentId: transferred.manual.id,
    };
  }

  async ack(outboxRefs: readonly string[]) {
    await this.dependencies.ledger.ackSteerIntents(outboxRefs);
    for (const outboxRef of outboxRefs) {
      const intent = this.dependencies.ledger.read(
        (state) => state.steerIntents[outboxRef]
      );
      if (
        !intent ||
        !["transferred", "dismissed", "failed"].includes(intent.phase)
      ) {
        continue;
      }
      if (intent.phase === "transferred") {
        const manual = this.dependencies.ledger.read(
          (state) =>
            state.manualIntents[steerDerivedIntentId(intent.outboxRef)]
        );
        /* transferred manual 与 source outbox 共用 stagingDir。renderer 在
           canonical user 落盘后就会 ACK source，但 appended/claimed 仍可能
           在崩溃恢复时重新 hydrate；只有 manual 终态才能删实体。 */
        if (manual && !["settled", "failed"].includes(manual.phase)) {
          continue;
        }
      }
      const lease = this.leases.get(outboxRef);
      if (lease) {
        await lease.rollback();
        this.leases.delete(outboxRef);
      } else {
        await releasePreparedStaging(
          intent.stagedSnapshot as PreparedManualTurn
        );
      }
    }
  }

  async finalizeFenceTimeout(
    requestId: string,
    opEpochs: readonly number[]
  ) {
    const epochs = new Set(opEpochs);
    const pending = this.dependencies.ledger.read((state) =>
      Object.values(state.steerIntents).filter(
        (intent) =>
          intent.requestId === requestId &&
          epochs.has(intent.opEpoch) &&
          (intent.phase === "journaled" || intent.phase === "injected")
      )
    );
    for (const intent of pending) {
      if (intent.phase !== "journaled") continue;
      await this.dependencies.ledger.transitionSteer(
        intent.outboxRef,
        "journaled",
        "awaitingDecision",
        intent.opEpoch,
        { reason: "turn 终态等待 steering 超时，送达状态需要用户确认" }
      );
    }
    await this.markTurnTerminal(requestId);
    for (const intent of pending) {
      const current = this.dependencies.ledger.read(
        (state) => state.steerIntents[intent.outboxRef]
      );
      if (current?.phase === "injected") {
        this.schedulePersistence(intent.outboxRef);
      }
    }
  }

  async markTurnTerminal(requestId: string) {
    const terminal =
      await this.dependencies.ledger.markSteerTurnTerminal(requestId);
    for (const intent of terminal) {
      if (intent.phase === "persisted") {
        await releasePreparedStaging(
          intent.stagedSnapshot as PreparedManualTurn
        );
      }
    }
  }

  private assertAdmission(input: SteerAdmission) {
    if (
      !input ||
      input.outboxRef !== input.userMessage.id ||
      input.createdAt !== input.userMessage.createdAt ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.outboxRef)
    ) {
      throw new Error("SteerAdmission 身份不一致");
    }
    submissionContentV1Schema.parse(input.content);
    workspacePreconditionSchema.parse(input.workspacePrecondition);
  }

  private replayReceipt(input: SteerAdmission) {
    const known = this.dependencies.ledger.read(
      (state) => state.steerIntents[input.outboxRef]
    );
    if (known) {
      if (known.envelopeHash !== canonicalHash(input)) {
        throw new Error("steer outboxRef 与既有 payload 冲突");
      }
      return steerReceipt(known);
    }
    const tombstone = this.dependencies.ledger.read(
      (state) => state.intentTombstones[input.outboxRef]
    );
    if (!tombstone) return undefined;
    if (tombstone.hash !== canonicalHash(input)) {
      throw new Error("steer outboxRef 与墓碑 payload 冲突");
    }
    if (tombstone.outcome === "persisted") {
      return {
        outcome: "injected" as const,
        outboxRef: input.outboxRef,
        persistState: "persisted" as const,
      };
    }
    if (tombstone.outcome === "transferred") {
      return {
        outcome: "unconsumed" as const,
        outboxRef: input.outboxRef,
        reason: "已转交为下一轮",
        derivedIntentId: steerDerivedIntentId(input.outboxRef),
      };
    }
    return {
      outcome: "failed" as const,
      outboxRef: input.outboxRef,
      reason: `steering 已终结：${tombstone.outcome}`,
    };
  }

  private submission(
    input: SteerAdmission,
    operation: SteerOperation,
    incarnationId: string
  ) {
    const precondition = {
      kind: "existing" as const,
      incarnationId,
    };
    return {
      intentId: input.outboxRef,
      persistence: {
        kind: "append" as const,
        input: {
          chatId: operation.conversationId,
          message: input.userMessage,
          ...(input.attachmentPayloads?.length
            ? { attachmentPayloads: input.attachmentPayloads }
            : {}),
          precondition,
        },
      },
      turn: {
        ...operation.payload,
        requestId: input.requestId,
        input: input.input,
      },
      content: input.content,
      precondition,
      workspacePrecondition: input.workspacePrecondition,
    } satisfies ManualTurnSubmission;
  }

  private async finishOutcome(
    input: SteerAdmission,
    operation: SteerOperation,
    lease: PreparedManualLease,
    submission: ManualTurnSubmission,
    userSeq: number,
    assistantSeq: number,
    outcome: AdapterSteerOutcome
  ): Promise<SteerIpcReceipt> {
    if (outcome.outcome === "injected") {
      await this.dependencies.ledger.transitionSteer(
        input.outboxRef,
        "journaled",
        "injected",
        operation.epoch
      );
      lease.commit();
      operation.assertCurrent();
      if (submission.persistence.kind !== "append") {
        throw new Error("steer 持久化形态必须是 append");
      }
      await this.dependencies.chats.appendUserMessage(
        submission.persistence.input,
        userSeq
      );
      operation.assertCurrent();
      await this.dependencies.ledger.transitionSteer(
        input.outboxRef,
        "injected",
        "persisted",
        operation.epoch
      );
      return {
        outcome: "injected",
        outboxRef: input.outboxRef,
        persistState: "persisted",
      };
    }
    if (outcome.outcome === "unconsumed") {
      const transferred = await this.transfer(
        input.outboxRef,
        operation.epoch,
        lease.prepared,
        input.userMessage,
        userSeq,
        assistantSeq
      );
      if (!transferred) throw new Error("steer fallback 转交发生竞态");
      lease.commit();
      this.dependencies.kick(operation.conversationId);
      return {
        outcome: "unconsumed",
        outboxRef: input.outboxRef,
        reason: outcome.reason,
        derivedIntentId: transferred.manual.id,
      };
    }
    await this.dependencies.ledger.transitionSteer(
      input.outboxRef,
      "journaled",
      "awaitingDecision",
      operation.epoch,
      { reason: outcome.reason }
    );
    this.leases.set(input.outboxRef, lease);
    return {
      outcome: "ambiguous",
      outboxRef: input.outboxRef,
      reason: outcome.reason,
    };
  }

  private async finishFailure(
    input: SteerAdmission,
    operation: SteerOperation,
    lease: PreparedManualLease | undefined,
    journaled: boolean,
    cause: unknown
  ): Promise<SteerIpcReceipt> {
    const reason = cause instanceof Error ? cause.message : String(cause);
    if (!journaled) {
      await lease?.rollback();
      return { outcome: "failed", outboxRef: input.outboxRef, reason };
    }
    const current = this.dependencies.ledger.read(
      (state) => state.steerIntents[input.outboxRef]
    );
    if (current?.phase === "injected") {
      this.schedulePersistence(input.outboxRef);
      return {
        outcome: "injected",
        outboxRef: input.outboxRef,
        persistState: "pending",
      };
    }
    if (current?.phase === "persisted") {
      return {
        outcome: "injected",
        outboxRef: input.outboxRef,
        persistState: "persisted",
      };
    }
    const nextPhase = operation.signal.aborted
      ? "awaitingDecision"
      : "failed";
    await this.dependencies.ledger.transitionSteer(
      input.outboxRef,
      "journaled",
      nextPhase,
      operation.epoch,
      { reason }
    );
    this.leases.set(input.outboxRef, lease!);
    return nextPhase === "awaitingDecision"
      ? {
          outcome: "ambiguous",
          outboxRef: input.outboxRef,
          reason,
        }
      : { outcome: "failed", outboxRef: input.outboxRef, reason };
  }

  private async transfer(
    outboxRef: string,
    opEpoch: number,
    prepared: PreparedManualTurn,
    userMessage: UnsequencedUserMessage,
    userSeq: number,
    assistantSeq: number
  ) {
    assertPreparedContentHash(prepared);
    const intentId = steerDerivedIntentId(outboxRef);
    const requestId = stableId("request", intentId);
    const { contentHash: _oldContentHash, ...preparedBody } = prepared;
    const body = {
      ...preparedBody,
      intentId,
      turn: { ...prepared.turn, requestId },
    };
    const payload: PreparedManualTurn = {
      ...body,
      contentHash: canonicalHash(body),
    };
    return this.dependencies.ledger.transferSteerToManual(
      outboxRef,
      opEpoch,
      {
        id: intentId,
        conversationId:
          prepared.persistence.kind === "append"
            ? prepared.persistence.input.chatId
            : prepared.turn.scope.conversationId,
        payload,
        submissionHash: canonicalHash(payload),
        requestId,
        userMessage,
        userSeq,
        assistantSeq,
        createdAt: userMessage.createdAt,
        phase: "queued",
      }
    );
  }

  private schedulePersistence(outboxRef: string) {
    if (this.persistenceJobs.has(outboxRef)) return;
    const job = this.persistInjected(outboxRef, false).finally(() => {
      this.persistenceJobs.delete(outboxRef);
    });
    this.persistenceJobs.set(outboxRef, job);
  }

  private async persistInjected(
    outboxRef: string,
    turnIsTerminal: boolean
  ) {
    const delays = [0, 100, 400, 1_200];
    let lastError: unknown;
    for (const delayMs of delays) {
      if (delayMs) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      const intent = this.dependencies.ledger.read(
        (state) => state.steerIntents[outboxRef]
      );
      if (!intent || intent.phase !== "injected") return;
      try {
        const prepared = intent.stagedSnapshot as PreparedManualTurn;
        const hydrated = await hydratePreparedTurn(prepared);
        if (hydrated.submission.persistence.kind !== "append") {
          throw new Error("steer 恢复持久化形态无效");
        }
        await this.dependencies.chats.appendUserMessage(
          hydrated.submission.persistence.input,
          intent.seq
        );
        const persisted = await this.dependencies.ledger.transitionSteer(
          outboxRef,
          "injected",
          "persisted",
          intent.opEpoch,
          turnIsTerminal ? { turnTerminalAt: Date.now() } : {}
        );
        if (persisted?.turnTerminalAt) {
          await releasePreparedStaging(prepared);
        }
        return;
      } catch (cause) {
        lastError = cause;
      }
    }
    const intent = this.dependencies.ledger.read(
      (state) => state.steerIntents[outboxRef]
    );
    if (intent?.phase === "injected") {
      await this.dependencies.ledger.transitionSteer(
        outboxRef,
        "injected",
        "injected",
        intent.opEpoch,
        {
          reason: `消息已插入，但历史补写失败：${
            lastError instanceof Error
              ? lastError.message
              : String(lastError)
          }`,
        }
      );
    }
  }
}
