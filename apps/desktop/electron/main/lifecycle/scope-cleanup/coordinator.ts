/**
 * [INPUT]: Depends on the existing lifecycle journal/gate and mandatory owner cleanup participants
 * [OUTPUT]: Runs frozen cleanup plans with durable per-owner checkpoints and fences new scope admission
 * [POS]: Cross-Store coordinator; the gate is acquired before conversations and leaf Store queues
 */
import { createHash } from "node:crypto";
import { canonicalJson, type SyncScope } from "../../../../shared/local-storage/contracts";
import { AdmissionGate } from "../admission-gate";
import { LifecycleIntentStore } from "../intent-store";
import { reached, type LifecycleIntent } from "../intent-types";
import { CLEANUP_PARTICIPANTS, cleanupCheckpointSchema, scopeCleanupPlanSchema, type CleanupCheckpoint, type CleanupParticipant, type ScopeCleanupPlan } from "./model";
const hash = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export type CleanupParticipants = { [K in CleanupParticipant]: (plan: ScopeCleanupPlan) => Promise<unknown> };
export class ScopeCleanupCoordinator {
  constructor(private journal: LifecycleIntentStore, private gate: AdmissionGate, private participants: CleanupParticipants,
    private fault?: (phase: "before" | "after", participant: CleanupParticipant) => Promise<void>) {}
  async withScope<T>(_scope: SyncScope, work: () => Promise<T>): Promise<T> {
    return this.gate.runExclusiveAll(["sync-scope"], async () => {
      if ((await this.journal.listPending()).some(intent => intent.kind === "scope-cleanup")) throw new Error("PREVIOUS_SCOPE_CLEANUP_REQUIRED");
      return work();
    });
  }
  run(input: ScopeCleanupPlan) {
    const plan = scopeCleanupPlanSchema.parse(input);
    return this.gate.admitAndRun({ kind: "scope-cleanup", requestId: plan.operationId, input: plan }, intent => this.resume(intent));
  }
  async recover() {
    for (const intent of await this.journal.listPending()) if (intent.kind === "scope-cleanup") {
      await this.gate.runRecovery(intent.intentId, current => this.resume(current));
    }
  }
  private async resume(initial: LifecycleIntent) {
    const plan = scopeCleanupPlanSchema.parse(initial.input), planHash = hash(plan);
    let intent = initial;
    const checkpoints = { ...(intent.recoveryState.checkpoints as Partial<Record<CleanupParticipant, CleanupCheckpoint>> | undefined) };
    for (const participant of CLEANUP_PARTICIPANTS) {
      if (reached("scope-cleanup", intent, participant)) {
        const checkpoint = cleanupCheckpointSchema.parse(checkpoints[participant]);
        if (checkpoint.planHash !== planHash || checkpoint.operationId !== plan.operationId || checkpoint.participant !== participant) throw new Error("CLEANUP_CHECKPOINT_CONFLICT");
        continue;
      }
      await this.fault?.("before", participant);
      const evidence = await this.participants[participant](plan);
      await this.fault?.("after", participant);
      checkpoints[participant] = cleanupCheckpointSchema.parse({ operationId: plan.operationId, participant, planHash, evidenceHash: hash(evidence), state: "complete" });
      intent = await this.journal.advance(intent.intentId, participant, { checkpoints });
    }
    return { status: "done" as const, receipt: { operationId: plan.operationId, planHash, checkpoints } };
  }
}
