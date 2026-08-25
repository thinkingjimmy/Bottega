/**
 * [INPUT]: Depends on Project rebind durable journal/capsule with injected Memory effect, Project CAS
 * [OUTPUT]: Provides retain admission-neutral receipt with the new generation-first common workspace rebind driver, and source/target CAS determination
 * [POS]: The project module is the core of the cross-book saga; No UI, ProjectStore or lock, only specified checkpoint order
 */

import type { StoredProject } from "./project-store";
import type {
  ProjectRebindCapsule,
  ProjectRebindExpectation,
  ProjectRebindJournal,
} from "./rebind-journal";

export async function driveProjectRebind<T>(input: {
  capsule: ProjectRebindCapsule;
  journal?: ProjectRebindJournal;
  prepare?: (
    projectId: string,
    operationId: string,
    expectation: ProjectRebindExpectation & { mode: "retain" | "new" }
  ) => Promise<{ applied: boolean }>;
  commit: () => Promise<T>;
}) {
  const { capsule, journal } = input;
  let memoryApplied = capsule.phase !== "prepared";
  try {
    const prepared = await input.prepare?.(capsule.projectId, capsule.operationId, {
      expectedOldMemorySpaceId: capsule.expectedOldMemorySpaceId,
      expectedSpaceGenerationRevision: capsule.expectedSpaceGenerationRevision,
      mode: capsule.mode,
    });
    memoryApplied ||= prepared?.applied === true;
    if (memoryApplied) {
      await journal?.mark(capsule.operationId, "memory-applied");
    }
    return await input.commit();
  } catch (cause) {
    const effectApplied =
      memoryApplied ||
      (cause as { memoryEffectApplied?: boolean }).memoryEffectApplied === true;
    if (journal) {
      try {
        if (effectApplied) {
          await journal.mark(capsule.operationId, "needs-reconcile");
        } else {
          await journal.abortBeforeEffect(capsule.operationId);
        }
      } catch (checkpointCause) {
        console.error("[projects] rebind checkpoint 写入失败", checkpointCause);
      }
    }
    throw cause;
  }
}

export function isProjectRebindTarget(
  current: StoredProject,
  capsule: ProjectRebindCapsule
) {
  return (
    sameBinding(current.workspaceBinding, capsule.targetBinding) &&
    current.dir === capsule.targetDir
  );
}

export function isProjectRebindSource(
  current: StoredProject,
  capsule: ProjectRebindCapsule
) {
  return (
    sameBinding(current.workspaceBinding, capsule.sourceBinding) &&
    current.dir === capsule.sourceDir &&
    current.membershipRevision === capsule.sourceMembershipRevision
  );
}

function sameBinding(
  left: StoredProject["workspaceBinding"],
  right: StoredProject["workspaceBinding"]
) {
  return JSON.stringify(left) === JSON.stringify(right);
}
