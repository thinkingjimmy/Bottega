/**
 * [INPUT]: Depends on shared Memory IPC/Settings Projection type, current sharing scope/epoch, Recall/Delivery/Rebuild original memory replacement/Health owner only read port
 * [OUTPUT]: Provides projectMemoryStatus (frozen observation scope, rebuild, shared-scope, dual warning, expectedVersion) plus recallProjection/unavailableRecallProjection constructors
 * [POS]: The main/memory/service observation projection layer; Service just delivers the fact, the renderer snapshot is assembled here
 */

import type {
  MemoryEffectiveTarget,
  MemoryObservationScope,
  MemoryRecallSnapshot,
  MemoryStatusSnapshot,
} from "../../../../shared/memory-ipc";
import type {
  MemoryFailureKind,
  MemoryRecallProjection,
} from "../core/domain";
import type { MemorySettings } from "../../../../shared/settings-ipc";
import type { MemoryDeliveryStore } from "../delivery/store";
import type { MemoryRebuildController } from "../orchestration/rebuild-controller";
import type { MemoryHealthMonitor } from "../runtime/control/health-monitor";

export function projectMemoryStatus(input: {
  memory: MemorySettings | null;
  target: MemoryEffectiveTarget | null;
  delivery: MemoryDeliveryStore;
  rebuild: MemoryRebuildController;
  health: MemoryHealthMonitor;
  sharingScope: MemoryObservationScope | null;
  lastCaptureAt: number | null;
  warning: string | null;
  recallWarning: string | null;
  recall: MemoryRecallSnapshot;
  epoch: { effectiveAt: number; sharingGeneration: number } | null;
}): MemoryStatusSnapshot {
  const instanceId = input.sharingScope?.providerDataInstanceId ?? "";
  const deliveryReady = input.delivery.isInitialized();
  const counts = deliveryReady && input.sharingScope
    ? input.delivery.countsForSharingScope(instanceId, input.sharingScope)
    : { pending: 0, delivered: 0, gap: 0 };
  const versionMismatch = Boolean(
    input.target?.expectedVersion &&
    input.health.version &&
    input.target.expectedVersion !== input.health.version
  );
  const compatibleMismatch = versionMismatch && input.health.value === "ready";
  return {
    enabled: Boolean(input.memory?.enabled),
    paused: Boolean(input.memory?.paused),
    provider: input.target?.providerId ?? input.memory?.provider ?? "",
    baseUrl: input.target?.baseUrl ?? "",
    target: input.target,
    health: compatibleMismatch ? "compat" : input.health.value,
    healthIssue: compatibleMismatch
      ? { kind: "version", detail: input.health.version! }
      : input.health.issue,
    lastCaptureAt: input.lastCaptureAt,
    warning: input.warning,
    recallWarning: input.recallWarning,
    runningVersion: input.health.version,
    recall: input.recall,
    observationScope: input.sharingScope,
    epoch: input.epoch,
    applyStatus: input.memory?.applyStatus ?? null,
    delivery: {
      pendingTurns: counts.pending,
      deliveredTurns: counts.delivered,
      gapTurns: counts.gap,
      inflightBatches: deliveryReady && input.sharingScope
        ? input.delivery.activeReservationsForSharingScope(
            instanceId,
            input.sharingScope
          ).length
        : 0,
    },
    rebuild: deliveryReady ? input.rebuild.snapshot(instanceId) : null,
    attention: deliveryReady ? input.delivery.attention() : [],
  };
}

/** A recall projection with no prompt text; `prepared` carries the closed-set outcome. */
export function recallProjection(
  requestId: string,
  prepared: MemoryRecallProjection["prepared"]
): MemoryRecallProjection {
  return Object.freeze({
    requestId,
    promptText: "",
    prepared: Object.freeze(prepared),
    candidateRefs: Object.freeze([]),
  });
}

export function unavailableRecallProjection(
  requestId: string,
  failureKind: MemoryFailureKind
) {
  return recallProjection(requestId, { kind: "unavailable", failureKind });
}
