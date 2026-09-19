/**
 * [INPUT]: Depends on current account ownership, ProjectStore's original deletion operation and authenticated metadata delivery.
 * [OUTPUT]: Requires a confirmed cloud tombstone before ordinary or archived Project cleanup may remove local data.
 * [POS]: Project removal handoff; failed or unknown results retain the same request and all local resources.
 */
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { sameScope } from "../../../../../../shared/local-storage/contracts";
import type { CloudAccountState } from "../../../../../../shared/cloud-ipc";
import type { ProjectStore } from "../../../../projects/store/project-store";
import type { SyncBindingStore } from "../../account/binding";
import type { AccountTransport } from "../../../runtime/transport";
import { DesktopProjectSync } from "../../projects/project-sync";
import { ProjectDeletionRecovery } from "./recovery";
import type { ProjectCipherPort } from "@ai-chat/cloud-protocol/projects/encrypted/client";
export class CloudProjectRemoval {
  private readonly pending = new Map<string, Promise<void>>();
  constructor(private ports: { config: CloudBuildConfig; store: ProjectStore; binding: Pick<SyncBindingStore, "snapshot">;
    account(): CloudAccountState; transport: Pick<AccountTransport, "query" | "mutate">; changed(): void;
    crypto(): ProjectCipherPort;
    own(activity: { close(): Promise<void> }): () => void }) {}
  recovery() { return new ProjectDeletionRecovery({ ...this.ports, retry: id => this.prepare(id) }); }
  prepare(projectId: string) {
    const existing = this.pending.get(projectId); if (existing) return existing;
    const work = this.run(projectId).finally(() => { this.pending.delete(projectId); }); this.pending.set(projectId, work); return work;
  }
  private async run(projectId: string) {
    const project = this.ports.store.get(projectId); if (!project?.sync) return;
    const scope = project.sync.scope; let closed = false;
    const current = () => {
      const binding = this.ports.binding.snapshot(), account = this.ports.account();
      if (closed || !binding || binding.phase !== "active" || !["ready", "temporarily-offline"].includes(account.status) || account.profile?.userId !== scope.userId ||
        !sameScope(scope, { environment: this.ports.config.environmentId, userId: binding.userId })) throw new Error("PROJECT_ONLINE_SYNC_REQUIRED");
    };
    current(); let failure: unknown = null;
    const sync = new DesktopProjectSync({ ...this.ports, scope, changed: () => this.ports.changed(), failure: (_id, error) => { failure = error; } });
    let work: Promise<void> = Promise.resolve();
    const release = this.ports.own({ close: async () => { closed = true; await sync.close(); await work.catch(() => {}); } });
    try {
      work = Promise.resolve().then(async () => {
        current(); await this.ports.store.portable.requestDeletion(scope, projectId); current(); this.ports.changed();
        if (this.ports.store.portable.read(scope, projectId).deleted) return;
        if (this.ports.account().status !== "ready" || this.ports.binding.snapshot()?.paused) throw new Error("PROJECT_DELETION_PENDING");
        await sync.flush(projectId); current();
        if (failure) throw failure;
        if (!this.ports.store.portable.read(scope, projectId).deleted) throw new Error("PROJECT_DELETION_REVIEW_REQUIRED");
      });
      await work;
    } finally { await sync.close(); release(); }
  }
}
