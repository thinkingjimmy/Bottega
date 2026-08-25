/**
 * [INPUT]: Depends on Delivery maintenance store, MemorySpaceGate and runtime-owned provider instance identity
 * [OUTPUT]: Provides Delivery v4 is a stream, target, capture reservation, cleanup, gap, rebuild job, current shared range flow selection/counting and receipt
 * [POS]: The only permanent source of truth for main/memory/delivery; No active provIDer, no instance ID, no return Policy
 */

import type { MemorySharingMode } from "../../../../shared/settings-ipc";
import { memorySpaceBelongsToSharingScope } from "../core/memory-scope";
import { memorySpaceGate } from "../space-gate";
import {
  type CaptureReservation,
  type DeliveryInstance,
  digest,
  instanceOf,
} from "./schema";
import {
  captureAttentionId,
  DeliveryStoreMaintenance,
  deliveryStreamKey,
  stableMemoryPayloadId,
} from "./maintenance-store";

export {
  deliveryStreamKey,
  stableMemoryPayloadId,
} from "./maintenance-store";

export type {
  CaptureReservation,
  DeliveryInstance,
  DeliveryOwnerEffectReceipt,
  DeliveryV4State,
  DeliveryV3State,
} from "./schema";

type CountableStream = Pick<
  DeliveryInstance["streams"][string],
  "pending" | "delivered" | "gap"
>;

export function sumStreams(streams: readonly CountableStream[]) {
  return streams.reduce(
    (total, stream) => ({
      pending: total.pending + stream.pending,
      delivered: total.delivered + stream.delivered,
      gap: total.gap + stream.gap,
    }),
    { pending: 0, delivered: 0, gap: 0 }
  );
}

export class MemoryDeliveryStore extends DeliveryStoreMaintenance {

  async reserveCapture(input: {
    providerDataInstanceId: string;
    providerId: string;
    memorySpaceId: string;
    sourceSessionKey: string;
    grantId?: string | null;
    assistantSeq?: number;
    expectedPeerId: string;
    remoteSessionId: string;
    attemptId: string;
    policyRevision: number;
    revocationRevision: number;
    allowQuiesced?: boolean;
  }) {
    memorySpaceGate.assertHeld(input.memorySpaceId, "Capture reservation");
    return this.ledger.mutate((state) => {
      const instance = instanceOf(
        state,
        input.providerDataInstanceId,
        input.providerId
      );
      if (instance.quiesced && !input.allowQuiesced) {
        throw new Error("Provider instance 已 quiesce");
      }
      const targetId = digest({
        instance: input.providerDataInstanceId,
        space: input.memorySpaceId,
        source: input.sourceSessionKey,
      });
      instance.remoteTargets[targetId] ??= {
        id: targetId,
        memorySpaceId: input.memorySpaceId,
        sourceSessionKey: input.sourceSessionKey,
        expectedPeerId: input.expectedPeerId,
        remoteSessionId: input.remoteSessionId,
        registeredAt: Date.now(),
      };
      instance.captureAttemptSequence += 1;
      const attemptId = `${input.attemptId}:${instance.captureAttemptSequence}`;
      const reservationId = digest({
        runtimeEpoch: state.runtimeEpoch,
        attemptId,
      });
      const reservation: CaptureReservation = {
        id: reservationId,
        attemptId,
        runtimeEpoch: state.runtimeEpoch,
        targetId,
        memorySpaceId: input.memorySpaceId,
        sourceSessionKey: input.sourceSessionKey,
        grantId: input.grantId ?? null,
        assistantSeq: input.assistantSeq ?? 0,
        policyRevision: input.policyRevision,
        revocationRevision: input.revocationRevision,
        state: "active",
        createdAt: Date.now(),
        finishedAt: null,
      };
      instance.reservations[reservationId] = reservation;
      instance.revision += 1;
      state.revision += 1;
      return reservation;
    });
  }

