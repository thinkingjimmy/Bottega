/**
 * [INPUT]: Depends on authenticated remote Base state and the existing Project/Base Store recovery writers.
 * [OUTPUT]: Creates one unbound recovery Project before preserving local data and adopting the canonical remote identity.
 * [POS]: Shared initial-upload/downlink convergence; no cloud baseline or ownership authority is invented.
 */
import type { BaseStore } from "../../../bases/base-store";
import type { ConfirmedBase } from "../../../bases/store/sync/model";
import type { ProjectStore } from "../../../projects/store/project-store";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
export async function recoverInitialBaseIdentity(input: { store: BaseStore; projects: ProjectStore; scope: SyncScope;
  ownerKey: string; baseId: string; confirmed: ConfirmedBase; tombstones: string[]; current(): void }) {
  input.current();
  const plan = input.store.sync.initialIdentityPlan(input.ownerKey, input.baseId, input.scope, input.confirmed);
  if (plan.copyNeeded) await input.projects.portable.ensureRecoveredBaseProject(input.scope, { ...plan, localOnly: true }); input.current();
  await input.store.sync.recoverInitialIdentity(input.ownerKey, input.baseId, input.scope, input.confirmed, input.tombstones, plan.recoveryId);
  input.current(); return input.confirmed.meta.ownerInstanceId;
}
