/**
 * [INPUT]: Depends on authenticated account admission, durable binding, actual inventory and a scoped synchronization run.
 * [OUTPUT]: Owns durable consent/status projection, setup-scoped failures and inventory-bound cleanup with identity fences and a retryable cleanup failure.
 * [POS]: Main lifecycle coordinator; durable business state remains in the four existing Stores.
 */
import { randomUUID } from "node:crypto";
import { hashCanonical, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { syncProgressSchema, type SyncCleanupReview, type SyncProgress, type SyncReview } from "../../../../../shared/cloud/sync";
import type { EncryptedConsent } from "../../encryption/model";
import type { CloudAccountState } from "../../../../../shared/cloud-ipc";
import type { SyncBindingStore } from "../account/binding";
import type { AccountScopeLifecycle } from "../account/cleanup/lifecycle";
import { captureScopeCleanup, type CleanupOwners } from "../account/cleanup/plan";
import { scanInitialSync } from "./scan";
type Run = { start(): Promise<void>; close(): Promise<void>; openChat?(chatId: string): Promise<void> };
type CleanupPurpose = "disabled" | "account-switch";
type Ports = { config: CloudBuildConfig; userData: string; binding: SyncBindingStore; scope: AccountScopeLifecycle; owners: CleanupOwners;
  account(): CloudAccountState; changed(value: SyncProgress): void;
  createRun(changed: (value: Partial<SyncProgress>) => void): Run };
export class InitialSyncController {
  private generation = 0;
  private closed = false;
  private review: { userId: string; value: SyncReview } | null = null;
  private cleanup: { userId: string; value: SyncCleanupReview; digest: string; generation: number; purpose: CleanupPurpose; inspectedAt: number } | null = null;
  private scanning: AbortController | null = null;
  private run: Run | null = null;
  private identity = "";
  private progress = syncProgressSchema.parse({ status: "not-connected" });
  constructor(private readonly ports: Ports) {}
  private publish(value: Partial<SyncProgress>) { if (!this.closed) { this.progress = syncProgressSchema.parse({ ...this.progress, ...value }); this.ports.changed(this.progress); } }
  private ready() {
    const account = this.ports.account();
    if (this.closed || account.status !== "ready" || !account.profile || !account.deviceId) throw new Error("SYNC_ACCOUNT_UNAVAILABLE");
    return account.profile.userId;
  }
  async openChat(chatId: string) { await this.run?.openChat?.(chatId); }
  async inspect() {
    const userId = this.ready(), generation = this.generation;
    if (this.ports.binding.snapshot()) throw new Error("SYNC_ALREADY_APPROVED");
    this.cancelReview(); const controller = new AbortController(); this.scanning = controller;
    this.publish({ status: "scanning", error: null });
    try {
      const value = await scanInitialSync(this.ports.owners, this.ports.userData, controller.signal);
      if (generation !== this.generation || this.ready() !== userId) throw new Error("cloud-request-superseded");
      this.review = { userId, value }; return value;
    } catch (error) {
      if (!controller.signal.aborted) this.publish({ status: "not-connected", error: "scan-failed" }); throw error;
    } finally {
      if (this.scanning === controller) { this.scanning = null; if (this.progress.status === "scanning") this.publish({ status: "not-connected" }); }
    }
  }
  cancelReview() {
    this.scanning?.abort(new Error("SYNC_REVIEW_CANCELLED")); this.scanning = null; this.review = null;
    if (!this.ports.binding.snapshot()) this.publish({ status: "not-connected", error: null });
  }
  validateReview(reviewId: string) {
    const userId = this.ready(), review = this.review;
    if (!review || review.userId !== userId || review.value.reviewId !== reviewId || Date.now() - review.value.inspectedAt > 10 * 60_000) {
      this.publish({ status: this.ports.binding.snapshot() ? "error" : "not-connected", error: "review-expired" }); throw new Error("SYNC_REVIEW_EXPIRED");
    }
    return review;
  }
  /* The binding is written paused on purpose, so this never resumes: the setup operation
     unpauses and resumes once its consent is committed. Resuming here would publish a
     "Paused" row with a Resume button the system is one await away from leaving. */
  async approve(reviewId: string, encryption: EncryptedConsent, current: () => boolean = () => true) {
    const { userId, value } = this.validateReview(reviewId), generation = this.generation;
    if (!current()) throw new Error("cloud-request-superseded");
    await this.ports.scope.approve({ manifestId: reviewId, consentHash: hashCanonical({ review: value, encryption }), encryption }, current);
    if (!current()) throw new Error("cloud-request-superseded");
    if (generation !== this.generation || this.ready() !== userId) throw new Error("cloud-request-superseded");
    this.review = null; this.publish({ status: "initializing", error: null, totalBytes: value.native.messageBytes + value.native.attachmentBytes +
      value.native.importedBytes + value.bases.bytes + value.bases.imageBytes + value.homes.bytes + value.apps.bytes + (value.skills?.bytes ?? 0) });
  }
  accountChanged() {
    const account = this.ports.account(), identity = `${account.status}:${account.profile?.userId ?? ""}:${account.deviceId ?? ""}`;
    if (identity === this.identity) return; this.identity = identity;
    this.generation++; this.cancelReview(); this.cleanup = null;
    if (account.status === "ready") { this.resume(); return; }
    const binding = this.ports.binding.snapshot();
    if (binding) this.publish({ status: binding.phase === "closing" ? "closing" : binding.paused ? "paused" : "offline" });
    else this.publish({ status: "not-connected", pending: 0, conflicts: 0, appIssues: [], error: null, phase: null });
  }
  resume() {
    const account = this.ports.account();
    if (this.closed || account.status !== "ready" || !account.profile || !account.deviceId || this.run) return;
    const binding = this.ports.binding.snapshot();
    if (!binding) { this.publish({ status: "not-connected", error: null }); return; }
    if (binding.phase === "closing") { this.publish({ status: "closing" }); return; }
    if (binding.paused) { this.publish({ status: "paused" }); return; }
    if (!this.ports.scope.canSynchronize(account.profile.userId, account.deviceId)) {
      this.publish({ status: binding.phase === "initializing" ? "initializing" : "offline" }); return;
    }
    const generation = ++this.generation;
    const run = this.ports.createRun(value => { if (this.run === run && generation === this.generation) this.publish(value); });
    let release = () => {};
    const activity = { close: async () => { await run.close(); if (this.run === run) this.run = null; release();
      queueMicrotask(() => { if (!this.closed) this.resume(); }); } };
    try { release = this.ports.scope.own(activity); this.run = run; }
    catch (error) { void run.close(); throw error; }
    this.publish({ status: binding.phase === "initializing" ? "initializing" : "syncing", error: null });
    void run.start().catch(() => { if (this.run === run && generation === this.generation) this.publish({ status: "error", error: "upload-failed" }); });
  }
  async pause(paused: boolean) {
    this.ready(); await this.ports.scope.pause(paused);
    if (paused) { this.generation++; this.publish({ status: "paused" }); } else this.resume();
  }
  /** Reports which tail the caller owes: a finished disconnect still has to clear the native key cache. */
  async retry(): Promise<"disconnected" | "resumed"> {
    this.ready();
    const binding = this.ports.binding.snapshot();
    // A cleanup that failed leaves the binding closing; disconnect is idempotent and keeps its operation.
    if (binding?.phase === "closing") { await this.disconnect(binding.cleanup!.reason); await this.readmit(); return "disconnected"; }
    await this.ports.scope.pause(true); await this.ports.scope.pause(false); this.resume(); return "resumed";
  }
  /** Runs a cleanup and, on failure, states that this account is still being disconnected. */
  private async disconnect(reason: Parameters<AccountScopeLifecycle["disconnect"]>[0], beforeCleanup?: () => Promise<void>) {
    try { await this.ports.scope.disconnect(reason, beforeCleanup); }
    catch (error) {
      if (this.ports.binding.snapshot()?.phase === "closing") this.publish({ status: "closing", error: "cleanup-failed" });
      throw error;
    }
  }
  private async readmit() {
    const account = this.ports.account();
    if (account.status === "ready" && account.profile && account.deviceId) await this.ports.scope.admit(account.profile.userId, account.deviceId);
    this.publish({ status: "not-connected", pending: 0, conflicts: 0, appIssues: [], phase: null, error: null });
  }
  private async cleanupInventory(userId: string) {
    const plan = await captureScopeCleanup(this.ports.owners, { environment: this.ports.config.environmentId, userId }, "cleanup-review");
    const counts = { mirrors: plan.chats.filter(chat => !chat.retain).length, retainedChats: plan.chats.filter(chat => chat.retain).length,
      retainedHomes: plan.chats.filter(chat => chat.retain && chat.homeIntentId).length, retainedBases: plan.bases.filter(base => base.retain).length,
      mirroredBases: plan.bases.filter(base => !base.retain).length, mirroredProjects: plan.discardedProjectIds?.length ?? 0,
      retainedProjects: plan.projectIds.length, mirroredApps: plan.discardedAppIds?.length ?? 0, retainedApps: plan.appIds.length,
      pending: await this.ports.scope.pendingCount() };
    return { counts, digest: hashCanonical({ plan, counts, binding: this.ports.binding.snapshot() }) };
  }
  private cleanupAccount(purpose: CleanupPurpose) {
    const account = this.ports.account();
    if (this.closed || !account.profile || !account.deviceId || account.status !== (purpose === "account-switch" ? "account-switch-required" : "ready")) throw new Error("SYNC_ACCOUNT_UNAVAILABLE");
    return account;
  }
  async inspectCleanup(purpose: CleanupPurpose = "disabled") {
    this.cleanupAccount(purpose);
    const binding = this.ports.binding.snapshot(), generation = this.generation;
    if (!binding || binding.phase === "closing") return null;
    const inventory = await this.cleanupInventory(binding.userId), value = { reviewId: randomUUID(), ...inventory.counts };
    this.cleanupAccount(purpose);
    if (generation !== this.generation || this.ports.binding.snapshot()?.manifestId !== binding.manifestId) throw new Error("cloud-request-superseded");
    this.cleanup = { userId: binding.userId, value, digest: inventory.digest, generation, purpose, inspectedAt: Date.now() }; return value;
  }
  private async confirmCleanup(reviewId: string, purpose: CleanupPurpose) {
    this.cleanupAccount(purpose);
    const binding = this.ports.binding.snapshot();
    const review = this.cleanup;
    if (!binding || !review || review.value.reviewId !== reviewId || review.purpose !== purpose || review.userId !== binding.userId ||
      review.generation !== this.generation || Date.now() - review.inspectedAt > 10 * 60_000) throw new Error("SYNC_CLEANUP_REVIEW_CHANGED");
    const inventory = await this.cleanupInventory(binding.userId);
    this.cleanupAccount(purpose);
    if (this.cleanup !== review || review.generation !== this.generation || review.digest !== inventory.digest) throw new Error("SYNC_CLEANUP_REVIEW_CHANGED");
    this.cleanup = null;
  }
  async switchAccount(reviewId: string) {
    await this.disconnect("account-switch", () => this.confirmCleanup(reviewId, "account-switch"));
  }
  async disable(reviewId: string) {
    await this.disconnect("disabled", () => this.confirmCleanup(reviewId, "disabled"));
    await this.readmit();
  }
  async close() { this.closed = true; this.generation++; this.scanning?.abort(); this.review = null; await this.run?.close(); this.run = null; }
}
