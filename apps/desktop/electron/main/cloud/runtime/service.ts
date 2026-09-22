/**
 * [INPUT]: Depends on the credential vault, login flow, closed transport, installation identity and account scope lifecycle.
 * [OUTPUT]: Provides recoverable login admission, binding-fenced offline identity, machine-keyed device registration, one account-generation computer subscription and machine-wide rename, pending-delivery display and localIdentityReady, account-fenced bounded sync setup retries, cleanup-fenced inspection, pending sign-out, subscription-only heartbeats, connection-fenced wake recovery independent of account operations, single-flight handshake re-checks on a bounded backoff and SavedLoginReviewExpired.
 * [POS]: Account owner consumed by Electron composition and trusted IPC; local Stores remain authoritative.
 */
import type { SyncEncryptionController } from "../encryption/controller";
import { SyncSetupOperation } from "../encryption/setup-operation";
import type { SyncEncryptionState, SyncSetupInput } from "../../../../shared/cloud/encryption";
import { randomUUID } from "node:crypto";
import { ConvexError } from "convex/values";
import { CLOUD_LIMITS, protocolHeader, type AccountAccess, type CloudBuildConfig, type LoginReturnMode } from "@ai-chat/cloud-protocol";
import { cloudAccountStateSchema, cloudHandshakeFailed, COMPUTER_RENAME_REASONS, type CloudAccountState, type CloudComputerRenameReason, type CloudComputerRenameResult, type CloudComputersResult, type CloudError, type PendingLoginProjection } from "../../../../shared/cloud-ipc";
import { CredentialStore, type CloudCredentials } from "../account/credential-store";
import { credentialError, StorageSuperseded } from "../account/storage/access";
import { LoginFlow } from "../account/login-flow";
import { SessionClient, AuthTransportError } from "../account/session-client";
import type { AccountTransport } from "./transport";
import type { AccountScopeLifecycle } from "../sync/account/cleanup/lifecycle";
import type { InitialSyncController } from "../sync/initial/controller";
import type { SyncProgress } from "../../../../shared/cloud/sync";
import { ChangeNotifier } from "./notifier";
import { rememberOfflineIdentity, restoreOfflineIdentity, restorePendingLogin } from "./offline/identity";
import type { SyncBindingStore } from "../sync/account/binding";
type Ports = { returnMode: LoginReturnMode; config: CloudBuildConfig; vault: CredentialStore; http: SessionClient; transport: AccountTransport;
  binding?: Pick<SyncBindingStore, "snapshot">; deviceId: string; version: string; platform: "macos" | "windows" | "linux";
  /** This computer's key; the server groups this account's installations by it. Resolved once, with registration. */
  machineIdHash?(): Promise<string | null>;
  /** The Bottega folder this installation holds; the server admits its publications against that folder's owner. */
  libraryId?(): string | null;
  name(): Promise<string>; openBrowser(url: string): Promise<void>;
  deviceNames?(userId: string, devices: import("@ai-chat/cloud-protocol").CloudDevice[]): void;
  scope?: Pick<AccountScopeLifecycle, "initialize" | "admit" | "disconnectAccount" | "pendingCount" | "suspend"> };
/* A failed handshake has nothing to heartbeat, so while it fails these delays own the retry
   cadence: a service that is simply out of date is not polled at the heartbeat rate forever. */
