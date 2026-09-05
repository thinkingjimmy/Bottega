/**
 * [INPUT]: Depends on the shared stableMemoryDigest primitive, DurableJson corruption classification/quarantine, the Delivery v4 schema, MemorySpaceGate, and atomic filesystem rename
 * [OUTPUT]: Provides Delivery initialization, validated invariant recovery, migration, compaction, attention cleanup, effect receipts, and reservation draining
 * [POS]: The durable Delivery maintenance owner; only classified corruption may enter quarantine while ordinary I/O fails closed
 */

import { createHash } from "node:crypto";
import { mkdir, readdir, rename } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  DurableJson,
  quarantineDurableFile,
} from "../../persistence/durable-json";
import { memorySpaceGate } from "../space-gate";
import { stableMemoryDigest } from "../turn-deadline";
import {
  type CaptureReservation,
  type DeliveryInstance,
  type DeliveryV4State,
  emptyState,
  instanceOf,
  stateSchema,
} from "./schema";

export function deliveryStreamKey(input: {
  providerDataInstanceId: string;
  memorySpaceId: string;
  sourceSessionKey: string;
  grantId?: string | null;
}) {
  return `${input.providerDataInstanceId}\0${input.memorySpaceId}\0${input.sourceSessionKey}\0${input.grantId ?? "live"}`;
}

export function stableMemoryPayloadId(input: {
  providerDataInstanceId: string;
  memorySpaceId: string;
  sourceSessionKey: string;
  assistantSeq: number;
}) {
  return createHash("sha256")
    .update(
      `${input.providerDataInstanceId}\0${input.memorySpaceId}\0${input.sourceSessionKey}\0${input.assistantSeq}`
    )
    .digest("hex");
}

export const captureAttentionId = (input: {
  providerDataInstanceId: string;
  memorySpaceId: string;
  sourceSessionKey: string;
  assistantSeq: number;
}) => stableMemoryDigest({ kind: "capture-gap", ...input });

export class LedgerInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LedgerInvariantError";
  }
}

const attentionActions = {
  "capture-gap": ["acknowledge"],
  "cleanup-failed": ["retry-cleanup", "abandon"],
  "rebuild-failed": ["resume-rebuild"],
  "capacity-pressure": ["compact", "acknowledge"],
} as const;

export class DeliveryStoreMaintenance {
  protected readonly ledger: DurableJson<DeliveryV4State>;
  protected readonly reservationSignals = new Map<string, Set<() => void>>();
  private initialized = false;

  constructor(readonly root: string) {
    this.ledger = new DurableJson(
      join(root, "delivery-v3.json"),
      stateSchema,
      emptyState
    );
  }

  get filePath() {
    return this.ledger.filePath;
  }

  async initialize() {
    try {
      await this.archiveV2();
      await this.openLedger();
    } catch (cause) {
      if (!(cause instanceof LedgerInvariantError)) throw cause;
      /* 读不出的档 DurableJson 已自行隔离；这里只剩领域不变量失败——档能读、
         却自相矛盾。同样隔离原件后从空账本重走同一初始化路径（≡冷启动）。
         后果：stream 水位、reservation、cleanup/rebuild 与 receipt 全部清零，
         交付流水从头重新记账。这比让异常上抛置 ownerFailure 粘死整个
         Memory 子系统（召回+capture 全灭）便宜得多；隔离件留证可追溯。 */
      console.warn(
        "[memory] Delivery 账本损坏已隔离，交付水位清零按冷启动重建",
        cause
      );
      await quarantineDurableFile(this.ledger.filePath);
      await this.openLedger();
    }
    this.initialized = true;
    return this.snapshot();
  }

  /* v3 断代归零是既有升级路径；只有 parse/schema/恢复不变量失败才落入隔离。 */
  private async openLedger() {
    await this.ledger.initialize((raw) =>
      raw &&
      typeof raw === "object" &&
      !Array.isArray(raw) &&
      (raw as { schemaVersion?: unknown }).schemaVersion === 3
        ? emptyState()
        : undefined
    );
    await this.reconcileRuntimeEpoch();
    await this.compact();
  }

  snapshot() {
    return this.ledger.snapshot();
  }

  isInitialized() {
    return this.initialized;
  }

  receipt(providerDataInstanceId: string, operationId: string) {
    return (
      this.snapshot().providerInstances[providerDataInstanceId]?.effects[
        operationId
      ] ?? null
    );
  }

