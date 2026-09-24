/**
 * [INPUT]: Depends on the durable account binding, actual Store owners, the late-bound account-config cleanup port and the shared lifecycle gate/journal.
 * [OUTPUT]: Coordinates enrollment, activity shutdown, original conversion/installation settlement and reviewed cross-Store cleanup, including unresolved deletion custody, before rebinding.
 * [POS]: Main account scope owner; business queues stay inside Chat/Base/Project/App Stores.
 */
import type { CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { sameScope, type RuntimeStorageMode } from "../../../../../../shared/local-storage/contracts";
import type { AdmissionGate } from "../../../../lifecycle/admission-gate";
import type { LifecycleIntentStore } from "../../../../lifecycle/intent-store";
import { ScopeCleanupCoordinator } from "../../../../lifecycle/scope-cleanup/coordinator";
import { CLEANUP_PARTICIPANTS, cleanupCheckpointSchema, scopeCleanupPlanSchema } from "../../../../lifecycle/scope-cleanup/model";
import { storageCleanupParticipants } from "../../../../lifecycle/scope-cleanup/participants";
import { removeAccountDownloadCache } from "../../../files/cleanup";
import type { SyncBindingStore } from "../binding";
import { captureScopeCleanup, type CleanupOwners } from "./plan";
import { CleanupBytes } from "./bytes";
import { AccountConversionCleanup, type ConversionCleanupServices } from "./conversions";
import type { CloudAppInstaller } from "../../../../apps/install/cloud/installer";
import type { AccountConfigCleanup } from "../../account-config/cleanup";
type Activity = { close(): Promise<void> | void };
export class AccountScopeLifecycle {
  private readonly activities = new Set<Activity>();
  private readonly localActivities = new Set<Activity>();
  private flight: Promise<void> | null = null;
  private closed = false;
  private admitted = false;
  private contentAdmission = true;
  private generation = 0;
  private transition: Promise<void> = Promise.resolve();
  private identity: { userId: string; deviceId: string } | null = null;
  private readonly bytes: CleanupBytes;
  private readonly cleanup: ScopeCleanupCoordinator;
  constructor(private input: { userData: string; config: CloudBuildConfig; binding: SyncBindingStore; owners: CleanupOwners;
    journal: LifecycleIntentStore; gate: AdmissionGate; conversions?: ConversionCleanupServices; installations?: Pick<CloudAppInstaller, "settleScopeCleanup">;
    accountConfig?: Pick<AccountConfigCleanup, "cleanupScope"> }) {
    this.bytes = new CleanupBytes(input.owners);
    const participants = storageCleanupParticipants({ ...input.owners, verifyBlob: proof => this.bytes.verify(proof), accountConfig: input.accountConfig });
    this.cleanup = new ScopeCleanupCoordinator(input.journal, input.gate, { ...participants, blobs: async plan => {
      const retained = await participants.blobs(plan);
      await removeAccountDownloadCache(input.userData, { environmentId: input.config.environmentId,
        deploymentId: input.config.deploymentId, userId: plan.scope.userId }); return retained;
    } });
  }
  async initialize() {
    const binding = this.input.binding.snapshot();
    if (binding?.phase === "closing") await this.disconnect(binding.cleanup!.reason);
  }
  async admit(userId: string, deviceId: string) {
    const generation = this.generation;
    await this.initialize();
    if (this.closed || generation !== this.generation) throw new Error("cloud-request-superseded");
    await this.serialize(async () => {
      if (this.closed || generation !== this.generation) throw new Error("cloud-request-superseded");
      this.input.binding.assertAccount(userId, deviceId);
      this.input.binding.restrictEnrollment(!this.contentAdmission);
      await this.configure(this.input.binding.mode());
      if (this.closed || generation !== this.generation) throw new Error("cloud-request-superseded");
      this.admitted = true; this.identity = { userId, deviceId };
    });
  }
  async approve(input: Pick<import("../binding").SyncBinding, "manifestId" | "consentHash"> & { encryption: import("../binding").SyncConsent }, current: () => boolean = () => true) {
    const generation = this.generation, identity = this.identity;
    if (!this.admitted || !identity || this.closed || !current()) throw new Error("SYNC_SCOPE_INACTIVE");
    await this.serialize(async () => {
      if (generation !== this.generation || !this.admitted || this.closed || !current()) throw new Error("cloud-request-superseded");
      await this.input.binding.approve({ ...input, ...identity });
      if (generation !== this.generation || !this.admitted) throw new Error("cloud-request-superseded");
      await this.configure(this.input.binding.mode());
      if (generation !== this.generation || !this.admitted) throw new Error("cloud-request-superseded");
    });
  }
  canSynchronize(userId: string, deviceId: string) {
    return this.admitted && this.contentAdmission && !this.closed && this.identity?.userId === userId && this.identity.deviceId === deviceId;
  }
  async allowContent(allowed: boolean) {
    this.contentAdmission = allowed; this.input.binding.restrictEnrollment(!allowed);
    if (!allowed) await this.stopActivities();
    await this.serialize(() => this.configure(this.input.binding.mode()));
  }
  private serialize(work: () => Promise<void>) {
    const next = this.transition.then(work);
    this.transition = next.catch(() => {});
    return next;
  }
  own(activity: Activity) {
    if (this.closed || !this.admitted || !this.contentAdmission || !this.input.binding.snapshot() || this.input.binding.snapshot()?.phase === "closing" || this.input.binding.snapshot()?.paused) throw new Error("SYNC_SCOPE_INACTIVE");
    this.activities.add(activity); return () => this.activities.delete(activity);
  }
  ownLocal(activity: Activity) {
    const binding = this.input.binding.snapshot();
    if (this.closed || !binding || binding.phase === "closing") throw new Error("SYNC_SCOPE_INACTIVE");
    this.localActivities.add(activity); return () => this.localActivities.delete(activity);
  }
  async pause(paused: boolean) {
    await this.input.binding.setPaused(paused);
    if (paused) await this.stopActivities();
  }
  private async stopActivities(includeLocal = false) {
    const activities = [...this.activities, ...(includeLocal ? this.localActivities : [])];
    const results = await Promise.allSettled(activities.map(async activity => { await activity.close(); this.activities.delete(activity); this.localActivities.delete(activity); }));
    const failed = results.find(result => result.status === "rejected");
    if (failed?.status === "rejected") throw failed.reason;
  }
  async suspend(options: { closeEnrollment?: boolean } = {}) {
    this.generation++; this.admitted = false;
    if (options.closeEnrollment) this.input.binding.restrictEnrollment(true);
    await this.stopActivities();
    if (options.closeEnrollment) await this.serialize(() => this.configure(this.input.binding.mode()));
  }
  private async configure(mode: RuntimeStorageMode) {
    const { owners } = this.input;
    await owners.chats.sync.configureMode(mode); await owners.bases.sync.configureMode(mode);
    await owners.projects.portable.configureMode(mode); await owners.apps.portable.configureMode(mode);
  }
  async disconnectAccount(userId: string) {
    if (this.input.binding.snapshot()?.userId !== userId) return;
    await this.disconnect("account-deleted", async () => {
      if (this.input.binding.snapshot()?.userId !== userId) throw new Error("cloud-request-superseded");
    });
  }
  disconnect(reason: Parameters<SyncBindingStore["beginCleanup"]>[0], beforeCleanup?: () => Promise<void>): Promise<void> {
    if (this.flight) return this.flight;
    this.generation++; this.admitted = false;
    const work = this.serialize(async () => { await beforeCleanup?.(); await this.clean(reason); }); this.flight = work;
    void work.finally(() => { if (this.flight === work) this.flight = null; }).catch(() => undefined); return work;
  }
  private async clean(reason: Parameters<SyncBindingStore["beginCleanup"]>[0]) {
    const { binding, owners, journal } = this.input;
    const closing = await binding.beginCleanup(reason);
    this.admitted = false;
    if (closing) await this.configure(binding.mode());
    await this.stopActivities(true);
    if (!closing) return;
    const scope = { environment: this.input.config.environmentId, userId: closing.userId }, operationId = closing.cleanup!.operationId;
    await this.input.installations?.settleScopeCleanup(scope, operationId, () => {
      const current = binding.snapshot(), mode = binding.mode();
      if (current?.phase !== "closing" || current.userId !== scope.userId || current.cleanup?.operationId !== operationId ||
        mode.kind !== "sync" || mode.enrollment !== "closed" || !sameScope(mode.scope, scope)) throw new Error("APP_INSTALLATION_CLEANUP_CHANGED");
    });
    if (this.input.conversions) await new AccountConversionCleanup({ ...this.input, services: this.input.conversions }).run(scope, operationId);
    const existing = await journal.readByRequest("scope-cleanup", operationId);
    if (existing?.result.state === "settled") {
      const result = existing.result, receipt = result.receipt;
      if (result.status !== "done" || receipt?.operationId !== operationId || receipt.planHash !== existing.inputHash) throw new Error("CLEANUP_RECEIPT_INVALID");
      const checkpoints = receipt.checkpoints as Record<string, unknown> | undefined;
      for (const participant of CLEANUP_PARTICIPANTS) {
        // A receipt settled by a released six-owner build has no account-config step; run that idempotent step now.
        if (participant === "account-config" && checkpoints?.[participant] === undefined) { await this.input.accountConfig?.cleanupScope(scope); continue; }
        const checkpoint = cleanupCheckpointSchema.parse(checkpoints?.[participant]);
        if (checkpoint.operationId !== operationId || checkpoint.planHash !== existing.inputHash || checkpoint.participant !== participant) throw new Error("CLEANUP_RECEIPT_INVALID");
      }
    } else {
      const pending = existing?.result.state === "pending" ? existing.result.intent : null;
      const plan = pending ? scopeCleanupPlanSchema.parse(pending.input) : await captureScopeCleanup(owners, scope, operationId);
      if (!sameScope(plan.scope, scope)) throw new Error("CLEANUP_SCOPE_IDENTITY_CHANGED");
      if (!pending) plan.retainedBlobs = await this.bytes.capture(plan);
      await this.cleanup.run(plan);
    }
    await binding.finishCleanup(operationId, async () => {
      const chats = await owners.chats.sync.read(null, { type: "state" });
      if (chats.type !== "state" || !chats.value || !("scopes" in chats.value) || chats.value.scopes || chats.value.outbox || chats.value.receipts ||
        owners.bases.listAll().some(({ ownerKey, snapshot }) => sameScope(owners.bases.sync.read(ownerKey, snapshot.meta.ownerInstanceId).scope, scope)) ||
        owners.projects.list().some(project => project.sync && sameScope(project.sync.scope, scope)) ||
        owners.apps.portable.list().some(entry => sameScope(entry.scope, scope)) || owners.apps.portable.pending().some(entry => sameScope(entry.scope, scope)) || owners.apps.portable.publication.list(scope).length || owners.apps.portable.deletion.list(scope).length) {
        throw new Error("CLEANUP_OWNERS_STILL_ATTACHED");
      }
    });
    await this.configure({ kind: "local-only" });
  }
  async pendingCount() {
    const binding = this.input.binding.snapshot(); if (!binding || binding.phase === "closing") return 0;
    const { owners } = this.input, state = await owners.chats.sync.read(null, { type: "state" });
    return (state.type === "state" && state.value && "outbox" in state.value ? state.value.outbox : 0) +
      owners.bases.listAll().reduce((count, { ownerKey, snapshot }) => count + owners.bases.sync.read(ownerKey, snapshot.meta.ownerInstanceId).pendingOperations.length, 0) +
      owners.projects.list().reduce((count, project) => count + (project.sync?.pending.length ?? 0), 0) + owners.apps.portable.pending().length +
      owners.apps.portable.deletion.list({ environment: this.input.config.environmentId, userId: binding.userId }).filter(item => !item.receipt).length +
      owners.apps.portable.publication.list({ environment: this.input.config.environmentId, userId: binding.userId }).filter(item => item.state !== "complete").length;
  }
  async close() { this.closed = true; this.generation++; await this.stopActivities(true); await this.transition; await this.flight; }
}
