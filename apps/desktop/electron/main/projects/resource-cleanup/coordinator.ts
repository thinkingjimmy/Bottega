/**
 * [INPUT]: Depends on ProjectStore lifecycle/intent-bound delete checkpoints and ordered cleanup participant ports
 * [OUTPUT]: Provides ProjectResourceCleanupCoordinator with rebuildable operation handlers, startup enumeration, durable checkpoints, and operation-fenced Project-record removal
 * [POS]: The only legal ProjectStore final-removal path; runtime handlers and retained-resource participants converge before finalization
 */

import type {
  ProjectRemovalOperation,
  ProjectStore,
} from "../project-store";

export type ProjectResourceCleanupContext = Readonly<{
  projectId: string;
  projectLifecycleRevision: number;
  resourceAdmissions: readonly import("../project-store").ProjectResourceAdmission[];
}>;

export type ProjectResourceCleanupParticipant = Readonly<{
  id: string;
  cleanup(context: ProjectResourceCleanupContext): Promise<void>;
}>;

export type ProjectRuntimeCleanupHandler = (
  context: ProjectResourceCleanupContext
) => Promise<void>;

export type ProjectCleanupRecoveryFailure = Readonly<{
  projectId: string;
  operation: ProjectRemovalOperation;
  message: string;
}>;

export const PROJECT_RUNTIME_CLEANUP_PARTICIPANT = "project-runtime";
export const PROJECT_CLEANUP_PLAN = {
  version: 1,
  requiredParticipants: ["extensions", "tools"],
} as const;
type CleanupPlanVersion = typeof PROJECT_CLEANUP_PLAN.version;

export class ProjectResourceCleanupCoordinator {
  private readonly participants = new Map<
    string,
    ProjectResourceCleanupParticipant
  >();
  private readonly runtimeHandlers = new Map<
    ProjectRemovalOperation,
    ProjectRuntimeCleanupHandler
  >();

  constructor(
    private readonly store: ProjectStore,
    private readonly plan: Readonly<{
      version: CleanupPlanVersion;
      requiredParticipants: readonly string[];
    }>
  ) {
    const required = new Set(plan.requiredParticipants);
    if (
      required.size !== plan.requiredParticipants.length ||
      required.has(PROJECT_RUNTIME_CLEANUP_PARTICIPANT)
    ) {
      throw new Error("Project cleanup required participant plan 无效");
    }
  }

  register(participant: ProjectResourceCleanupParticipant) {
    if (participant.id === PROJECT_RUNTIME_CLEANUP_PARTICIPANT) {
      throw new Error("Project cleanup participant id 已保留");
    }
    if (this.participants.has(participant.id)) {
      throw new Error(`Project cleanup participant 重复：${participant.id}`);
    }
    this.participants.set(participant.id, participant);
    return () => this.participants.delete(participant.id);
  }

  registerRuntime(
    operation: ProjectRemovalOperation,
    handler: ProjectRuntimeCleanupHandler
  ) {
    if (this.runtimeHandlers.has(operation)) {
      throw new Error(`Project cleanup runtime handler 重复：${operation}`);
    }
    this.runtimeHandlers.set(operation, handler);
    return () => this.runtimeHandlers.delete(operation);
  }

  assertRequiredParticipantsRegistered() {
    const missing = this.plan.requiredParticipants.filter(
      (participantId) => !this.participants.has(participantId)
    );
    if (missing.length) {
      throw new Error(
        `Project cleanup 缺少 required participant：${missing.join("、")}`
      );
    }
  }

  /** 主进程启动恢复入口：checkpoint 自己决定要跑什么，renderer 不参与重放。 */
  async recoverPending(): Promise<ProjectCleanupRecoveryFailure[]> {
    const failures: ProjectCleanupRecoveryFailure[] = [];
    for (const project of this.store.list()) {
      const checkpoint = project.deletionCheckpoint;
      if (!checkpoint) continue;
      const handler = this.runtimeHandlers.get(checkpoint.operation);
      if (!handler) {
        const message = `未知 Project cleanup operation：${checkpoint.operation}`;
        await this.store.recordDeletionProgress(
          project.id,
          checkpoint.projectLifecycleRevision,
          {
            phase: checkpoint.phase,
            completedParticipants: checkpoint.completedParticipants,
            blocked: message,
          }
        );
        failures.push({
          projectId: project.id,
          operation: checkpoint.operation,
          message,
        });
        continue;
      }
      try {
        await this.drive(
          project.id,
          checkpoint.operation,
          checkpoint.operationIntentId,
          handler
        );
      } catch (cause) {
        failures.push({
          projectId: project.id,
          operation: checkpoint.operation,
          message: cause instanceof Error ? cause.message : String(cause),
        });
      }
    }
    return failures;
  }

