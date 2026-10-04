/**
 * [INPUT]: Depends on the account owner through SyncControlsHost (state, generation, closed, pending sign-out, authenticated session, refresh, set), SyncSetupOperation, the attached SyncEncryptionController and InitialSyncController
 * [OUTPUT]: Provides SyncControls: Enable-sync setup, unlock, retry and cancel of encryption; sync inspection, review cancel, approve, retry, cleanup inspection, disable and account switch, each fenced by the account generation; the attached encryption owner for account lifecycle
 * [POS]: Held by CloudAccountService (cloud/runtime/service.ts), which delegates its public sync and encryption methods here; encryption still owns keys and initial sync owns durable consent
 */
import type { CloudAccountState } from "../../../../shared/ipc/settings/cloud-ipc";
import type { SyncSetupInput } from "../../../../shared/cloud/encryption";
import type { InitialSyncController } from "../sync/initial/controller";
import type { SyncEncryptionController } from "./controller";
import { SyncSetupOperation } from "./setup-operation";

/** What the controls read from and write to the account that holds them; every read is live. */
export type SyncControlsHost = {
  value(): CloudAccountState;
  generation(): number;
  closed(): boolean;
  signOutPending(): boolean;
  authenticatedSessionId(): string | null;
  refresh(): Promise<void>;
  set(change: Partial<CloudAccountState>): void;
};

export class SyncControls {
  readonly setup: SyncSetupOperation;
  private owner: SyncEncryptionController | null = null;
  private sync: InitialSyncController | null = null;
  private syncInspection = 0;
  private disablingSync: Promise<void> | null = null;
  constructor(private readonly host: SyncControlsHost) {
    this.setup = new SyncSetupOperation({
      identity: () => {
        const value = this.host.value(), sessionId = this.host.authenticatedSessionId();
        return !this.host.closed() && !this.host.signOutPending() && value.profile && value.deviceId && sessionId &&
          ["ready", "temporarily-offline", "connecting"].includes(value.status) ?
          { userId: value.profile.userId, deviceId: value.deviceId, sessionId, generation: this.host.generation() } : null;
      },
      ready: () => this.host.value().status === "ready", refresh: () => this.host.refresh(),
      approved: () => this.encryption?.hasApprovedSync() ?? false,
      changed: syncSetup => this.host.set({ syncSetup }),
      review: async id => {
        if (!this.sync) throw new Error("SYNC_UNAVAILABLE");
        try { this.sync.validateReview(id); return id; }
        catch (error) { if (!(error instanceof Error) || error.message !== "SYNC_REVIEW_EXPIRED") throw error; }
        try { return (await this.inspectSync()).reviewId; }
        catch (error) {
          if (this.host.value().sync.error === "scan-failed") throw new Error("scan-failed");
          throw error;
        }
      },
    });
  }
  /** The attached encryption owner; the account's sign-out and switch paths cancel and clear it. */
  get encryption() { return this.owner; }
  attachEncryption(owner: SyncEncryptionController) { if (this.encryption) throw new Error("ENCRYPTION_ALREADY_ATTACHED"); this.owner = owner; }
  async setupEncryption(input: SyncSetupInput) {
    if (!this.encryption) throw new Error("sync-locked");
    const encryption = this.encryption;
    await this.setup.run(input.reviewId, reviewId => encryption.setup({ ...input, reviewId }));
  }
  async unlockEncryption(input: { password: string }) { if (!this.encryption) throw new Error("sync-locked"); await this.encryption.unlock(input.password); }
  async retryEncryption() { if (!this.encryption) throw new Error("sync-locked"); await this.encryption.check(true); return this.encryption.snapshot(); }
  async cancelEncryption() { this.setup.cancel(); this.cancelSyncReview(); await this.encryption?.cancel(); }
  attachSync(sync: InitialSyncController) { if (this.sync) throw new Error("SYNC_ALREADY_ATTACHED"); this.sync = sync; }
  async inspectSync() {
    if (!this.sync) throw new Error("SYNC_UNAVAILABLE");
    const generation = this.host.generation(), revision = ++this.syncInspection;
    const guard = () => { if (this.host.closed() || generation !== this.host.generation() || revision !== this.syncInspection) throw new Error("sync-operation-cancelled"); };
    // Removing the binding can mount setup while its original key cleanup is still running.
    await this.disablingSync; guard();
    if (this.encryption && !this.encryption.isUnlocked()) await this.encryption.check(true, true);
    guard(); return this.sync.inspect();
  }
  cancelSyncReview() { this.syncInspection++; this.sync?.cancelReview(); }
  async approveSync(reviewId: string) {
    if (!this.encryption) throw new Error("sync-locked");
    const encryption = this.encryption;
    await this.setup.run(reviewId, async id => {
      if (!encryption.isUnlocked()) await encryption.check(true, true);
      await encryption.approve(id);
    });
  }
  async retrySync() {
    if (!this.sync) throw new Error("SYNC_UNAVAILABLE");
    // A Retry that finishes a pending disconnect owes the same tail as Disable: re-enabling must ask for the password again.
    const userId = this.host.value().profile?.userId ?? null, generation = this.host.generation();
    if (await this.sync.retry() === "disconnected" && !this.host.closed() && generation === this.host.generation()) await this.encryption?.clear(userId);
  }
  async inspectCleanup() { return this.sync ? this.sync.inspectCleanup() : null; }
  async disableSync(reviewId: string) {
    if (!this.sync) throw new Error("SYNC_UNAVAILABLE");
    if (this.disablingSync) return this.disablingSync;
    const generation = this.host.generation(), userId = this.host.value().profile?.userId ?? null, sync = this.sync;
    const work = (async () => {
      this.cancelSyncReview(); await this.encryption?.cancel("account"); await sync.disable(reviewId);
      if (this.host.closed() || generation !== this.host.generation()) throw new Error("sync-operation-cancelled");
      await this.encryption?.clear(userId);
    })();
    this.disablingSync = work;
    try { await work; } finally { if (this.disablingSync === work) this.disablingSync = null; }
  }
  async inspectAccountSwitch() { if (!this.sync) throw new Error("SYNC_UNAVAILABLE"); return this.sync.inspectCleanup("account-switch"); }
  async switchAccount(reviewId: string) {
    if (!this.sync || this.host.value().status !== "account-switch-required") throw new Error("SYNC_ACCOUNT_UNAVAILABLE");
    const generation = this.host.generation(), userId = this.host.value().profile?.userId;
    await this.encryption?.cancel("account");
    await this.sync.switchAccount(reviewId);
    await this.encryption?.clear();
    if (this.host.closed() || generation !== this.host.generation() || this.host.value().profile?.userId !== userId || this.host.signOutPending()) throw new Error("cloud-request-superseded");
    await this.host.refresh();
  }
}
