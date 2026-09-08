/**
 * [INPUT]: Depends on the Delivery/cleanup/rebuild owners, owner initialization, errorMessage, and the facade's warning/publish callbacks
 * [OUTPUT]: Provides MemoryMaintenanceController: rebuild-recovery preparation, background rebuild recovery with phase-preserving diagnostics, and attention follow-up actions
 * [POS]: The maintenance coordinator of main/memory/service/support; keeps recovery, compaction, cleanup retry, and rebuild resumption out of the chat facade
 */

import { existsSync } from "node:fs";
import type {
  MemoryAttentionAction,
  MemoryStatusSnapshot,
} from "../../../../../shared/memory-ipc";
import type { MemoryCleanupRunner } from "../../delivery/cleanup-runner";
import type { MemoryDeliveryStore } from "../../delivery/store";
import type {
  MemoryRebuildController,
  MemoryRebuildRecoveryFailure,
} from "../../orchestration/rebuild-controller";
import { errorMessage } from "../../../errors";

type Dependencies = {
  delivery: MemoryDeliveryStore;
  cleanup: MemoryCleanupRunner;
  rebuild: MemoryRebuildController;
  initializeOwners(): Promise<void>;
  enforceActivationCleanup(): Promise<void>;
  setWarning(message: string): void;
  publish(): void;
  status(): MemoryStatusSnapshot;
};

type AttentionFollowup = (subjectRef: string) => Promise<void>;

export class MemoryMaintenanceController {
  private readonly followups: Partial<
    Record<MemoryAttentionAction, AttentionFollowup>
  >;

  constructor(private readonly dependencies: Dependencies) {
    this.followups = {
      compact: async () => {
        await this.dependencies.delivery.compact();
      },
      "retry-cleanup": async () => {
        await this.dependencies.cleanup.driveOne().catch(() => undefined);
      },
      "resume-rebuild": (operationId) => this.resumeRebuild(operationId),
    };
  }

  async prepareRebuildRecovery() {
    if (!existsSync(this.dependencies.delivery.filePath)) return false;
    await this.dependencies.initializeOwners();
    this.dependencies.publish();
    return true;
  }

  async recoverRebuilds() {
    if (!(await this.prepareRebuildRecovery())) return [];
    const failures = await this.dependencies.rebuild.recover();
    await this.reconcileActivationCleanup(failures);
    const failure = failures[0];
    if (failure) {
      const phase = failure.phase === "policy" ? "Policy 授权" : "Provider 清理/回灌";
      this.dependencies.setWarning(`Memory 重建恢复失败（${phase}）：${failure.detail}`);
    }
    this.dependencies.publish();
    return failures;
  }

  async resolveAttention(id: string, action: MemoryAttentionAction) {
    const resolved = await this.dependencies.delivery.resolveAttention(id, action);
    await this.followups[action]?.(resolved.subjectRef);
    this.dependencies.publish();
    return this.dependencies.status();
  }

  private async reconcileActivationCleanup(
    failures: MemoryRebuildRecoveryFailure[]
  ) {
    if (failures.length > 0) return;
    try {
      await this.dependencies.enforceActivationCleanup();
    } catch (cause) {
      failures.push({
        operationId: "activation-cleanup",
        failureKind: "provider",
        phase: "provider",
        detail: errorMessage(cause).slice(0, 2_000),
      });
    }
  }

  private async resumeRebuild(operationId: string) {
    const entry = this.dependencies.delivery.blockingRebuildJobs().find(
      ({ job }) => job.operationId === operationId
    );
    if (!entry) throw new Error("Rebuild job 已失效");
    await this.dependencies.rebuild.start({
      operationId: entry.job.operationId,
      providerId: entry.providerId,
      providerDataInstanceId: entry.job.instanceId,
    });
  }
}