  async finishReservation(
    providerDataInstanceId: string,
    reservationId: string,
    stateValue: "completed" | "rejected" | "cancelled"
  ) {
    const result = await this.ledger.mutate((state) => {
      const instance = state.providerInstances[providerDataInstanceId];
      const reservation = instance?.reservations[reservationId];
      if (!instance || !reservation) {
        throw new Error("Capture attempt 没有 reservation");
      }
      if (reservation.state !== "active") return reservation;
      reservation.state = stateValue;
      reservation.finishedAt = Date.now();
      if (stateValue === "rejected") {
        this.recordCaptureGap(state, instance, reservation);
      }
      instance.revision += 1;
      state.revision += 1;
      return reservation;
    });
    this.signal(result.memorySpaceId);
    return result;
  }

  async recordDelivered(input: {
    providerDataInstanceId: string;
    providerId: string;
    memorySpaceId: string;
    sourceSessionKey: string;
    assistantSeq: number;
    grantId?: string | null;
  }) {
    return this.ledger.mutate((state) => {
      const instance = instanceOf(
        state,
        input.providerDataInstanceId,
        input.providerId
      );
      const key = deliveryStreamKey(input);
      const stream = (instance.streams[key] ??= {
        key,
        grantId: input.grantId ?? null,
        memorySpaceId: input.memorySpaceId,
        sourceSessionKey: input.sourceSessionKey,
        cursor: 0,
        pending: 0,
        delivered: 0,
        gap: 0,
        lastPayloadId: null,
      });
      const payloadId = stableMemoryPayloadId(input);
      if (stream.lastPayloadId === payloadId) return stream;
      stream.cursor = Math.max(stream.cursor, input.assistantSeq);
      stream.pending = Math.max(0, stream.pending - 1);
      stream.delivered += 1;
      stream.lastPayloadId = payloadId;
      const attentionId = captureAttentionId(input);
      const attention = instance.attentions[attentionId];
      if (attention?.resolvedAt === null) {
        attention.resolvedAt = Date.now();
        stream.gap = Math.max(0, stream.gap - 1);
      }
      instance.revision += 1;
      state.revision += 1;
      return stream;
    });
  }

  async ensureBackfillStream(input: {
    grantId: string;
    providerDataInstanceId: string;
    providerId: string;
    memorySpaceId: string;
    sourceSessionKey: string;
    pending: number;
  }) {
    return this.ledger.mutate((state) => {
      const instance = instanceOf(
        state,
        input.providerDataInstanceId,
        input.providerId
      );
      const key = deliveryStreamKey(input);
      const existing = instance.streams[key];
      if (existing) {
        if (existing.grantId !== input.grantId) {
          throw new Error("Backfill stream grant 身份冲突");
        }
        existing.pending = Math.max(existing.pending, input.pending);
        instance.revision += 1;
        state.revision += 1;
        return existing;
      }
      const stream = {
        key,
        grantId: input.grantId,
        memorySpaceId: input.memorySpaceId,
        sourceSessionKey: input.sourceSessionKey,
        cursor: 0,
        pending: input.pending,
        delivered: 0,
        gap: 0,
        lastPayloadId: null,
      };
      instance.streams[key] = stream;
      instance.revision += 1;
      state.revision += 1;
      return stream;
    });
  }

  stream(input: {
    grantId?: string | null;
    providerDataInstanceId: string;
    memorySpaceId: string;
    sourceSessionKey: string;
  }) {
    const instance = this.snapshot().providerInstances[input.providerDataInstanceId];
    return instance?.streams[deliveryStreamKey(input)] ?? null;
  }

  async recordBackfillGap(input: {
    grantId: string;
    providerDataInstanceId: string;
    memorySpaceId: string;
    sourceSessionKey: string;
    assistantSeq: number;
  }) {
    return this.ledger.mutate((state) => {
      const instance = state.providerInstances[input.providerDataInstanceId];
      const stream = instance?.streams[deliveryStreamKey(input)];
      if (!instance || !stream) throw new Error("Backfill stream 不存在");
      if (stream.cursor >= input.assistantSeq) return stream;
      stream.cursor = input.assistantSeq;
      stream.pending = Math.max(0, stream.pending - 1);
      stream.gap += 1;
      instance.revision += 1;
      state.revision += 1;
      return stream;
    });
  }