const RECHECK_DELAYS_MS = [30_000, 60_000, 120_000] as const;
export class SavedLoginReviewExpired extends Error {
  constructor() { super("credential-review-expired"); }
}
export class CloudAccountService {
  readonly login: LoginFlow;
  private finishLocalIdentity!: () => void;
  readonly localIdentityReady = new Promise<void>(resolve => { this.finishLocalIdentity = resolve; });
  private value: CloudAccountState;
  private readonly identityListeners = new ChangeNotifier();
  private identityKey = "";
  private readonly listeners = new ChangeNotifier<CloudAccountState>();
  private generation = 0;
  private connectionGeneration = 0;
  private registeredGeneration: number | null = null;
  private accessRevision = 0;
  private flight: Promise<void> | null = null;
  private availability: { generation: number; flight: Promise<void> } | null = null;
  private recheckFlight: Promise<void> | null = null;
  private recheckTimer: ReturnType<typeof setTimeout> | null = null;
  private recheckStep = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private connectionEpoch = randomUUID();
  private serverConnectionEpoch: string | null = null;
  private machineIdHash: string | null = null;
  private computerKey = "";
  private computerWatch: (() => void) | null = null;
  private computerValue: CloudComputersResult = { kind: "signed-out" };
  private readonly computerListeners = new ChangeNotifier<CloudComputersResult>();
  private confirmedConnectionEpoch: string | null = null;
  private readonly connectionListeners = new ChangeNotifier();
  private signOutFlight: Promise<void> | null = null;
  private signingOut: Promise<void> | null = null;
  private signOutPending = false;
  private removalStatus: "signed-out" | "revoked" | "deleted" | null = null;
  private closed = false;
  private storageUnsubscribe: () => void;
  private recoveryRevision = 0;
  private storageRetry: Promise<void> | null = null;
  private discardFlight: Promise<void> | null = null;
  private discardReview: { reviewId: string; target: string; revision: number; generation: number; expiresAt: number; confirmed: boolean } | null = null;
  private sync: InitialSyncController | null = null;
  private encryption: SyncEncryptionController | null = null;
  private readonly setup: SyncSetupOperation;
  private syncInspection = 0;
  private disablingSync: Promise<void> | null = null;
  private authenticatedSessionId: string | null = null;
  private rememberedIdentity = "";
  private subscribed = false;
  constructor(private readonly ports: Ports) {
    this.value = cloudAccountStateSchema.parse({ available: true, environmentId: ports.config.environmentId,
      status: "signed-out", profile: null, deviceId: null, pendingLogin: null, error: null, sync: { status: "not-connected" } });
    this.setup = new SyncSetupOperation({
      identity: () => !this.closed && !this.signOutPending && this.value.profile && this.value.deviceId && this.authenticatedSessionId &&
        ["ready", "temporarily-offline", "connecting"].includes(this.value.status) ?
        { userId: this.value.profile.userId, deviceId: this.value.deviceId, sessionId: this.authenticatedSessionId, generation: this.generation } : null,
      ready: () => this.value.status === "ready", refresh: () => this.refresh(),
      approved: () => this.encryption?.hasApprovedSync() ?? false,
      changed: syncSetup => this.set({ syncSetup }),
      review: async id => {
        if (!this.sync) throw new Error("SYNC_UNAVAILABLE");
        try { this.sync.validateReview(id); return id; }
        catch (error) { if (!(error instanceof Error) || error.message !== "SYNC_REVIEW_EXPIRED") throw error; }
        try { return (await this.inspectSync()).reviewId; }
        catch (error) {
          if (this.value.sync.error === "scan-failed") throw new Error("scan-failed");
          throw error;
        }
      },
    });
    this.login = new LoginFlow({ ...ports, changed: (pending, error) => this.loginChanged(pending, error), registerSession: () => this.reconcile() });
    this.storageUnsubscribe = ports.vault.access.subscribe(() => this.storageChanged());
    this.storageChanged();
  }
  snapshot() { return structuredClone(this.value); }
  connectionIdentity() { return { status: this.value.status, profile: this.value.profile ? { userId: this.value.profile.userId } : null, deviceId: this.value.deviceId }; }
  subscribeIdentity = this.identityListeners.subscribe;
  private notifyIdentity() {
    const binding = this.ports.binding?.snapshot();
    const key = JSON.stringify([this.value.status, this.value.profile?.userId, this.value.deviceId, this.authenticatedSessionId,
      this.signOutPending, binding?.phase, binding?.paused, binding?.manifestId]);
    if (key === this.identityKey) return;
    this.identityKey = key; this.identityListeners.notify();
  }
  syncIdentity() {
    return !this.closed && !this.signOutPending && this.value.status === "ready" && this.value.profile && this.value.deviceId && this.authenticatedSessionId ?
      { userId: this.value.profile.userId, deviceId: this.value.deviceId, sessionId: this.authenticatedSessionId } : null;
  }
  attachEncryption(owner: SyncEncryptionController) { if (this.encryption) throw new Error("ENCRYPTION_ALREADY_ATTACHED"); this.encryption = owner; }
  updateEncryption(encryption: SyncEncryptionState) { this.set({ encryption }); }
  async setupEncryption(input: SyncSetupInput) {
    if (!this.encryption) throw new Error("sync-locked");
    const encryption = this.encryption;
    await this.setup.run(input.reviewId, reviewId => encryption.setup({ ...input, reviewId }));
  }
  async unlockEncryption(input: { password: string }) { if (!this.encryption) throw new Error("sync-locked"); await this.encryption.unlock(input.password); }
  async retryEncryption() { if (!this.encryption) throw new Error("sync-locked"); await this.encryption.check(true); return this.encryption.snapshot(); }
  async cancelEncryption() { this.setup.cancel(); this.cancelSyncReview(); await this.encryption?.cancel(); }
  remoteConnection() { return this.value.status === "ready" && !this.closed && !this.signOutPending ? this.confirmedConnectionEpoch : null; }
  subscribeConnection = this.connectionListeners.subscribe;
  private confirmConnection(epoch: string | null) {
    if (this.confirmedConnectionEpoch === epoch) return;
    this.confirmedConnectionEpoch = epoch; this.watchComputers(); this.connectionListeners.notify();
  }
  private closeTransport() { this.connectionGeneration++; this.subscribed = false; this.ports.transport.close(); }
  // A confirmed epoch on a live subscription already owns access changes, so a heartbeat needs nothing else.
  private steady() { return this.subscribed && this.value.status === "ready" && this.registeredGeneration === this.generation && this.confirmedConnectionEpoch !== null; }
  attachSync(sync: InitialSyncController) { if (this.sync) throw new Error("SYNC_ALREADY_ATTACHED"); this.sync = sync; }
  updateSync(sync: SyncProgress) { this.set({ sync }); }
  updateAvatar(userId: string | null, avatarDataUrl: string | null) {
    if ((this.value.profile?.userId ?? null) === userId) this.set({ avatarDataUrl });
  }
  async inspectSync() {
    if (!this.sync) throw new Error("SYNC_UNAVAILABLE");
    const generation = this.generation, revision = ++this.syncInspection;
    const guard = () => { if (this.closed || generation !== this.generation || revision !== this.syncInspection) throw new Error("sync-operation-cancelled"); };
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
    const userId = this.value.profile?.userId ?? null, generation = this.generation;
    if (await this.sync.retry() === "disconnected" && !this.closed && generation === this.generation) await this.encryption?.clear(userId);
  }
  async inspectCleanup() { return this.sync ? this.sync.inspectCleanup() : null; }
  async disableSync(reviewId: string) {
    if (!this.sync) throw new Error("SYNC_UNAVAILABLE");
    if (this.disablingSync) return this.disablingSync;
    const generation = this.generation, userId = this.value.profile?.userId ?? null, sync = this.sync;
    const work = (async () => {
      this.cancelSyncReview(); await this.encryption?.cancel("account"); await sync.disable(reviewId);
      if (this.closed || generation !== this.generation) throw new Error("sync-operation-cancelled");
      await this.encryption?.clear(userId);
    })();
    this.disablingSync = work;
    try { await work; } finally { if (this.disablingSync === work) this.disablingSync = null; }
  }
  async inspectAccountSwitch() { if (!this.sync) throw new Error("SYNC_UNAVAILABLE"); return this.sync.inspectCleanup("account-switch"); }
  async switchAccount(reviewId: string) {
    if (!this.sync || this.value.status !== "account-switch-required") throw new Error("SYNC_ACCOUNT_UNAVAILABLE");
    const generation = this.generation, userId = this.value.profile?.userId;
    await this.encryption?.cancel("account");
    await this.sync.switchAccount(reviewId);
    await this.encryption?.clear();
    if (this.closed || generation !== this.generation || this.value.profile?.userId !== userId || this.signOutPending) throw new Error("cloud-request-superseded");
    await this.refresh();
  }
  subscribe = this.listeners.subscribe;
  private set(change: Partial<CloudAccountState>) {
    if (this.closed) return;
    if (change.status && change.status !== "ready") this.confirmConnection(null);
    if ("profile" in change && (change.profile?.userId !== this.value.profile?.userId || change.profile?.avatarUrl !== this.value.profile?.avatarUrl)) change = { ...change, avatarDataUrl: null };
    const next = cloudAccountStateSchema.parse({ ...this.value, signOutPending: this.signOutPending, ...change });
    if (JSON.stringify(next) === JSON.stringify(this.value)) { this.notifyIdentity(); this.watchComputers(); return; }
    this.value = next; this.notifyIdentity(); this.watchComputers(); this.setup.accountChanged(); this.armRecheck(); this.listeners.notify(this.snapshot());
  }
  private loginChanged(pending: PendingLoginProjection | null, error: CloudError) {
    if (this.discardReview?.confirmed) return;
    const active = this.login.active;
    if (!active) error ??= this.ports.vault.access.error;
    const released = !active && !this.login.succeeded;
    if (released || this.login.isCancelling) {
      this.confirmConnection(null); this.closeTransport(); this.ports.http.clear();
      void this.ports.scope?.suspend({ closeEnrollment: true }).catch(() => {});
    }
    this.set({ pendingLogin: pending, error, canRetryLoginSave: this.login.canRetrySave, loginCancelling: this.login.isCancelling, cancelUnconfirmed: this.login.cancelUnconfirmed,
      canRetryCredentialStorage: this.storageRetryable,
      ...(released ? { profile: null, deviceId: null } : {}),
      ...(active ? { status: "signing-in" } : error ? { status: error === "environment-mismatch" || error === "client-outdated" ? error : "error" } : this.value.status === "signing-in" ? { status: this.login.succeeded && this.value.profile ? "ready" : "signed-out" } : {}) });
    if (!active && this.login.succeeded && !error && this.value.profile) void this.refresh();
  }
  /* Read faults and pending removals have their own retry; a write that saved nothing is only
     recoverable through a probe, and only once the login owner has stopped offering its own save retry. */
  private get storageRetryable() {
    const access = this.ports.vault.access;
    return access.blocked === "credential-read-failed" || this.ports.vault.canRetryRemoval || !this.login.active && this.ports.vault.canRetryWrite;
  }
  private storageChanged() {
    if (this.closed || this.discardReview?.confirmed) return;
    const access = this.ports.vault.access, generation = this.generation, revision = ++this.recoveryRevision;
    if (access.blocked) {
      this.confirmConnection(null); this.ports.http.clear(); this.closeTransport();
      void this.ports.scope?.suspend().catch(() => {});
      this.set({ error: access.error, status: this.login.active ? "signing-in" :
        this.value.status === "environment-mismatch" ? "environment-mismatch" : "error",
        canRetryCredentialStorage: this.storageRetryable });
    }
    void this.ports.vault.inspect().then(target => {
      if (generation === this.generation && revision === this.recoveryRevision && !this.discardReview?.confirmed) {
        this.set({ canDiscardSavedLogin: !!target && !!access.blocked, canRetryCredentialStorage: this.storageRetryable });
      }
    }).catch(() => {});
  }
  async initialize() {
    const generation = this.generation;
    try {
      await this.ports.scope?.initialize();
      if (this.ports.vault.access.blocked) { this.storageChanged(); return; }
      const value = await this.ports.vault.read();
      if (this.closed || generation !== this.generation) return;
      this.signOutPending = value.signOutRequested;
      const identity = restoreOfflineIdentity(value, this.ports.binding?.snapshot() ?? null, this.ports.deviceId);
      const pendingLogin = restorePendingLogin(value);
      if (pendingLogin) this.set({ status: "connecting", pendingLogin, error: null });
      else if (identity) this.set({ ...identity, status: "temporarily-offline", error: null });
      this.finishLocalIdentity();
      if (value.signOutRequested) await this.finishSignOut();
      else if (value.login) { await this.ports.transport.handshake(); await this.login.resume(); }
      else if (value.session) await this.reconcile(value);
      else await this.checkAvailability();
    } catch (error) { if (generation === this.generation) this.failure(error); }
    finally {
      this.finishLocalIdentity();
      // The backoff owns the cadence while the handshake is failing, so the heartbeat stays out of its way.
      if (!this.closed) { this.timer = setInterval(() => { if (!this.unavailable()) void this.refresh(); }, CLOUD_LIMITS.heartbeatMs); this.timer.unref(); } }
  }
  private checkAvailability() {
    const generation = this.generation;
    if (this.availability?.generation === generation) return this.availability.flight;
    const current = () => !this.closed && generation === this.generation && !this.login.active && !this.signOutPending &&
      !this.discardReview?.confirmed && !this.ports.vault.access.blocked && !this.value.profile;
    const flight = (async () => {
      try {
        await this.ports.transport.handshake();
        if (current()) this.set({ status: "signed-out", error: null });
      } catch (error) { if (current()) this.failure(error); }
    })();
    this.availability = { generation, flight };
    void flight.finally(() => { if (this.availability?.flight === flight) this.availability = null; }).catch(() => {});
    return flight;
  }
  /** Try again: re-runs the handshake and, when it succeeds, the ordinary reconcile/heartbeat flow. */
  async retryConnection() { await this.recheck(); return this.snapshot(); }
  /** Ambient triggers — a window returning to the front, a connection coming back — re-check only what is failing. */
  recheckConnection() { if (this.unavailable()) void this.recheck(); }
  private unavailable() {
    return !this.closed && !this.login.active && !this.signOutPending && !this.discardReview?.confirmed &&
      !this.ports.vault.access.blocked && cloudHandshakeFailed(this.value);
  }
  private recheck(): Promise<void> {
    if (this.recheckFlight) return this.recheckFlight;
    const request = this.refresh();
    this.recheckFlight = request;
    void request.finally(() => { if (this.recheckFlight === request) { this.recheckFlight = null; this.armRecheck(); } }).catch(() => {});
    return request;
  }
  /* Single-flight and self-cancelling: a pending timer owns the next attempt, and the first state
     that leaves the unavailable set drops both the timer and the backoff it had reached. */
  private armRecheck() {
    if (!this.unavailable()) {
      if (this.recheckTimer) { clearTimeout(this.recheckTimer); this.recheckTimer = null; }
      this.recheckStep = 0; return;
    }
    if (this.recheckTimer || this.recheckFlight) return;
    const delay = RECHECK_DELAYS_MS[Math.min(this.recheckStep++, RECHECK_DELAYS_MS.length - 1)]!;
    this.recheckTimer = setTimeout(() => { this.recheckTimer = null; void this.recheck(); }, delay);
    this.recheckTimer.unref();
  }
  startLogin() {
    if (this.value.profile || this.signOutPending || this.closed || this.discardReview?.confirmed || this.storageRetry ||
      this.ports.vault.access.blocked && this.ports.vault.access.blocked !== "credential-file-invalid") return this.snapshot();
    if (!this.login.active) { this.generation++; this.accessRevision++; this.discardReview = null; }
    const generation = this.generation;
    void this.login.start(async () => {
      await this.ports.scope?.initialize();
      if (generation !== this.generation || this.closed) throw new StorageSuperseded();
      if (this.ports.vault.access.blocked === "credential-file-invalid") await this.ports.vault.resetInvalid();
      if (await this.ports.vault.inspect() !== null) throw new Error("sign-out-required");
      await this.ports.transport.handshake();
      if (generation !== this.generation || this.closed) throw new StorageSuperseded();
      // A release that carries an error has already told the user something; re-checking availability would erase it.
    }).then(() => { if (generation === this.generation && !this.login.active && !this.ports.vault.access.blocked && !this.value.error) void this.refresh(); });
    return this.snapshot();
  }
  cancelLogin() {
    if (!this.discardReview?.confirmed) { this.discardReview = null; void this.login.cancel().catch(error => this.failure(error)); }
    return this.snapshot();
  }
  /* The local half of a cancellation the server cannot confirm: the record goes now, the remote request is left to expire. */
  abandonLogin() {
    if (!this.discardReview?.confirmed) { this.discardReview = null; void this.login.abandon().catch(error => this.failure(error)); }
    return this.snapshot();
  }
  reopenLogin() { void this.login.reopen().catch(error => this.failure(error)); return this.snapshot(); }
  retryLoginSave() { void this.login.retrySave().catch(error => this.failure(error)); return this.snapshot(); }
  async openCloudAccount() {
    if (this.closed) throw new Error("cloud-account-unavailable");
    await this.ports.openBrowser(new URL("/account", this.ports.config.appOrigin).toString());
  }
  async retryCredentialStorage() {
    if (this.storageRetry) { await this.storageRetry; return this.snapshot(); }
    if (!this.value.canRetryCredentialStorage || this.discardReview?.confirmed) return this.snapshot();
    const generation = ++this.generation; this.discardReview = null;
    const request = (async () => {
      try {
        const current = () => !this.closed && generation === this.generation && !this.discardReview?.confirmed;
        if (this.ports.vault.canRetryRemoval) {
          await this.ports.vault.retryRemoval(current);
          if (current() && this.removalStatus) this.completeRemoval();
        } else if (this.ports.vault.canRetryWrite) {
          await this.ports.vault.retryWrite(current);
        } else {
          const value = await this.ports.vault.retryRead();
          if (current()) this.signOutPending ||= value.signOutRequested;
        }
        if (current()) this.set({ error: null, status: this.signOutPending ? "signing-out" : this.value.status === "deleted" || this.value.status === "revoked" ? this.value.status : "signed-out", canRetryCredentialStorage: false });
      } catch (error) { if (generation === this.generation) this.failure(error); }
    })();
    this.storageRetry = request; await request;
    if (this.storageRetry === request) this.storageRetry = null;
    if (generation === this.generation) await this.refresh();
    return this.snapshot();
  }
  async inspectSavedLoginDiscard() {
    if (this.discardReview?.confirmed) return { reviewId: this.discardReview.reviewId };
    if (this.closed || !this.ports.vault.access.blocked || !this.value.canDiscardSavedLogin) throw new Error("credential-discard-unavailable");
    const generation = this.generation, revision = this.ports.vault.revision;
    const target = await this.ports.vault.inspect();
    if (!target || generation !== this.generation || revision !== this.ports.vault.revision) throw new Error("credential-review-expired");
    this.discardReview = { reviewId: randomUUID(), target, generation, revision, expiresAt: Date.now() + 60_000, confirmed: false };
    return { reviewId: this.discardReview.reviewId };
  }
  async discardSavedLogin(reviewId: string) {
    const review = this.discardReview;
    if (!review || review.reviewId !== reviewId || this.closed) throw new SavedLoginReviewExpired();
    if (this.discardFlight) return this.discardFlight;
    if (!review.confirmed) {
      const target = await this.ports.vault.inspectTarget();
      if (review.confirmed) return this.discardFlight;
      if (this.discardReview !== review || review.expiresAt <= Date.now() || review.generation !== this.generation ||
        review.revision !== this.ports.vault.revision || review.target !== target) throw new SavedLoginReviewExpired();
      review.confirmed = true; this.generation++; this.accessRevision++; this.recoveryRevision++;
      this.ports.vault.access.freeze(); this.confirmConnection(null); this.closeTransport(); this.ports.http.clear();
      this.set({ status: "error", canRetryCredentialStorage: false, canRetryLoginSave: false, canDiscardSavedLogin: true });
    }
    const request = (async () => {
      await Promise.all([this.login.quiesce(), this.ports.scope?.suspend({ closeEnrollment: true }),
        this.flight?.catch(() => {}), this.signingOut?.catch(() => {}), this.signOutFlight?.catch(() => {}), this.storageRetry]);
      await this.ports.vault.drain();
      await this.ports.vault.discard(review.target, () => this.discardReview === review && !this.closed);
      this.ports.http.clear(); this.signOutPending = false; this.removalStatus = null; this.registeredGeneration = null;
      this.login.credentialsCleared(); this.ports.vault.access.discarded(); this.discardReview = null;
      this.set({ status: this.ports.vault.access.blocked ? "error" : "signed-out", profile: null, deviceId: null, pendingLogin: null,
        error: this.ports.vault.access.error, canDiscardSavedLogin: false, canRetryCredentialStorage: false, canRetryLoginSave: false, loginCancelling: false, cancelUnconfirmed: false });
    })();
    this.discardFlight = request;
    try { await request; }
    finally { if (this.discardFlight === request) this.discardFlight = null; }
  }
  async openAccountDeletion() {
    if (this.closed || this.signOutPending || this.value.status !== "ready" || !this.value.profile) throw new Error("cloud-account-unavailable");
    const url = new URL("/account/delete", this.ports.config.authOrigin);
    url.searchParams.set("account", this.value.profile.userId);
    await this.ports.openBrowser(url.toString());
  }
  async refresh(resumed = false) {
    if (resumed) this.presenceStopped = false;
    if (this.closed || this.discardReview?.confirmed || this.storageRetry) return;
    const generation = this.generation;
    let connectionGeneration = this.connectionGeneration;
    const current = () => !this.closed && generation === this.generation && connectionGeneration === this.connectionGeneration;
    try {
      if (this.login.active) { this.login.refresh(); return; }
      if (this.ports.vault.access.blocked) return;
      if (resumed) {
        this.accessRevision++;
        this.confirmConnection(null); this.connectionEpoch = randomUUID();
        this.closeTransport(); this.ports.http.clear();
        connectionGeneration = this.connectionGeneration;
        this.heartbeatFlight = null; this.flight = null;
        await this.ports.scope?.suspend();
      }
      if (this.signOutPending) { await this.finishSignOut(); return; }
      // Nothing but this process writes the vault, so a confirmed subscription makes the heartbeat the only steady-state work.
      if (this.steady()) { await this.heartbeat(); return; }
      const value = await this.ports.vault.read();
      if (!current()) return;
      if (value.signOutRequested) { this.signOutPending = true; await this.finishSignOut(); return; }
      if (value.login) { if (!this.login.active) { await this.ports.transport.handshake(); await this.login.resume(); } return; }
      if (!value.session) {
        if (["signed-out", "temporarily-offline", "environment-mismatch", "client-outdated"].includes(this.value.status) || this.value.error === "server-outdated") await this.checkAvailability();
        return;
      }
      await this.ports.scope?.initialize();
      if (!current()) return;
      await this.reconcile(value);
      if (current() && this.value.status === "ready") await this.heartbeat();
    } catch (error) { if (current()) this.failure(error); }
  }
  private presenceStopped = false;
  private heartbeatFlight: Promise<void> | null = null;
  reportOffline(reason: "sleep" | "quit"): Promise<void> {
    this.presenceStopped = true;
    const epoch = this.connectionEpoch, generation = this.generation;
    const flight = Promise.resolve(this.heartbeatFlight).catch(() => {}).then(async () => {
      if (this.closed || !this.presenceStopped || this.value.status !== "ready" || this.connectionEpoch !== epoch || this.generation !== generation) return;
      await this.ports.transport.mutate("devices:heartbeat", { ...protocolHeader(this.ports.config),
        connectionEpoch: epoch, previousConnectionEpoch: epoch, outboxPending: 0, lastSeenReason: reason, ...this.machineKey() });
    }).finally(() => { if (this.heartbeatFlight === flight) this.heartbeatFlight = null; });
    this.heartbeatFlight = flight; return flight;
  }
  private machineKey() {
    const libraryId = this.ports.libraryId?.() ?? null;
    return { ...(this.machineIdHash ? { machineIdHash: this.machineIdHash } : {}), ...(libraryId ? { libraryId } : {}) };
  }
  private heartbeat(): Promise<void> {
    if (this.presenceStopped) return Promise.resolve();
    if (this.heartbeatFlight) return this.heartbeatFlight;
    const flight = this.sendHeartbeat().finally(() => { if (this.heartbeatFlight === flight) this.heartbeatFlight = null; });
    this.heartbeatFlight = flight; return flight;
  }
  private async sendHeartbeat() {
    const epoch = this.connectionEpoch, generation = this.generation;
    const previousConnectionEpoch = this.serverConnectionEpoch;
    const outboxPending = await this.ports.scope?.pendingCount() ?? 0;
    if (this.closed || generation !== this.generation || epoch !== this.connectionEpoch || this.presenceStopped) return;
    await this.ports.transport.mutate("devices:heartbeat", {
      ...protocolHeader(this.ports.config), connectionEpoch: epoch, previousConnectionEpoch, outboxPending, ...this.machineKey() });
    if (generation === this.generation && epoch === this.connectionEpoch && this.value.status === "ready") {
      this.serverConnectionEpoch = epoch; this.confirmConnection(epoch);
    }
  }
  private reconcile(credentials?: CloudCredentials): Promise<void> {
    if (this.flight) return this.flight;
    const generation = this.generation, connectionGeneration = this.connectionGeneration;
    const current = () => !this.closed && generation === this.generation && connectionGeneration === this.connectionGeneration && !this.signOutPending && !this.login.isCancelling && !this.discardReview?.confirmed && !this.ports.vault.access.blocked;
    const request = (async () => {
      if (!current()) throw new Error("cloud-request-superseded");
      if (!this.value.pendingLogin && !this.value.profile && !["ready", "account-switch-required"].includes(this.value.status)) this.set({ status: "connecting", error: null });
      await this.ports.transport.handshake();
      let access = await this.ports.transport.query("account:getAccessState", protocolHeader(this.ports.config));
      if (!current()) throw new Error("cloud-request-superseded");
      if (access.state === "needs-bootstrap") access = await this.ports.transport.mutate("account:bootstrap", protocolHeader(this.ports.config));
      if (!current()) throw new Error("cloud-request-superseded");
      let registered = false;
      if (access.state === "needs-device" || access.state === "ready" && this.registeredGeneration !== generation) {
        const name = await this.ports.name();
        this.machineIdHash = await this.ports.machineIdHash?.() ?? null;
        if (!current()) throw new Error("cloud-request-superseded");
        await this.ports.transport.mutate("devices:register", { ...protocolHeader(this.ports.config), deviceId: this.ports.deviceId,
          name, platform: this.ports.platform, appVersion: this.ports.version, ...this.machineKey() });
        this.set({ machine: this.machineIdHash ? { idHash: this.machineIdHash, name } : null });
        if (!current()) throw new Error("cloud-request-superseded");
        this.registeredGeneration = generation; registered = true;
        access = await this.ports.transport.query("account:getAccessState", protocolHeader(this.ports.config));
      }
      if (!current()) throw new Error("cloud-request-superseded");
      if (access.state === "ready" && access.connectionEpoch !== undefined) this.serverConnectionEpoch = access.connectionEpoch;
      const session = credentials ? credentials.session : await this.ports.vault.session();
      if (!current()) throw new Error("cloud-request-superseded");
      this.authenticatedSessionId = session?.sessionId ?? null;
      await this.applyAccess(access);
      // Display names are cosmetic: one refresh per registration, and otherwise only when the devices page asks.
      if (registered && this.value.status === "ready" && this.ports.deviceNames) void this.refreshDeviceNames().catch(() => {});
      if (!current()) throw new Error("cloud-request-superseded");
      if (!["ready", "suspended", "deleting"].includes(access.state)) throw new AuthTransportError("invalid-session");
      this.subscribed = true;
      this.ports.transport.watch(value => { if (current()) {
        const refreshingProtocol = value.state === "ready" && this.registeredGeneration !== generation;
        const update = refreshingProtocol ? this.reconcile() : this.applyAccess(value);
        const revision = this.accessRevision;
        void update.catch(error => {
          if (refreshingProtocol ? current() : !this.closed && revision === this.accessRevision && !this.discardReview?.confirmed) this.failure(error);
        });
      } },
        connected => {
          if (!current()) return;
          if (connected) { this.confirmConnection(null); this.connectionEpoch = randomUUID(); void this.refresh(); }
          else if (this.value.status === "ready") {
            void this.ports.scope?.suspend().catch(error => { if (current()) this.failure(error); });
            this.set({ status: "temporarily-offline", error: "connection-failed" });
          }
        },
        error => { if (current()) this.failure(error); });
    })();
    this.flight = request;
    void request.finally(() => { if (this.flight === request) this.flight = null; }).catch(() => undefined);
    return request;
  }
  private async applyAccess(access: AccountAccess) {
    const revision = ++this.accessRevision;
    const current = () => !this.closed && revision === this.accessRevision && !this.login.isCancelling && !this.discardReview?.confirmed;
    if (access.state === "ready") {
      if (this.signOutPending) return;
      try { await this.ports.scope?.admit(access.profile.userId, access.deviceId); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== "previous-account-cleanup-required") throw error;
        if (!current() || this.signOutPending) return;
        await this.ports.scope?.suspend({ closeEnrollment: true });
        if (current() && !this.signOutPending) this.set({ status: "account-switch-required", profile: access.profile, deviceId: access.deviceId, error: null });
        return;
      }
      if (!current() || this.signOutPending) return;
      const identity = JSON.stringify([this.authenticatedSessionId, access.deviceId, access.profile]);
      if (identity !== this.rememberedIdentity) {
        await rememberOfflineIdentity(this.ports.vault, access, () => current() && !this.signOutPending);
        if (!current() || this.signOutPending) return;
        this.rememberedIdentity = identity;
      }
      this.set({ status: this.login.active ? "signing-in" : "ready", profile: access.profile, deviceId: access.deviceId, error: null }); return;
    }
    if (access.state === "suspended" || access.state === "deleting") {
      if (access.state === "deleting") {
        await this.applyAccountDeletion(current); return;
      } else await this.ports.scope?.suspend();
      if (!current()) return;
      this.set({ status: access.state, profile: null, error: null }); return;
    }
    if (access.state === "signed-out" || access.state === "revoked") {
      this.generation++; this.login.stop(); this.closeTransport(); this.ports.http.clear();
      this.authenticatedSessionId = null;
      await this.encryption?.cancel("account");
      await this.ports.scope?.suspend({ closeEnrollment: true });
      if (!current()) return;
      const original = (await this.ports.vault.read()).session;
      if (original && await this.ports.http.accountDeleted(original.bearer)) { if (current()) await this.applyAccountDeletion(current); return; }
      if (!current()) return;
      // Access denial also covers natural expiry; a later verified continuity proof owns key removal.
      await this.clearSession(access.state, current, "retain");
    }
  }
  private async applyAccountDeletion(current: () => boolean) {
    const original = (await this.ports.vault.read()).session;
    if (!current()) return;
    await this.encryption?.clear(original?.userId ?? null);
    if (!current()) return;
    this.generation++; this.login.stop(); this.closeTransport(); this.ports.http.clear();
    this.set({ status: "deleting", profile: null, error: null });
    if (original) await this.ports.scope?.disconnectAccount(original.userId);
    if (!current()) return;
    await this.clearSession("deleted", current, "clear");
  }
  private failure(error: unknown) {
    const code = error instanceof ConvexError && typeof error.data === "string" ? error.data : error instanceof Error ? error.message : "";
    if (code === "cloud-request-superseded" || this.closed || this.discardReview?.confirmed) return;
    if (credentialError(error)) { this.storageChanged(); return; }
    if (error instanceof AuthTransportError && error.kind === "invalid-session" || ["signed-out", "revoked"].includes(code)) {
      void this.applyAccess({ state: code === "revoked" ? "revoked" : "signed-out" }).catch(error => {
        const offline = error instanceof AuthTransportError && error.kind === "temporarily-offline";
        this.set({ status: offline ? "temporarily-offline" : "error", error: offline ? "connection-failed" : "request-failed" });
      }); return;
    }
    if (code === "suspended" || code === "deleting") {
      void this.applyAccess({ state: code }).catch(() => this.set({ status: "error", error: "request-failed" })); return;
    }
    const generation = this.generation;
    const errorCode: CloudError = code === "installation-already-active" ? "installation-already-active" :
      ["environment-mismatch", "client-outdated", "server-outdated"].includes(code) ? code as "environment-mismatch" | "client-outdated" | "server-outdated" :
      error instanceof AuthTransportError && error.kind === "temporarily-offline" ? "connection-failed" : "request-failed";
    // One lost request must not tear the scope down; the socket's connected(false) owns going offline.
    if (errorCode !== "connection-failed") {
      void this.ports.scope?.suspend().catch(() => { if (generation === this.generation) this.set({ status: "error", error: "request-failed" }); });
    }
    // A persisted sign-out keeps its own status while the remote revoke waits for the network.
    this.set({ status: this.login.active ? "signing-in" : errorCode !== "connection-failed" ?
      errorCode === "environment-mismatch" || errorCode === "client-outdated" ? errorCode : "error" :
      this.signOutPending ? "signing-out" : "temporarily-offline", error: errorCode });
  }
  async signOut() {
    if (this.signOutFlight || this.signingOut) { await (this.signOutFlight ?? this.signingOut); return this.snapshot(); }
    if (this.discardReview?.confirmed) return this.snapshot();
    this.setup.cancel();
    this.confirmConnection(null); this.discardReview = null;
    await this.encryption?.clear();
    const generation = ++this.generation;
    const current = () => !this.closed && generation === this.generation && !this.discardReview?.confirmed;
    this.accessRevision++; this.closeTransport(); this.ports.http.clear(); this.signOutPending = true;
    const request = (async () => {
      try {
        if (this.login.active) { await this.login.cancel(); if (this.login.active || !current()) return; }
        this.login.stop();
        if (this.ports.vault.access.blocked) { this.storageChanged(); return; }
        const value = await this.ports.vault.read(); if (!current()) return;
        if (!value.session && !value.login) {
          await this.ports.scope?.suspend({ closeEnrollment: true });
          await this.clearSession("signed-out", current, "clear"); return;
        }
        await this.ports.vault.update(value => ({ ...value, signOutRequested: true }), { guard: current });
        if (current()) await this.finishSignOut();
      } catch (error) { if (current()) this.failure(error); }
    })();
    this.signOutFlight = request;
    try { await request; } finally { if (this.signOutFlight === request) this.signOutFlight = null; }
    return this.snapshot();
  }
  private finishSignOut(): Promise<void> {
    if (this.signingOut) return this.signingOut;
    const generation = this.generation;
    const current = () => !this.closed && generation === this.generation && !this.discardReview?.confirmed;
    const request = (async () => {
      this.set({ status: "signing-out", pendingLogin: null, profile: null, error: null });
      await this.ports.scope?.suspend({ closeEnrollment: true });
      const value = await this.ports.vault.read();
      let deleted = false;
      if (value.login) await this.ports.http.request("cancel", { ...protocolHeader(this.ports.config), state: value.login.state, verifier: value.login.verifier });
      if (value.session) {
        try {
          const access = await this.ports.transport.query("account:getAccessState", protocolHeader(this.ports.config));
          deleted = access.state === "deleting" || ["signed-out", "revoked"].includes(access.state) && await this.ports.http.accountDeleted(value.session.bearer);
          if (access.state === "ready") await this.ports.transport.mutate("devices:revoke", { ...protocolHeader(this.ports.config), deviceId: access.deviceId });
          if (!deleted) await this.ports.http.signOut(value.session.bearer);
        } catch (error) { if (!(error instanceof AuthTransportError && error.kind === "invalid-session") &&
          !(error instanceof ConvexError && ["signed-out", "revoked"].includes(String(error.data)))) throw error;
          deleted = await this.ports.http.accountDeleted(value.session.bearer);
        }
        if (deleted) await this.ports.scope?.disconnectAccount(value.session.userId);
      }
      await this.clearSession(deleted ? "deleted" : "signed-out", current, "clear");
    })();
    this.signingOut = request;
    void request.finally(() => { if (this.signingOut === request) this.signingOut = null; }).catch(() => undefined);
    return request;
  }
  private async clearSession(status: "signed-out" | "revoked" | "deleted", current: () => boolean, keys: "retain" | "clear") {
    if (!current()) return;
    this.removalStatus = status;
    if (keys === "clear") {
      const original = (await this.ports.vault.read()).session;
      if (!current()) return;
      await this.encryption?.clear(original?.userId ?? null);
    }
    if (!current()) return;
    await this.ports.vault.clear(current);
    if (current()) this.completeRemoval();
  }
  private completeRemoval() {
    const status = this.removalStatus;
    if (!status) return;
    this.ports.http.clear(); this.signOutPending = false; this.removalStatus = null;
    this.login.credentialsCleared();
    this.set({ status, profile: null, deviceId: null, pendingLogin: null, error: null,
      canRetryLoginSave: false, loginCancelling: false, cancelUnconfirmed: false });
  }
  /**
   * The account's computers, live. One socket subscription per account generation feeds every renderer listener:
   * the switcher, the sidebar's owner grouping and the composer's send gate all read the same list, so they cannot
   * disagree. A listener that arrives later reads `computers()` first and is pushed every change after that.
   */
  subscribeComputers = (listener: (value: CloudComputersResult) => void) => this.computerListeners.subscribe(listener);
  computers() { return structuredClone(this.computerValue); }
  private publishComputers(value: CloudComputersResult) {
    if (JSON.stringify(value) === JSON.stringify(this.computerValue)) return;
    this.computerValue = value; this.computerListeners.notify(this.computers());
  }
  private watchComputers() {
    // Shutting down is terminal, and it has to be said even when the account had already gone.
    if (this.closed) { this.computerKey = ""; this.computerWatch?.(); this.computerWatch = null; this.publishComputers({ kind: "shutting-down" }); return; }
    const account = Boolean(this.value.profile) && !this.signOutPending;
    const ready = account && this.value.status === "ready" && this.confirmedConnectionEpoch;
    const key = ready ? JSON.stringify([this.value.profile!.userId, this.value.deviceId, this.confirmedConnectionEpoch]) : "";
    /* No account is an answer, and it is said whether or not the subscription key moved. A connection that merely
       dropped is not: the last confirmed list stands, and every client retires presence on its own deadline. */
    if (!account) this.publishComputers({ kind: "signed-out" });
    if (key === this.computerKey) return;
    this.computerKey = key; this.computerWatch?.(); this.computerWatch = null;
    if (!key) return;
    try {
      this.computerWatch = this.ports.transport.watchComputers?.(protocolHeader(this.ports.config),
        value => { if (key === this.computerKey) this.publishComputers({ kind: "computers", computers: value.computers }); },
        // The last confirmed list survives a temporary outage; every client retires presence on its own deadline.
        () => { if (key === this.computerKey) { this.computerWatch = null; this.computerKey = ""; } }) ?? null;
    } catch { this.computerKey = ""; }
  }
  async listDevices(cursor: string | null, state?: "active" | "revoked") {
    const userId = this.value.profile?.userId, generation = this.generation;
    const page = await this.ports.transport.query("devices:list", { ...protocolHeader(this.ports.config), cursor, ...(state ? { state } : {}) });
    if (userId && generation === this.generation && this.value.profile?.userId === userId) this.ports.deviceNames?.(userId, page.devices);
    return page;
  }
  private async refreshDeviceNames() {
    const userId = this.value.profile?.userId; let cursor: string | null = null;
    for (let pageIndex = 0; pageIndex < 20 && this.value.status === "ready" && this.value.profile?.userId === userId; pageIndex++) {
      const page = await this.listDevices(cursor); if (page.complete) return;
      if (!page.cursor || page.cursor === cursor) return; cursor = page.cursor;
    }
  }
  async renameDevice(deviceId: string, name: string) {
    await this.ports.transport.mutate("devices:rename", { ...protocolHeader(this.ports.config), deviceId, name });
    if (this.ports.deviceNames) void this.refreshDeviceNames().catch(() => {});
  }
  /**
   * Renames this computer, every installation on it at once; the server refuses a name another computer holds.
   * Its three refusals are product answers the Settings row says in a sentence, so they cross IPC as values.
   */
  async renameComputer(name: string): Promise<CloudComputerRenameResult> {
    const machineIdHash = this.machineIdHash ?? await this.ports.machineIdHash?.() ?? null;
    if (!machineIdHash) throw new Error("MACHINE_KEY_UNAVAILABLE");
    try { await this.ports.transport.mutate("devices:renameComputer", { ...protocolHeader(this.ports.config), machineIdHash, name }); }
    catch (error) {
      const reason = error instanceof ConvexError ? String(error.data) : "";
      if ((COMPUTER_RENAME_REASONS as readonly string[]).includes(reason)) return { kind: "rejected", reason: reason as CloudComputerRenameReason };
      throw error;
    }
    this.machineIdHash = machineIdHash;
    this.set({ machine: { idHash: machineIdHash, name } });
    if (this.ports.deviceNames) void this.refreshDeviceNames().catch(() => {});
    return { kind: "renamed" };
  }
  async revokeDevice(deviceId: string) {
    if (deviceId === this.value.deviceId || deviceId === this.ports.deviceId) { await this.signOut(); return; }
    await this.ports.transport.mutate("devices:revoke", { ...protocolHeader(this.ports.config), deviceId });
    if (this.ports.deviceNames) void this.refreshDeviceNames().catch(() => {});
  }
  close() { this.setup.cancel(); this.storageUnsubscribe(); this.closed = true; this.confirmConnection(null); this.watchComputers(); if (this.recheckTimer) clearTimeout(this.recheckTimer); this.generation++; this.accessRevision++; this.login.stop(); this.closeTransport(); this.ports.http.clear(); if (this.timer) clearInterval(this.timer); this.listeners.clear(); this.identityListeners.clear(); this.connectionListeners.clear(); this.computerListeners.clear(); }
}
