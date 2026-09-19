/**
 * [INPUT]: Depends on the admitted encrypted-space deletion feed, scoped BaseStore retention and Base transport cancellation.
 * [OUTPUT]: Stops deleted Base uploads and persists all source/target copies during owner transfer before acknowledging delivery.
 * [POS]: Account-owned Base deletion consumer; no file removal or new persistence authority is introduced.
 */
import { sameScope } from "../../../../../shared/local-storage/contracts";
import type { BaseStore } from "../../../bases/base-store";
import type { ProjectStore } from "../../../projects/store/project-store";
import { pullDeletionPage, type DeletionFeedPorts, type DeletionHead } from "./feed";

export class DesktopBaseDeletions {
  constructor(private readonly ports: DeletionFeedPorts & { bases: BaseStore; projects?: ProjectStore; changed(): void; forget(baseId: string): void }) {}
  async pull(shared?: DeletionHead) {
    const { bases, scope, current, forget, changed } = this.ports;
    const targets = new Map<string, string[]>();
    for (const { ownerKey, snapshot } of bases.listAll()) {
      const id = snapshot.meta.ownerInstanceId;
      targets.set(id, [...(targets.get(id) ?? []), ownerKey]);
    }
    await pullDeletionPage(this.ports, "baseDeletions", async marker => {
      if (marker.entityKind !== "base") return;
      for (const ownerKey of targets.get(marker.entityId) ?? []) {
        if (bases.peek(ownerKey)?.meta.ownerInstanceId !== marker.entityId) continue;
        const envelope = bases.sync.read(ownerKey, marker.entityId);
        if (!envelope.scope && envelope.cloudState === "local-only" && !envelope.tombstones.includes("base")) {
          if (!this.ports.projects) throw new Error("BASE_DELETION_RECOVERY_UNAVAILABLE");
          const plan = bases.sync.initialIdentityPlan(ownerKey, marker.entityId, scope, null);
          await this.ports.projects.portable.ensureRecoveredBaseProject(scope, { ...plan, localOnly: true }); current();
          await bases.sync.retainDeletedIdentity(ownerKey, marker.entityId, scope, plan.recoveryId); current(); changed();
          continue;
        }
        if (!sameScope(envelope.scope, scope)) continue;
        forget(marker.entityId);
        await bases.sync.acceptDeletion(ownerKey, marker.entityId, scope); current(); changed();
      }
    }, shared);
  }
}