  async drain(
    memorySpaceId: string,
    sourceSessionKey?: string,
    deadlineMs = 5_000
  ) {
    memorySpaceGate.assertOutside("Capture reservation drain");
    const deadlineAt = Date.now() + deadlineMs;
    while (
      this.activeReservations(memorySpaceId, undefined, sourceSessionKey).length
    ) {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        await this.abandonReservations(memorySpaceId, sourceSessionKey);
        return;
      }
      await new Promise<void>((resolve) => {
        const waiters = this.reservationSignals.get(memorySpaceId) ?? new Set();
        const finish = () => {
          clearTimeout(timer);
          waiters.delete(finish);
          resolve();
        };
        const timer = setTimeout(finish, remaining);
        waiters.add(finish);
        this.reservationSignals.set(memorySpaceId, waiters);
      });
    }
  }

  activeReservations(
    memorySpaceId?: string,
    providerDataInstanceId?: string,
    sourceSessionKey?: string
  ) {
    return Object.values(this.snapshot().providerInstances)
      .filter((instance) => !providerDataInstanceId || instance.id === providerDataInstanceId)
      .flatMap((instance) =>
      Object.values(instance.reservations).filter(
        (reservation) =>
          (!memorySpaceId || reservation.memorySpaceId === memorySpaceId) &&
          (!sourceSessionKey ||
            reservation.sourceSessionKey === sourceSessionKey) &&
          reservation.state === "active"
      )
    );
  }

  cleanup(input: {
    operationId: string;
    providerDataInstanceId: string;
    providerId: string;
    memorySpaceId: string;
    sourceSessionKey?: string;
    reason:
      | "tombstone"
      | "new-generation"
      | "rebuild"
      | "runtime-orphan"
      | "uninstall";
  }) {
    return this.effect({
      ...input,
      effectKind: "cleanup-request",
      subjectRef: input.memorySpaceId,
      payload: input,
      mutate: (instance, now) => {
        const requestId = digest({
          instance: input.providerDataInstanceId,
          operationId: input.operationId,
          space: input.memorySpaceId,
        });
        instance.cleanupRequests[requestId] ??= {
          id: requestId,
          operationId: input.operationId,
          memorySpaceId: input.memorySpaceId,
          targetIds: Object.values(instance.remoteTargets)
            .filter(
              (target) =>
                target.memorySpaceId === input.memorySpaceId &&
                (!input.sourceSessionKey ||
                  target.sourceSessionKey === input.sourceSessionKey)
            )
            .map((target) => target.id)
            .sort(),
          reason: input.reason,
          state: "pending",
          attempt: 0,
          error: null,
          createdAt: now,
          completedAt: null,
        };
      },
    });
  }

  async startRebuild(input: {
    operationId: string;
    providerDataInstanceId: string;
    providerId: string;
  }) {
    return this.effect({
      ...input,
      effectKind: "rebuild-start",
      subjectRef: input.providerDataInstanceId,
      payload: input,
      mutate: (instance) => {
        const active = Object.values(instance.rebuildJobs).find(
          (job) => !["completed", "failed"].includes(job.state)
        );
        if (active && active.operationId !== input.operationId) {
          throw new Error("Provider instance 已有 active rebuild job");
        }
        instance.quiesced = true;
        instance.deliveryGeneration += 1;
        const spaces = [
          ...new Set(
            Object.values(instance.remoteTargets).map(
              (target) => target.memorySpaceId
            )
          ),
        ].sort();
        instance.rebuildJobs[input.operationId] ??= {
          operationId: input.operationId,
          instanceId: input.providerDataInstanceId,
          attempt: 1,
          state: "prepared",
          quiesced: true,
          frozenSpaceIds: spaces,
          cursor: 0,
          deliveryGeneration: instance.deliveryGeneration,
          frozenCleanupRequestIds: null,
          replacementInstanceId: null,
          rebuildEpochId: null,
          backfillTotal: 0,
          backfillCompleted: 0,
          startedAt: Date.now(),
          errorKind: null,
        };
      },
    });
  }

  rebuildJob(providerDataInstanceId: string, operationId: string) {
    return (
      this.snapshot().providerInstances[providerDataInstanceId]?.rebuildJobs[
        operationId
      ] ?? null
    );
  }

  retryRebuild(providerDataInstanceId: string, operationId: string) {
    return this.ledger.mutate((state) => {
      const instance = state.providerInstances[providerDataInstanceId];
      const job = instance?.rebuildJobs[operationId];
      if (!instance || !job) throw new Error("Rebuild job 不存在");
      if (job.state === "completed") return job;
      if (job.state !== "failed") return job;
      job.attempt += 1;
      job.state = job.replacementInstanceId
        ? "backfilling"
        : job.cursor > 0
          ? "purging"
          : "prepared";
      job.quiesced = true;
      job.errorKind = null;
      instance.quiesced = true;
      instance.deliveryGeneration += 1;
      job.deliveryGeneration = instance.deliveryGeneration;
      const attention = instance.attentions[
        digest({ kind: "rebuild-failed", operationId })
      ];
      if (attention) attention.resolvedAt = Date.now();
      instance.revision += 1;
      state.revision += 1;
      return job;
    });
  }

  activeRebuildJobs() {
    return Object.values(this.snapshot().providerInstances)
      .flatMap((instance) =>
        Object.values(instance.rebuildJobs)
          .filter((job) => !["completed", "failed"].includes(job.state))
          .map((job) => ({ providerId: instance.providerId, job }))
      )
      .sort((left, right) => left.job.startedAt - right.job.startedAt);
  }

  blockingRebuildJobs() {
    return Object.values(this.snapshot().providerInstances).flatMap((instance) => {
      const jobs = Object.values(instance.rebuildJobs);
      return jobs
        .filter((job) => {
          if (job.state === "completed") return false;
          if (job.state !== "failed") return true;
          return !jobs.some(
            (candidate) =>
              candidate.state === "completed" &&
              candidate.startedAt > job.startedAt
          );
        })
        .map((job) => ({ providerId: instance.providerId, job }));
    });
  }

  freezeRebuildCleanupSet(
    providerDataInstanceId: string,
    operationId: string
  ) {
    return this.ledger.mutate((state) => {
      const instance = state.providerInstances[providerDataInstanceId];
      const job = instance?.rebuildJobs[operationId];
      if (!instance || !job) throw new Error("Rebuild job 不存在");
      if (job.frozenCleanupRequestIds) return job;
      job.frozenCleanupRequestIds = Object.values(instance.cleanupRequests)
        .filter((request) => request.state !== "completed")
        .map((request) => request.id)
        .sort();
      instance.revision += 1;
      state.revision += 1;
      return job;
    });
  }

  completeCleanupRequestAfterRebuild(input: {
    operationId: string;
    rebuildOperationId: string;
    providerDataInstanceId: string;
    providerId: string;
    cleanupRequestId: string;
    memorySpaceId: string;
    replacementInstanceId: string;
  }) {
    return this.effect({
      ...input,
      effectKind: "cleanup-completed-by-rebuild",
      subjectRef: input.cleanupRequestId,
      payload: input,
      mutate: (instance, now) => {
        const job = instance.rebuildJobs[input.rebuildOperationId];
        const request = instance.cleanupRequests[input.cleanupRequestId];
        if (!job || !request) throw new Error("Rebuild cleanup 事实不存在");
        if (job.state !== "backfilling") {
          throw new Error("Rebuild cleanup 只能在回灌完成后结算");
        }
        if (job.replacementInstanceId !== input.replacementInstanceId) {
          throw new Error("Rebuild cleanup replacement instance 不一致");
        }
        if (!job.frozenCleanupRequestIds?.includes(request.id)) {
          throw new Error("Cleanup request 不属于冻结重建集合");
        }
        if (request.memorySpaceId !== input.memorySpaceId) {
          throw new Error("Cleanup request 的 MemorySpace 不一致");
        }
        request.state = "completed";
        request.completedAt ??= now;
      },
    });
  }

  advanceRebuild(
    providerDataInstanceId: string,
    operationId: string,
    cursor: number,
    stateValue: "purging" | "backfilling",
    replacementInstanceId?: string
  ) {
    return this.ledger.mutate((state) => {
      const instance = state.providerInstances[providerDataInstanceId];
      const job = instance?.rebuildJobs[operationId];
      if (!instance || !job) throw new Error("Rebuild job 不存在");
      if (["completed", "failed"].includes(job.state)) return job;
      job.cursor = Math.max(job.cursor, cursor);
      job.state = stateValue;
      if (replacementInstanceId) {
        if (
          job.replacementInstanceId &&
          job.replacementInstanceId !== replacementInstanceId
        ) {
          throw new Error("Rebuild replacement instance 已冻结");
        }
        job.replacementInstanceId = replacementInstanceId;
      }
      instance.revision += 1;
      state.revision += 1;
      return job;
    });
  }

  setRebuildBackfill(input: {
    providerDataInstanceId: string;
    operationId: string;
    rebuildEpochId: string | null;
    total: number;
    completed: number;
  }) {
    return this.ledger.mutate((state) => {
      const instance = state.providerInstances[input.providerDataInstanceId];
      const job = instance?.rebuildJobs[input.operationId];
      if (!instance || !job) throw new Error("Rebuild job 不存在");
      if (
        job.rebuildEpochId &&
        input.rebuildEpochId &&
        job.rebuildEpochId !== input.rebuildEpochId
      ) throw new Error("Rebuild Epoch 已冻结");
      job.rebuildEpochId ??= input.rebuildEpochId;
      job.backfillTotal = Math.max(job.backfillTotal, input.total);
      job.backfillCompleted = Math.max(job.backfillCompleted, input.completed);
      if (job.backfillCompleted > job.backfillTotal) {
        throw new Error("Rebuild 回灌完成数超过授权数");
      }
      instance.revision += 1;
      state.revision += 1;
      return job;
    });
  }

  completeRebuild(providerDataInstanceId: string, operationId: string) {
    return this.finishRebuild(providerDataInstanceId, operationId, "completed", null);
  }

  failRebuild(
    providerDataInstanceId: string,
    operationId: string,
    errorKind: "provider" | "stale-capability"
  ) {
    return this.finishRebuild(providerDataInstanceId, operationId, "failed", errorKind);
  }

  countsForSpace(providerDataInstanceId: string, memorySpaceId: string) {
    const instance = this.snapshot().providerInstances[providerDataInstanceId];
    const streams = Object.values(instance?.streams ?? {}).filter(
      (stream) => stream.memorySpaceId === memorySpaceId
    );
    return sumStreams(streams);
  }

  countsForSharingScope(
    providerDataInstanceId: string,
    scope: Readonly<{
      sharingMode: MemorySharingMode;
      sharingGeneration: number;
    }>
  ) {
    return sumStreams(this.streamsForSharingScope(providerDataInstanceId, scope));
  }

  streamsForSharingScope(
    providerDataInstanceId: string,
    scope: Readonly<{
      sharingMode: MemorySharingMode;
      sharingGeneration: number;
    }>
  ) {
    const instance = this.snapshot().providerInstances[providerDataInstanceId];
    return Object.values(instance?.streams ?? {}).filter((stream) =>
      memorySpaceBelongsToSharingScope(
        stream.memorySpaceId,
        scope.sharingMode,
        scope.sharingGeneration
      )
    );
  }

  activeReservationsForSharingScope(
    providerDataInstanceId: string,
    scope: Readonly<{
      sharingMode: MemorySharingMode;
      sharingGeneration: number;
    }>
  ) {
    return this.activeReservations(undefined, providerDataInstanceId).filter(
      (reservation) =>
        memorySpaceBelongsToSharingScope(
          reservation.memorySpaceId,
          scope.sharingMode,
          scope.sharingGeneration
        )
    );
  }

}