  verifyReceiptDigest(receiptDigest: string) {
    for (const instance of Object.values(this.snapshot().providerInstances)) {
      for (const receipt of Object.values(instance.effects)) {
        if (receipt.receiptDigest !== receiptDigest) continue;
        const { receiptDigest: _stored, ...base } = receipt;
        return stableMemoryDigest(base) === receiptDigest;
      }
    }
    return false;
  }

  attention() {
    return Object.values(this.snapshot().providerInstances)
      .flatMap((instance) =>
        Object.values(instance.attentions)
          .filter((item) => item.resolvedAt === null)
          .map((item) => ({
            id: item.id,
            kind: item.kind,
            sessionKey: item.sessionKey,
            detail: item.detail,
            at: item.at,
            actions: [...attentionActions[item.kind]],
          }))
      )
      .sort((left, right) => left.at - right.at);
  }

  async resolveAttention(idValue: string, action: string) {
    return this.ledger.mutate((state) => {
      for (const instance of Object.values(state.providerInstances)) {
        const attention = instance.attentions[idValue];
        if (!attention || attention.resolvedAt !== null) continue;
        const allowed = attentionActions[attention.kind] as readonly string[];
        if (!allowed.includes(action)) {
          throw new Error("Memory attention 动作不适用");
        }
        if (attention.kind === "cleanup-failed" && action === "retry-cleanup") {
          const request = instance.cleanupRequests[attention.subjectRef];
          if (!request) throw new Error("Cleanup request 已不存在");
          request.state = "pending";
          request.error = null;
        }
        if (attention.kind === "cleanup-failed" && action === "abandon") {
          const request = instance.cleanupRequests[attention.subjectRef];
          if (!request) throw new Error("Cleanup request 已不存在");
          request.state = "completed";
          request.completedAt = Date.now();
          request.error = "用户确认放弃远端清理";
        }
        attention.resolvedAt = Date.now();
        instance.revision += 1;
        state.revision += 1;
        return { kind: attention.kind, subjectRef: attention.subjectRef };
      }
      throw new Error("Memory attention 已失效");
    });
  }

  async compact() {
    const now = Date.now();
    const terminalCutoff = now - 7 * 24 * 60 * 60_000;
    const receiptCutoff = now - 30 * 24 * 60 * 60_000;
    return this.ledger.mutate((state) => {
      let removed = 0;
      for (const instance of Object.values(state.providerInstances)) {
        const removedBeforeInstance = removed;
        const terminalReservations = Object.values(instance.reservations)
          .filter((item) => item.state !== "active")
          .sort((left, right) => right.createdAt - left.createdAt);
        for (const reservation of terminalReservations.slice(2_048)) {
          if ((reservation.finishedAt ?? reservation.createdAt) >= terminalCutoff) continue;
          delete instance.reservations[reservation.id];
          removed += 1;
        }
        const completedCleanup = Object.values(instance.cleanupRequests)
          .filter((item) => item.state === "completed")
          .sort((left, right) => right.createdAt - left.createdAt);
        for (const request of completedCleanup.slice(512)) {
          if ((request.completedAt ?? request.createdAt) >= receiptCutoff) continue;
          delete instance.cleanupRequests[request.id];
          removed += 1;
        }
        const completedJobs = Object.values(instance.rebuildJobs)
          .filter((item) => item.state === "completed")
          .sort((left, right) => right.startedAt - left.startedAt);
        for (const job of completedJobs.slice(32)) {
          if (job.startedAt >= receiptCutoff) continue;
          delete instance.rebuildJobs[job.operationId];
          removed += 1;
        }
        const receipts = Object.values(instance.effects).sort(
          (left, right) => right.committedAt - left.committedAt
        );
        for (const receipt of receipts.slice(4_096)) {
          if (receipt.committedAt >= receiptCutoff) continue;
          delete instance.effects[receipt.operationId];
          removed += 1;
        }
        const resolved = Object.values(instance.attentions)
          .filter((item) => item.resolvedAt !== null)
          .sort((left, right) => (right.resolvedAt ?? 0) - (left.resolvedAt ?? 0));
        for (const attention of resolved.slice(256)) {
          if ((attention.resolvedAt ?? attention.at) >= terminalCutoff) continue;
          delete instance.attentions[attention.id];
          removed += 1;
        }
        this.updateCapacityAttention(instance, now);
        if (removed > removedBeforeInstance) instance.revision += 1;
      }
      if (removed > 0) state.revision += 1;
      return { removed };
    });
  }