  async remove(
    projectId: string,
    operation: ProjectRemovalOperation,
    operationIntentId: string | null = null
  ) {
    const checkpoint = this.store.get(projectId)?.deletionCheckpoint;
    if (!checkpoint && !this.store.get(projectId)) {
      if (this.store.wasDeletedBy(projectId, operation, operationIntentId)) return;
      throw new Error("Project 不存在或没有 exact deletion receipt");
    }
    if (
      checkpoint &&
      (checkpoint.operation !== operation ||
        checkpoint.operationIntentId !== operationIntentId)
    ) {
      throw new Error(
        `Project cleanup operation 已冻结为 ${checkpoint.operation}`
      );
    }
    const durableHandler = this.runtimeHandlers.get(operation);
    if (!durableHandler) {
      throw new Error(`Project cleanup operation 缺少可重建 handler：${operation}`);
    }
    await this.drive(projectId, operation, operationIntentId, durableHandler);
  }

  private async drive(
    projectId: string,
    operation: ProjectRemovalOperation,
    operationIntentId: string | null,
    cleanupRuntime: ProjectRuntimeCleanupHandler
  ) {
    const fenced = await this.store.beginDeletion(projectId, operation, {
      planVersion: this.plan.version,
      operationIntentId,
      requiredParticipants: [
        PROJECT_RUNTIME_CLEANUP_PARTICIPANT,
        ...this.plan.requiredParticipants,
      ],
    });
    const revision = fenced.projectLifecycleRevision;
    const context = {
      projectId,
      projectLifecycleRevision: revision,
      resourceAdmissions:
        fenced.deletionCheckpoint?.frozenResourceAdmissions ?? [],
    };
    let completed = [...(fenced.deletionCheckpoint?.completedParticipants ?? [])];
    try {
      const required = fenced.deletionCheckpoint?.requiredParticipants ?? [];
      const missing = required.filter(
        (participantId) =>
          participantId !== PROJECT_RUNTIME_CLEANUP_PARTICIPANT &&
          !this.participants.has(participantId)
      );
      if (missing.length) {
        throw new Error(
          `Project cleanup 缺少冻结 participant：${missing.join("、")}`
        );
      }
      if (!completed.includes(PROJECT_RUNTIME_CLEANUP_PARTICIPANT)) {
        await cleanupRuntime(context);
        completed = [...completed, PROJECT_RUNTIME_CLEANUP_PARTICIPANT];
        await this.checkpoint(context, completed, "cleaning-resources", null);
      }
      for (const participantId of required) {
        if (
          participantId === PROJECT_RUNTIME_CLEANUP_PARTICIPANT ||
          completed.includes(participantId)
        ) {
          continue;
        }
        const participant = this.participants.get(participantId);
        if (!participant) {
          throw new Error(
            `Project cleanup 缺少冻结 participant：${participantId}`
          );
        }
        await participant.cleanup(context);
        completed = [...completed, participantId];
        await this.checkpoint(context, completed, "cleaning-resources", null);
      }
      if (required.some((participantId) => !completed.includes(participantId))) {
        throw new Error("Project cleanup 冻结 plan 尚未完成");
      }
      await this.checkpoint(context, completed, "ready-to-remove", null);
      await this.store.finalizeDeletion(projectId, revision);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await this.checkpoint(context, completed, "cleaning-resources", message)
        .catch(() => undefined);
      throw cause;
    }
  }

  cancel(projectId: string, expectedProjectLifecycleRevision: number) {
    return this.store.cancelDeletion(projectId, expectedProjectLifecycleRevision);
  }

  private checkpoint(
    context: ProjectResourceCleanupContext,
    completedParticipants: readonly string[],
    phase: "cleaning-resources" | "ready-to-remove",
    blocked: string | null
  ) {
    return this.store.recordDeletionProgress(
      context.projectId,
      context.projectLifecycleRevision,
      {
        phase,
        completedParticipants: [...new Set(completedParticipants)],
        blocked,
      }
    );
  }
}
