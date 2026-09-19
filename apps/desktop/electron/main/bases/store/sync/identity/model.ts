/**
 * [INPUT]: Depends on the current unpublished Base generation, authenticated cloud snapshot and canonical scope hashing.
 * [OUTPUT]: Provides content-bound recovery provenance and stable independent Project/Base identities.
 * [POS]: Pure initial-identity planner; previously synchronized or detached data never enters automatic recovery.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, storageIdSchema, syncScopeSchema, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import type { StoredBase } from "../../../base-store-model";
import type { ConfirmedBase } from "../model";
import { logicalBaseSnapshot } from "@ai-chat/base-ui/metadata/logical-snapshot";
import { allocateForkTitle } from "../../../../chats/chat-fork";
export const initialIdentityRecoverySchema = z.object({ scope: syncScopeSchema, ownerKey: z.string().min(1).max(256),
  baseId: storageIdSchema, remoteBaseId: storageIdSchema, sourceHash: z.string().regex(/^[a-f0-9]{64}$/),
  recoveryId: storageIdSchema, projectId: storageIdSchema, recoveredBaseId: storageIdSchema }).strict();
const digest = (value: unknown) => createHash("sha256").update(canonicalJson(value)).digest("hex");
export function initialIdentityRecoveryPlan(source: StoredBase, ownerKey: string, scope: SyncScope, confirmed: ConfirmedBase | null, known: Iterable<StoredBase> = []) {
  const sync = source.sync;
  if (confirmed && canonicalJson(source.meta.owner) !== canonicalJson(confirmed.meta.owner) ||
    sync.cloudState !== "local-only" || sync.scope || sync.confirmed || sync.pendingOperations.length || sync.conflictCandidates.length ||
    sync.receipts.length || sync.tombstones.length || sync.detachedCustody.length || sync.promotionExport || sync.ownershipTransfer ||
    sync.remoteOwnershipTransfer || sync.recoveredFrom || sync.initialIdentityRecovery) throw new Error("BASE_INITIAL_RECOVERY_UNAVAILABLE");
  const sourceHash = digest({ snapshot: logicalBaseSnapshot(source), gallery: source.gallery, history: source.history });
  const remoteBaseId = confirmed?.meta.ownerInstanceId ?? source.meta.ownerInstanceId;
  const recoveryId = digest(["base-initial-identity-recovery", scope, ownerKey, source.meta.ownerInstanceId, remoteBaseId, sourceHash]);
  const projectId = `recovered_${recoveryId.slice(0, 40)}`, baseId = `base_${recoveryId.slice(0, 40)}`;
  const siblings = [...known], existing = siblings.find(item => item.meta.ownerInstanceId === baseId);
  return { recoveryId, projectId, baseId, name: existing?.meta.name ?? allocateForkTitle(source.meta.name.slice(0, 90), siblings.map(item => item.meta.name)),
    copyNeeded: !confirmed || canonicalJson(comparable(source)) !== canonicalJson(comparable(confirmed)),
    provenance: initialIdentityRecoverySchema.parse({ scope, ownerKey, baseId: source.meta.ownerInstanceId,
      remoteBaseId, sourceHash, recoveryId, projectId, recoveredBaseId: baseId }) };
}
function comparable(snapshot: Pick<StoredBase, "meta" | "rows">) {
  const { ownerInstanceId: _identity, ...meta } = logicalBaseSnapshot(snapshot).meta;
  return { meta, rows: snapshot.rows };
}
export type InitialIdentityRecoveryPlan = ReturnType<typeof initialIdentityRecoveryPlan>;