  claimCleanupRequest(providerDataInstanceId: string, requestId: string) {
    return this.ledger.mutate((state) => {
      const instance = state.providerInstances[providerDataInstanceId];
      const request = instance?.cleanupRequests[requestId];
      if (!instance || !request) throw new Error("Cleanup request 不存在");
      if (request.state === "completed") return request;
      request.state = "running";
      request.attempt += 1;
      request.error = null;
      instance.revision += 1;
      state.revision += 1;
      return request;
    });
  }

  completeCleanupRequest(input: {
    providerDataInstanceId: string;
    providerId: string;
    requestId: string;
  }) {
    const request = this.snapshot().providerInstances[input.providerDataInstanceId]
      ?.cleanupRequests[input.requestId];
    if (!request) throw new Error("Cleanup request 不存在");
    return this.effect({
      operationId: `${request.operationId}:complete:${request.attempt}`,
      providerDataInstanceId: input.providerDataInstanceId,
      providerId: input.providerId,
      effectKind: "cleanup-complete",
      subjectRef: request.id,
      memorySpaceId: request.memorySpaceId,
      payload: { requestId: request.id, attempt: request.attempt },
      mutate: (instance, now) => {
        const current = instance.cleanupRequests[request.id];
        if (!current) throw new Error("Cleanup request 不存在");
        current.state = "completed";
        current.completedAt = now;
        current.error = null;
        const attention = instance.attentions[
          stableMemoryDigest({ kind: "cleanup-failed", requestId: request.id })
        ];
        if (attention) attention.resolvedAt = now;
      },
    });
  }

  failCleanupRequest(
    providerDataInstanceId: string,
    requestId: string,
    detail: string
  ) {
    return this.ledger.mutate((state) => {
      const instance = state.providerInstances[providerDataInstanceId];
      const request = instance?.cleanupRequests[requestId];
      if (!instance || !request) throw new Error("Cleanup request 不存在");
      request.state = "failed";
      request.error = detail.slice(0, 2_000);
      const attentionId = stableMemoryDigest({ kind: "cleanup-failed", requestId });
      instance.attentions[attentionId] = {
        id: attentionId,
        kind: "cleanup-failed",
        subjectRef: requestId,
        sessionKey: null,
        detail: request.error,
        at: Date.now(),
        resolvedAt: null,
      };
      instance.revision += 1;
      state.revision += 1;
      return request;
    });
  }

  cleanupRequest(providerDataInstanceId: string, requestId: string) {
    return this.snapshot().providerInstances[providerDataInstanceId]
      ?.cleanupRequests[requestId] ?? null;
  }

  cleanupRequestForOperation(
    providerDataInstanceId: string,
    operationId: string
  ) {
    return Object.values(
      this.snapshot().providerInstances[providerDataInstanceId]
        ?.cleanupRequests ?? {}
    ).find((request) => request.operationId === operationId) ?? null;
  }

  remoteTarget(providerDataInstanceId: string, targetId: string) {
    return this.snapshot().providerInstances[providerDataInstanceId]
      ?.remoteTargets[targetId] ?? null;
  }

  activationCleanupOperation(providerDataInstanceId: string) {
    const pending = Object.values(
      this.snapshot().providerInstances[providerDataInstanceId]
        ?.cleanupRequests ?? {}
    )
      .filter((request) => request.state !== "completed")
      .map((request) => request.id)
      .sort();
    return pending.length ? `activation-cleanup:${stableMemoryDigest(pending)}` : null;
  }

  closeAndFlush() {
    return this.ledger.closeAndFlush();
  }

