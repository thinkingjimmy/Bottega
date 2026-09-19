/**
 * [INPUT]: Depends on current account custody, authenticated App metadata and the original AppStore deletion queue; request-bound single-record decoders.
 * [OUTPUT]: Provides bounded deletion reviews, definitive pre-capture expiry, immutable confirmation and original-request retry.
 * [POS]: Desktop App deletion front door; renderer input cannot replace reviewed identity or revision.
 */
import { randomUUID } from "node:crypto";
import { protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import type { AppReceipt } from "@ai-chat/cloud-protocol/apps/model";
import type { AppStore } from "../../apps/store/app-store";
import { sameScope, type SyncScope } from "../../../../shared/local-storage/contracts";
import type { CloudAppDeleteReview } from "../../../../shared/cloud/apps/model";
import type { AccountTransport } from "../runtime/transport";
import { DesktopAppDeletionPublisher } from "../sync/deletion/app-publisher";
import { openAppHeadForRequest, type AppCipherPort } from "@ai-chat/cloud-protocol/apps/encrypted/client";
import { openProjectHeadForRequest } from "@ai-chat/cloud-protocol/projects/encrypted/client";
import type { AppDeletionRequest } from "../../apps/store/portable/deletion-model";
type Held = CloudAppDeleteReview & { scope: SyncScope; projectId: string; baseId: string; expiresAt: number; baseline: NonNullable<AppDeletionRequest["baseline"]> };
type Capture = { scope: SyncScope; retainBase: boolean; ready: Promise<unknown> };
function outcome(receipt: AppReceipt) {
  return ["applied", "converged"].includes(receipt.outcome) || receipt.reason === "deleted" ? "deleted" :
    receipt.outcome === "conflicted" ? "conflicted" : "blocked";
}
export class CloudAppDeletionService {
  private reviews = new Map<string, Held>();
  private captures = new Map<string, Capture>();
  constructor(private ports: { config: CloudBuildConfig; apps: AppStore; transport: Pick<AccountTransport, "query" | "mutate">;
    crypto(): AppCipherPort; changed(): void; now(): number }) {}
  async review(appId: string, current: () => SyncScope): Promise<CloudAppDeleteReview> {
    const scope = current(), entry = this.ports.apps.portable.get(appId);
    if (!entry || !sameScope(entry.scope, scope) || entry.tombstoned) throw new Error("APP_DESCRIPTOR_UNAVAILABLE");
    if (this.ports.apps.portable.deletion.list(scope).some(item => item.operation.appId === appId && !item.receipt)) throw new Error("APP_DELETION_PENDING");
    this.expire(scope.userId); if (this.reviews.size >= 8) throw new Error("APP_REVIEW_LIMIT");
    const crypto = this.ports.crypto(), signal = new AbortController().signal;
    const header = { ...protocolHeader(this.ports.config), expectedUserId: scope.userId,
      encryptedSpace: { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint } };
    const encrypted = await this.ports.transport.query("apps/api:get", { ...header, appId }); current();
    const app = encrypted && await openAppHeadForRequest(encrypted, appId, crypto, signal); current();
    if (!app || app.appId !== appId || app.projectId !== entry.descriptor.projectId || app.baseId !== entry.descriptor.baseId) throw new Error("APP_DELETION_REVIEW_CHANGED");
    const projectHead = await this.ports.transport.query("projects/sync:head", { ...header, projectId: app.projectId }); current();
    if (!projectHead) throw new Error("APP_DELETION_REVIEW_CHANGED");
    const project = await openProjectHeadForRequest(projectHead, app.projectId, crypto, signal); current();
    const base = await this.ports.transport.query("bases/pages:head", { ...header, baseId: app.baseId }); current();
    if (this.reviews.size >= 8) throw new Error("APP_REVIEW_LIMIT");
    const review = { requestId: randomUUID(), appId, name: app.displayName, revision: app.revision };
    this.reviews.set(review.requestId, { ...review, scope, projectId: app.projectId, baseId: app.baseId, expiresAt: this.ports.now() + 300_000,
      baseline: { app, project, baseRevision: base.cloudRevision, baseSchemaRevision: base.schemaRevision } });
    return review;
  }
  async confirm(requestId: string, retainBase: boolean, current: () => SyncScope) {
    const scope = current(), capturing = this.captures.get(requestId);
    if (capturing) {
      if (!sameScope(capturing.scope, scope) || capturing.retainBase !== retainBase) throw new Error("APP_DELETION_REQUEST_CHANGED");
      await capturing.ready; current();
    }
    const original = this.ports.apps.portable.deletion.get(scope, requestId);
    if (original) {
      if (original.operation.retainBase !== retainBase) throw new Error("APP_DELETION_REQUEST_CHANGED");
    } else {
      const review = this.reviews.get(requestId);
      if (!review || !sameScope(review.scope, scope) || review.expiresAt <= this.ports.now()) return "review-expired" as const;
      const ready = this.ports.apps.portable.deletion.capture({ scope, projectId: review.projectId, baseId: review.baseId,
        baseline: review.baseline,
        operation: { kind: "delete", operationId: requestId, appId: review.appId, expectedRevision: review.revision, retainBase } });
      // A queued Store commit is already admitted even while its synchronous read still returns no request.
      this.captures.set(requestId, { scope, retainBase, ready });
      try { await ready; } finally { this.captures.delete(requestId); }
      this.reviews.delete(requestId); current();
    }
    return this.retry(requestId, current);
  }
  async retry(requestId: string, current: () => SyncScope) {
    const scope = current();
    if (!this.ports.apps.portable.deletion.get(scope, requestId)) throw new Error("APP_DELETION_REQUEST_UNAVAILABLE");
    await new DesktopAppDeletionPublisher({ ...this.ports, scope, current: () => { current(); } }).deliver(requestId); current();
    const receipt = this.ports.apps.portable.deletion.get(scope, requestId)?.receipt;
    if (!receipt) throw new Error("APP_DELETION_RECEIPT_UNAVAILABLE");
    return outcome(receipt);
  }
  async dismiss(requestId: string, current: () => SyncScope) {
    await this.ports.apps.portable.deletion.dismiss(current(), requestId); current();
  }
  discard(requestId: string, userId: string) { if (this.reviews.get(requestId)?.scope.userId === userId) this.reviews.delete(requestId); }
  expire(userId?: string) {
    for (const [id, review] of this.reviews) if (review.scope.userId !== userId || review.expiresAt <= this.ports.now()) this.reviews.delete(id);
  }
  close() { this.reviews.clear(); }
}
