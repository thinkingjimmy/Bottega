/**
 * [INPUT]: Depends on original Project candidates, live account fencing and the formal latest metadata head; request-bound single-record decoders.
 * [OUTPUT]: Provides bounded candidate discovery and explicit keep or freshly reviewed deletion without automatic rebasing.
 * [POS]: Project conflict product adapter; the existing Store and deletion handoff retain operation authority.
 */
import { createHash } from "node:crypto";
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { sameScope, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { projectDeletionCatalogSchema, projectDeletionReviewSchema, type ProjectDeletionDecision } from "../../../../../../shared/cloud/projects/deletion";
import type { CloudAccountState } from "../../../../../../shared/cloud-ipc";
import type { SyncBindingStore } from "../../account/binding";
import type { AccountTransport } from "../../../runtime/transport";
import type { ProjectStore } from "../../../../projects/store/project-store";
import { projectDeletionCandidate } from "../../../../projects/store/portable/deletion";
import { openProjectHeadForRequest, type ProjectCipherPort } from "@ai-chat/cloud-protocol/projects/encrypted/client";
export class ProjectDeletionRecovery {
  constructor(private ports: { store: ProjectStore; config: CloudBuildConfig; transport: Pick<AccountTransport, "query">;
    binding: Pick<SyncBindingStore, "snapshot">; account(): CloudAccountState; changed(): void;
    crypto(): ProjectCipherPort;
    own(activity: { close(): Promise<void> }): () => void; retry(projectId: string): Promise<void> }) {}
  private current(scope: SyncScope, online = false) {
    const binding = this.ports.binding.snapshot(), account = this.ports.account();
    if (!binding || binding.phase !== "active" || !sameScope(scope, { environment: this.ports.config.environmentId, userId: binding.userId }) ||
      account.profile?.userId !== scope.userId || !["ready", "temporarily-offline"].includes(account.status)) throw new Error("PROJECT_ACCOUNT_CHANGED");
    if (online && (account.status !== "ready" || binding.paused)) throw new Error("PROJECT_ONLINE_SYNC_REQUIRED");
  }
  list(scope: SyncScope, afterId: string | null) {
    this.current(scope);
    const candidates = this.ports.store.list().filter(item => item.id > (afterId ?? "")).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
      .flatMap(item => { const candidate = projectDeletionCandidate(item, scope); return candidate ? [candidate] : []; }).slice(0, 21);
    return projectDeletionCatalogSchema.parse({ items: candidates.slice(0, 20), cursor: candidates.length > 20 ? candidates[19]!.projectId : null, complete: candidates.length <= 20 });
  }
  private async fresh(scope: SyncScope, projectId: string) {
    this.current(scope, true);
    const project = this.ports.store.get(projectId), candidate = project && projectDeletionCandidate(project, scope);
    if (!candidate || !["conflicted", "kept"].includes(candidate.state)) throw new Error("PROJECT_DELETION_REVIEW_CHANGED");
    const crypto = this.ports.crypto();
    const encryptedHead = await this.ports.transport.query("projects/sync:head", { ...protocolHeader(this.ports.config), expectedUserId: scope.userId, projectId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } }); this.current(scope, true);
    const head = encryptedHead && await openProjectHeadForRequest(encryptedHead, projectId, crypto, new AbortController().signal); this.current(scope, true);
    if (!head || head.appId || head.role !== "workspace") throw new Error("PROJECT_DELETION_REVIEW_CHANGED");
    return { head, review: projectDeletionReviewSchema.parse({ projectId, candidateHash: candidate.candidateHash, name: head.name, revision: head.cloudRevision,
      reviewHash: createHash("sha256").update(canonicalJson([scope, candidate.candidateHash, head])).digest("hex") }) };
  }
  private async owned<T>(scope: SyncScope, run: (current: () => void) => Promise<T>) {
    let closed = false, work: Promise<T>;
    const current = () => { if (closed) throw new Error("PROJECT_ACCOUNT_CHANGED"); this.current(scope, true); };
    const release = this.ports.own({ close: async () => { closed = true; await work?.catch(() => {}); } });
    try { work = Promise.resolve().then(() => { current(); return run(current); }); return await work; } finally { release(); }
  }
  review(scope: SyncScope, projectId: string) { return this.owned(scope, async current => { const result = await this.fresh(scope, projectId); current(); return result.review; }); }
  async decide(scope: SyncScope, decision: ProjectDeletionDecision) {
    await this.owned(scope, async current => {
      const { head, review } = await this.fresh(scope, decision.review.projectId); current();
      if (canonicalJson(review) !== canonicalJson(decision.review)) throw new Error("PROJECT_DELETION_REVIEW_CHANGED");
      await this.ports.store.portable.resolveDeletion(scope, decision, head); current(); this.ports.changed();
    });
    if (decision.action === "delete") await this.ports.retry(decision.review.projectId);
  }
  retry(scope: SyncScope, projectId: string) {
    this.current(scope, true); const project = this.ports.store.get(projectId), candidate = project && projectDeletionCandidate(project, scope);
    if (!candidate || candidate.state !== "pending") throw new Error("PROJECT_DELETION_REVIEW_CHANGED");
    return this.ports.retry(projectId);
  }
}