  protected async effect(input: {
    operationId: string;
    providerDataInstanceId: string;
    providerId: string;
    effectKind: string;
    subjectRef: string;
    memorySpaceId?: string;
    payload: unknown;
    mutate(instance: DeliveryInstance, now: number): void;
  }) {
    const spaceId = input.memorySpaceId ?? input.subjectRef;
    if (input.memorySpaceId) {
      memorySpaceGate.assertHeld(spaceId, "Delivery Space effect");
    }
    const inputDigest = stableMemoryDigest({
      effectKind: input.effectKind,
      subjectRef: input.subjectRef,
      spaceId,
      payload: input.payload,
    });
    return this.ledger.mutate((state) => {
      const instance = instanceOf(
        state,
        input.providerDataInstanceId,
        input.providerId
      );
      const existing = instance.effects[input.operationId];
      if (existing) {
        if (
          existing.effectKind !== input.effectKind ||
          existing.inputDigest !== inputDigest
        ) {
          throw new Error("Delivery operationId 已用于不同 effect");
        }
        return existing;
      }
      const beforeRevision = instance.revision;
      const committedAt = Date.now();
      input.mutate(instance, committedAt);
      instance.revision += 1;
      state.revision += 1;
      const base = {
        operationId: input.operationId,
        owner: "delivery" as const,
        effectKind: input.effectKind,
        subjectRef: input.subjectRef,
        spaceId,
        beforeRevision,
        afterRevision: instance.revision,
        committedAt,
        inputDigest,
      };
      const receipt = { ...base, receiptDigest: stableMemoryDigest(base) };
      instance.effects[input.operationId] = receipt;
      return receipt;
    });
  }

  protected finishRebuild(
    providerDataInstanceId: string,
    operationId: string,
    stateValue: "completed" | "failed",
    errorKind: "provider" | "stale-capability" | null
  ) {
    return this.ledger.mutate((state) => {
      const instance = state.providerInstances[providerDataInstanceId];
      const job = instance?.rebuildJobs[operationId];
      if (!instance || !job) throw new Error("Rebuild job 不存在");
      if (["completed", "failed"].includes(job.state)) return job;
      job.state = stateValue;
      job.quiesced = stateValue !== "completed";
      job.errorKind = errorKind;
      if (job.deliveryGeneration === instance.deliveryGeneration) {
        instance.quiesced = stateValue !== "completed";
      }
      this.resolveRebuildAttention(instance, operationId, stateValue, job.attempt);
      instance.revision += 1;
      state.revision += 1;
      return job;
    });
  }

  protected signal(memorySpaceId: string) {
    const waiters = this.reservationSignals.get(memorySpaceId);
    if (!waiters) return;
    this.reservationSignals.delete(memorySpaceId);
    for (const resolve of waiters) resolve();
  }

  protected recordCaptureGap(
    _state: DeliveryV4State,
    instance: DeliveryInstance,
    reservation: CaptureReservation
  ) {
    const key = deliveryStreamKey({
      providerDataInstanceId: instance.id,
      memorySpaceId: reservation.memorySpaceId,
      sourceSessionKey: reservation.sourceSessionKey,
      grantId: reservation.grantId,
    });
    const stream = (instance.streams[key] ??= {
      key,
      grantId: reservation.grantId,
      memorySpaceId: reservation.memorySpaceId,
      sourceSessionKey: reservation.sourceSessionKey,
      cursor: 0,
      pending: 0,
      delivered: 0,
      gap: 0,
      lastPayloadId: null,
    });
    const attentionId = captureAttentionId({
      providerDataInstanceId: instance.id,
      memorySpaceId: reservation.memorySpaceId,
      sourceSessionKey: reservation.sourceSessionKey,
      assistantSeq: reservation.assistantSeq,
    });
    const existing = instance.attentions[attentionId];
    if (!existing || existing.resolvedAt !== null) stream.gap += 1;
    instance.attentions[attentionId] = {
      id: attentionId,
      kind: "capture-gap",
      subjectRef: reservation.id,
      sessionKey: reservation.sourceSessionKey,
      detail: `turn ${reservation.assistantSeq} 的提取未确认完成（attempt ${reservation.attemptId}）`,
      at: Date.now(),
      resolvedAt: null,
    };
  }

