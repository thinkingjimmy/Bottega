/**
 * [INPUT]: Depends on Policy/Delivery v3 Consent grant project Backfill controller Managed Runtime reset and MemorySpaceGate
 * [OUTPUT]: Provides stable operation ID+ increment attempt, boot-first restoreable rebuild driver, original/replacement associated snapshot, turn-by-turn progress and last Policy fence end-of-life
 * [POS]: The main/memory/orchestration rebuild saga owner; MemoryService only authorizes with UI façade, Store does not reset the network
 */

import type { MemoryEffectiveTarget } from "../../../../shared/memory-ipc";
import { errorMessage } from "../../errors";
import type { ManagedRuntimeRegistry } from "../runtime/managed-registry";
import type { MemoryBackfillController } from "./backfill-controller";
import type { MemoryConsentController } from "./consent-controller";
import type { MemoryDeliveryStore } from "../delivery/store";
import type { MemoryCleanupRunner } from "../delivery/cleanup-runner";
import type { MemoryPolicyStore } from "../policy/store";
import { memorySpaceGate } from "../space-gate";

type Dependencies = {
  policy: MemoryPolicyStore;
  delivery: MemoryDeliveryStore;
  cleanup: MemoryCleanupRunner;
  consent: MemoryConsentController;
  backfill: MemoryBackfillController;
  runtimes: ManagedRuntimeRegistry;
  resolveTarget(providerId: string): Promise<MemoryEffectiveTarget>;
  activateTarget(target: MemoryEffectiveTarget): void;
  prepareTransport(): void;
  revoked(): void;
  purgeModel(providerId: string): "workspace-purge" | "runtime-reset";
};

export type MemoryRebuildRecoveryFailure = Readonly<{
  operationId: string;
  failureKind: "policy-store" | "provider";
  phase: "policy" | "provider";
  detail: string;
}>;

export class MemoryRebuildController {
  constructor(private readonly dependencies: Dependencies) {}

  async start(input: {
    operationId: string;
    providerId: string;
    providerDataInstanceId: string;
  }) {
    const receipt = await this.dependencies.delivery.startRebuild(input);
    let job = this.requireJob(input.providerDataInstanceId, input.operationId);
    if (job.state === "failed") {
      job = await this.dependencies.delivery.retryRebuild(
        input.providerDataInstanceId,
        input.operationId
      );
    }
    await this.dependencies.policy.bumpRevocation(
      `${input.operationId}:close:${job.attempt}`,
      "rebuild-start",
      input.providerDataInstanceId
    );
    this.dependencies.revoked();
    await this.drive(input.providerId, input.providerDataInstanceId, input.operationId);
    return receipt;
  }

  async recover() {
    const failures: MemoryRebuildRecoveryFailure[] = [];
    for (const { providerId, job } of this.dependencies.delivery.activeRebuildJobs()) {
      let phase: "policy" | "provider" = "policy";
      try {
        await this.dependencies.policy.bumpRevocation(
          `${job.operationId}:close:${job.attempt}`,
          "rebuild-start",
          job.instanceId
        );
        this.dependencies.revoked();
        phase = "provider";
        await this.drive(providerId, job.instanceId, job.operationId);
      } catch (cause) {
        failures.push({
          operationId: job.operationId,
          failureKind: phase === "policy" ? "policy-store" : "provider",
          phase,
          detail: errorMessage(cause).slice(0, 2_000),
        });
      }
    }
    return failures;
  }

  active() {
    return this.dependencies.delivery.blockingRebuildJobs().length > 0;
  }

  blocked(providerId: string) {
    return this.dependencies.delivery
      .blockingRebuildJobs()
      .some((entry) => entry.providerId === providerId);
  }

  snapshot(instanceId: string) {
    const jobs = Object.values(
      this.dependencies.delivery.snapshot().providerInstances
    ).flatMap((instance) => Object.values(instance.rebuildJobs))
      .filter((job) =>
        job.instanceId === instanceId || job.replacementInstanceId === instanceId
      )
      .sort((left, right) => right.startedAt - left.startedAt);
    const job = jobs.find((entry) => entry.state !== "completed") ?? jobs[0];
    return job
      ? {
          jobId: job.operationId,
          phase: job.state,
          purgedScopes: job.cursor,
          totalScopes: job.frozenSpaceIds.length,
          backfilledTurns: job.backfillCompleted,
          totalTurns: job.backfillTotal,
          startedAt: job.startedAt,
          error: job.errorKind,
        }
      : null;
  }