  protected abandonReservations(
    memorySpaceId: string,
    sourceSessionKey?: string
  ) {
    return this.ledger.mutate((state) => {
      for (const instance of Object.values(state.providerInstances)) {
        for (const reservation of Object.values(instance.reservations)) {
          if (
            reservation.state !== "active" ||
            reservation.memorySpaceId !== memorySpaceId ||
            (sourceSessionKey && reservation.sourceSessionKey !== sourceSessionKey)
          ) continue;
          reservation.state = "abandoned-uncertain";
          reservation.finishedAt = Date.now();
          this.recordCaptureGap(state, instance, reservation);
          const operationId = `drain-timeout:${state.runtimeEpoch}:${reservation.id}`;
          const cleanupId = stableMemoryDigest({ instance: instance.id, operationId });
          instance.cleanupRequests[cleanupId] ??= {
            id: cleanupId,
            operationId,
            memorySpaceId: reservation.memorySpaceId,
            targetIds: [reservation.targetId],
            reason: "runtime-orphan",
            state: "pending",
            attempt: 0,
            error: null,
            createdAt: Date.now(),
            completedAt: null,
          };
          instance.revision += 1;
          state.revision += 1;
        }
      }
    }).finally(() => this.signal(memorySpaceId));
  }

  private updateCapacityAttention(instance: DeliveryInstance, now: number) {
    const retained =
      Object.keys(instance.reservations).length +
      Object.keys(instance.cleanupRequests).length +
      Object.keys(instance.rebuildJobs).length +
      Object.keys(instance.effects).length;
    const id = stableMemoryDigest({ kind: "capacity-pressure", instance: instance.id });
    if (retained > 12_000) {
      instance.attentions[id] = {
        id,
        kind: "capacity-pressure",
        subjectRef: instance.id,
        sessionKey: null,
        detail: `Delivery 仍保留 ${retained} 条恢复事实；活跃操作阻止了进一步压缩`,
        at: now,
        resolvedAt: null,
      };
    } else if (instance.attentions[id]?.resolvedAt === null) {
      instance.attentions[id]!.resolvedAt = now;
    }
  }

  private resolveRebuildAttention(
    instance: DeliveryInstance,
    operationId: string,
    state: "completed" | "failed",
    attempt: number
  ) {
    const id = stableMemoryDigest({ kind: "rebuild-failed", operationId });
    if (state === "failed") {
      instance.attentions[id] = {
        id,
        kind: "rebuild-failed",
        subjectRef: operationId,
        sessionKey: null,
        detail: `重建 ${operationId} 在 attempt ${attempt} 中断`,
        at: Date.now(),
        resolvedAt: null,
      };
    } else if (instance.attentions[id]) {
      instance.attentions[id]!.resolvedAt = Date.now();
    }
  }

  private async archiveV2() {
    const legacy = join(this.root, "outbox.json");
    await mkdir(dirname(legacy), { recursive: true, mode: 0o700 });
    await this.isolateLegacy(legacy);
    await this.isolateLegacy(`${legacy}.bak`);
    const prefix = `${legacy.slice(legacy.lastIndexOf("/") + 1)}.`;
    for (const entry of await readdir(this.root).catch(() => [])) {
      if (
        !entry.startsWith(prefix) ||
        (!entry.endsWith(".tmp") && !entry.includes("quarantine")) ||
        entry.includes(".v2-isolated")
      ) continue;
      await this.isolateLegacy(join(this.root, entry));
    }
  }

  private async isolateLegacy(path: string) {
    await rename(path, `${path}.v2-isolated`).catch((cause) => {
      if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
    });
  }

  private async reconcileRuntimeEpoch() {
    await this.ledger.mutate((state) => {
      const previous = state.runtimeEpoch;
      const next = emptyState().runtimeEpoch;
      for (const instance of Object.values(state.providerInstances)) {
        for (const reservation of Object.values(instance.reservations)) {
          if (
            reservation.state !== "active" ||
            reservation.runtimeEpoch === next
          ) continue;
          reservation.state = "abandoned-uncertain";
          reservation.finishedAt = Date.now();
          if (!instance.remoteTargets[reservation.targetId]) {
            throw new LedgerInvariantError(
              "Reservation 缺少 RemoteTargetRecord"
            );
          }
          const operationId = `orphan:${previous}:${reservation.id}`;
          const cleanupId = stableMemoryDigest({ instance: instance.id, operationId });
          instance.cleanupRequests[cleanupId] ??= {
            id: cleanupId,
            operationId,
            memorySpaceId: reservation.memorySpaceId,
            targetIds: [reservation.targetId],
            reason: "runtime-orphan",
            state: "pending",
            attempt: 0,
            error: null,
            createdAt: Date.now(),
            completedAt: null,
          };
          instance.revision += 1;
        }
      }
      state.runtimeEpoch = next;
      state.revision += 1;
    });
  }
}