  private async drive(
    providerId: string,
    instanceId: string,
    operationId: string
  ) {
    let job = this.requireJob(instanceId, operationId);
    if (job.state === "completed") return;
    if (job.state === "failed") throw new Error("Rebuild job 需先开启新 attempt");
    try {
      /* Lifecycle quiesce 会把普通网络关到 stopping；rebuild 自己是已获权的
         destructive lane，必须在第一笔 provider cleanup 之前单独开放传输。
         admission/worker 仍由 rebuild quiesce fence 挡住，不会放行普通流量。 */
      this.dependencies.prepareTransport();
      for (let cursor = job.cursor; cursor < job.frozenSpaceIds.length; cursor += 1) {
        const spaceId = job.frozenSpaceIds[cursor]!;
        await this.dependencies.delivery.drain(spaceId);
        await memorySpaceGate.run(spaceId, () =>
          this.dependencies.delivery.cleanup({
            operationId: `${operationId}:${spaceId}`,
            providerDataInstanceId: instanceId,
            providerId,
            memorySpaceId: spaceId,
            reason: "rebuild",
          })
        );
        await this.dependencies.delivery.advanceRebuild(
          instanceId,
          operationId,
          cursor + 1,
          "purging"
        );
      }
      job = this.requireJob(instanceId, operationId);
      let target: MemoryEffectiveTarget;
      if (!job.replacementInstanceId) {
        await this.dependencies.delivery.freezeRebuildCleanupSet(
          instanceId,
          operationId
        );
        if (this.dependencies.purgeModel(providerId) === "workspace-purge") {
          const frozen = this.requireJob(instanceId, operationId)
            .frozenCleanupRequestIds ?? [];
          for (const requestId of frozen) {
            await this.dependencies.cleanup.drive(instanceId, requestId);
          }
          target = await this.resolveReplacement(providerId, instanceId);
        } else {
          await this.dependencies.runtimes.runRaw(providerId, "runtime-reset");
          target = await this.resolveReplacement(providerId, null);
        }
        await this.dependencies.delivery.advanceRebuild(
          instanceId,
          operationId,
          job.frozenSpaceIds.length,
          "backfilling",
          target.providerDataInstanceId!
        );
      } else {
        target = await this.resolveReplacement(
          providerId,
          job.replacementInstanceId
        );
      }
      this.dependencies.activateTarget(target);
      const { rebuildEpochId } = await this.dependencies.consent.rebuild(
        operationId,
        instanceId,
        target
      );
      if (rebuildEpochId) {
        while (true) {
          const result = await this.dependencies.backfill.tick({ rebuildEpochId });
          if (result.kind === "advanced") continue;
          if (result.kind === "aborted") {
            throw new Error("Rebuild backfill capability 在交付前失效");
          }
          await this.dependencies.delivery.setRebuildBackfill({
            providerDataInstanceId: instanceId,
            operationId,
            rebuildEpochId,
            total: result.grantedTurns,
            completed: result.settledTurns,
          });
          if (result.grantedTurns !== result.settledTurns) {
            throw new Error(
              `Rebuild 回灌对账失败：授权 ${result.grantedTurns}，结算 ${result.settledTurns}`
            );
          }
          break;
        }
      }
      await this.completeFrozenCleanup(instanceId, operationId, target);
      await this.dependencies.consent.completeRebuild(operationId, target);
      await this.open(operationId, target.providerDataInstanceId!);
      await this.dependencies.delivery.completeRebuild(instanceId, operationId);
    } catch (cause) {
      await this.dependencies.delivery.failRebuild(
        instanceId,
        operationId,
        "provider"
      );
      throw cause;
    }
  }

  private async completeFrozenCleanup(
    instanceId: string,
    operationId: string,
    target: MemoryEffectiveTarget
  ) {
    const job = this.requireJob(instanceId, operationId);
    for (const requestId of job.frozenCleanupRequestIds ?? []) {
      const request = this.dependencies.delivery.snapshot().providerInstances[
        instanceId
      ]?.cleanupRequests[requestId];
      if (!request || request.state === "completed") continue;
      await memorySpaceGate.run(request.memorySpaceId, () =>
        this.dependencies.delivery.completeCleanupRequestAfterRebuild({
          operationId: `${operationId}:cleanup-complete:${requestId}`,
          rebuildOperationId: operationId,
          providerDataInstanceId: instanceId,
          providerId: target.providerId,
          cleanupRequestId: requestId,
          memorySpaceId: request.memorySpaceId,
          replacementInstanceId: target.providerDataInstanceId!,
        })
      );
    }
  }

  private async resolveReplacement(
    providerId: string,
    expectedInstanceId: string | null
  ) {
    const target = await this.dependencies.resolveTarget(providerId);
    if (!target.canEnable || !target.providerDataInstanceId) {
      throw new Error(target.blockedReason ?? "Rebuild replacement target 不可用");
    }
    if (expectedInstanceId && target.providerDataInstanceId !== expectedInstanceId) {
      throw new Error("Rebuild replacement instance 已漂移");
    }
    return target;
  }

  private requireJob(instanceId: string, operationId: string) {
    const job = this.dependencies.delivery.rebuildJob(instanceId, operationId);
    if (!job) throw new Error("Rebuild job 不存在");
    return job;
  }

  private async open(operationId: string, subject: string) {
    await this.dependencies.policy.bumpRevocation(
      `${operationId}:open`,
      "rebuild-reopen",
      subject
    );
    this.dependencies.revoked();
  }
}
