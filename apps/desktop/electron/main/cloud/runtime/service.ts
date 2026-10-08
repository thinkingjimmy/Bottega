/**
 * [INPUT]: Depends on the credential vault, login flow, closed transport, installation identity, asynchronous presence snapshots and account scope lifecycle.
 * [OUTPUT]: Provides Store-independent heartbeats with account-fenced timestamped pending-count sampling and presence diagnostics, recoverable login admission, binding-fenced offline identity, machine-keyed device registration, one account-generation computer subscription and machine-wide rename, pending-delivery display and localIdentityReady, account-fenced bounded sync setup retries, cleanup-fenced inspection, pending sign-out, subscription-only heartbeats that exist only while an account is stored (signed out, availability is checked at launch, on settingsOpened and on sign-in — never on a timer), connection-fenced wake recovery independent of account operations, single-flight handshake re-checks on a bounded backoff and SavedLoginReviewExpired; a Dock activation keeps the socket, token and scope, and a socket blip keeps the scope and the ready state until the grace (blipGraceMs) ends (TASK-20 T20-1); the transport's subscriptions are bound to the current account/device scope (T20-1b); networkChanged wakes the token ladder, re-checks a failing handshake and reconnects only a lost or unauthenticated socket (T20-2); publishes serverClockOffset from the transport's Date samples (T20-9b).
 * [POS]: Sync and encryption operations are delegated to SyncControls (../encryption/sync-controls), which reads this account's state and generation live. Owns the connection epoch for the life of this process (new only at start, account change and a wake after a reported sleep). Account owner consumed by Electron composition and trusted IPC; local Stores remain authoritative.
 */
import type { SyncEncryptionController } from "../encryption/controller";
import { SyncControls } from "../encryption/sync-controls";
import type { SyncEncryptionState, SyncSetupInput } from "../../../../shared/cloud/encryption";
import { randomUUID } from "node:crypto";
import { ConvexError } from "convex/values";
import { CLOUD_LIMITS, protocolHeader, type AccountAccess, type CloudBuildConfig, type LoginReturnMode, type RemoteHealthStatus } from "@ai-chat/cloud-protocol";
import { cloudAccountStateSchema, cloudHandshakeFailed, COMPUTER_RENAME_REASONS, type CloudAccountState, type CloudComputerRenameReason, type CloudComputerRenameResult, type CloudComputersResult, type CloudError, type PendingLoginProjection } from "../../../../shared/ipc/settings/cloud-ipc";
import { CredentialStore, type CloudCredentials } from "../account/credential-store";
import { credentialError, StorageSuperseded } from "../account/storage/access";
import { LoginFlow } from "../account/login-flow";
import { SessionClient, AuthTransportError } from "../account/session-client";
import type { AccountTransport } from "./transport/transport";
import type { AccountScopeLifecycle } from "../sync/account/cleanup/lifecycle";
import type { InitialSyncController } from "../sync/initial/controller";
import type { SyncProgress } from "../../../../shared/cloud/sync";
import { ChangeNotifier } from "./transport/notifier";
import { rememberOfflineIdentity, restoreOfflineIdentity, restorePendingLogin } from "./offline/identity";
import type { SyncBindingStore } from "../sync/account/binding";
import { PendingCountSnapshot } from "./presence/pending-snapshot";
type Ports = { returnMode: LoginReturnMode; config: CloudBuildConfig; vault: CredentialStore; http: SessionClient; transport: AccountTransport;
  binding?: Pick<SyncBindingStore, "snapshot">; deviceId: string; version: string; platform: "macos" | "windows" | "linux";
  /** This computer's key; the server groups this account's installations by it. Resolved once, with registration. */
  machineIdHash?(): Promise<string | null>;
  /** The Bottega folder this installation holds; the server admits its publications against that folder's owner. */
  libraryId?(): string | null;
  name(): Promise<string>; openBrowser(url: string): Promise<void>;
  remoteHealth?(): RemoteHealthStatus;
  deviceNames?(userId: string, devices: import("@ai-chat/cloud-protocol").CloudDevice[]): void;
  scope?: Pick<AccountScopeLifecycle, "initialize" | "admit" | "disconnectAccount" | "pendingCount" | "suspend">;
  /** How long a dropped socket keeps the ready state before the normal offline state shows; CLOUD_LIMITS.offlineAfterMs by default. */
  blipGraceMs?: number };
/* A failed handshake has nothing to heartbeat, so while it fails these delays own the retry
   cadence: a service that is simply out of date is not polled at the heartbeat rate forever. */
const RECHECK_DELAYS_MS = [30_000, 60_000, 120_000] as const;
/** Something this desktop is signed in to, signing in to, or still signing out of. */
const storedAccount = (value: { session?: unknown; login?: unknown; signOutRequested?: boolean }) =>
  Boolean(value.session || value.login || value.signOutRequested);
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
  private blipTimer: ReturnType<typeof setTimeout> | null = null;
  private recheckStep = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private stored = false;
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
  private readonly syncControls: SyncControls;
  private authenticatedSessionId: string | null = null;
  private rememberedIdentity = "";
  private subscribed = false;
  constructor(private readonly ports: Ports) {
    this.value = cloudAccountStateSchema.parse({ available: true, environmentId: ports.config.environmentId,
      status: "signed-out", profile: null, deviceId: null, pendingLogin: null, error: null, sync: { status: "not-connected" } });
    this.syncControls = new SyncControls({ value: () => this.value, generation: () => this.generation, closed: () => this.closed,
      signOutPending: () => this.signOutPending, authenticatedSessionId: () => this.authenticatedSessionId, refresh: () => this.refresh(), set: change => this.set(change) });
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
  attachEncryption(owner: SyncEncryptionController) { this.syncControls.attachEncryption(owner); }
  updateEncryption(encryption: SyncEncryptionState) { this.set({ encryption }); }
  setupEncryption(input: SyncSetupInput) { return this.syncControls.setupEncryption(input); }
  unlockEncryption(input: { password: string }) { return this.syncControls.unlockEncryption(input); }
  retryEncryption() { return this.syncControls.retryEncryption(); }
  cancelEncryption() { return this.syncControls.cancelEncryption(); }
  remoteConnection() { return this.value.status === "ready" && !this.closed && !this.signOutPending ? this.confirmedConnectionEpoch : null; }
  subscribeConnection = this.connectionListeners.subscribe;
  private confirmConnection(epoch: string | null) {
    if (this.confirmedConnectionEpoch === epoch) return;
    this.confirmedConnectionEpoch = epoch; this.watchComputers(); this.connectionListeners.notify();
  }
  private closeTransport() { this.connectionGeneration++; this.subscribed = false; this.ports.transport.close(); }
  // A confirmed epoch on a live subscription already owns access changes, so a heartbeat needs nothing else.
  private steady() { return this.subscribed && this.value.status === "ready" && this.registeredGeneration === this.generation && this.confirmedConnectionEpoch !== null; }
  attachSync(sync: InitialSyncController) { this.syncControls.attachSync(sync); }
  updateSync(sync: SyncProgress) { this.set({ sync }); }
  updateAvatar(userId: string | null, avatarDataUrl: string | null) {
    if ((this.value.profile?.userId ?? null) === userId) this.set({ avatarDataUrl });
  }
  inspectSync() { return this.syncControls.inspectSync(); }
  cancelSyncReview() { this.syncControls.cancelSyncReview(); }
  approveSync(reviewId: string) { return this.syncControls.approveSync(reviewId); }
  retrySync() { return this.syncControls.retrySync(); }
  inspectCleanup() { return this.syncControls.inspectCleanup(); }
  disableSync(reviewId: string) { return this.syncControls.disableSync(reviewId); }
  inspectAccountSwitch() { return this.syncControls.inspectAccountSwitch(); }
  switchAccount(reviewId: string) { return this.syncControls.switchAccount(reviewId); }
  subscribe = this.listeners.subscribe;
  private set(change: Partial<CloudAccountState>) {
    if (this.closed) return;
    if (change.status && change.status !== "ready") { this.confirmConnection(null); change = { ...change, remoteHealth: undefined }; }
    if ("profile" in change && change.profile?.userId !== this.value.profile?.userId) change = { ...change, remoteHealth: undefined };
    if ("profile" in change && (change.profile?.userId !== this.value.profile?.userId || change.profile?.avatarUrl !== this.value.profile?.avatarUrl)) change = { ...change, avatarDataUrl: null };
    const next = cloudAccountStateSchema.parse({ ...this.value, signOutPending: this.signOutPending, ...change });
    if (JSON.stringify(next) === JSON.stringify(this.value)) { this.notifyIdentity(); this.watchComputers(); return; }
    this.value = next;
    // Subscriptions survive a socket change only within one account and device (T20-1b); any other change ends them.
    this.ports.transport.bindScope?.(next.profile && next.deviceId ? `${next.profile.userId}:${next.deviceId}` : null);
    this.notifyIdentity(); this.watchComputers(); this.syncControls.setup.accountChanged(); this.armRecheck(); this.listeners.notify(this.snapshot());
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
      this.stored = storedAccount(value);
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
      this.armHeartbeat(); }
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
  recheckConnection() { if (this.unavailable() && this.stored) void this.recheck(); }
  /**
   * TASK-20 T20-2: every renderer online/offline change arrives here. Online wakes a token retry waiting on its ladder,
   * re-checks a failing handshake, and reconnects at once only a socket that is gone or unauthenticated; a healthy socket
   * is left to the SDK. Offline is only a hint: the socket's own state decides.
   */
  networkChanged(online: boolean) {
    if (!online || this.closed) return;
    this.ports.transport.networkOnline?.();
    if (!this.stored) return;
    if (this.unavailable()) { void this.recheck(); return; }
    if (this.ports.transport.needsReconnect?.()) { this.closeTransport(); void this.refresh(); }
  }
  /* Signed out, nothing polls (C-28, ruled 2026-09-25): availability is checked at launch, when Settings opens and when
     Sign in is pressed, and "update required" / "server unavailable" show at those moments. Only a stored session,
     login or pending sign-out keeps the heartbeat — and with it the failing-handshake backoff — alive. */
  settingsOpened() { if (!this.closed && !this.stored && !this.login.active) void this.checkAvailability(); }
  private armHeartbeat() {
    const wanted = !this.closed && this.stored;
    if (wanted && !this.timer) {
      // The backoff owns the cadence while the handshake is failing, so the heartbeat stays out of its way.
      this.timer = setInterval(() => { if (!this.unavailable()) void this.refresh(); }, CLOUD_LIMITS.heartbeatMs); this.timer.unref();
    } else if (!wanted && this.timer) { clearInterval(this.timer); this.timer = null; }
  }
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
    if (!this.unavailable() || !this.stored) {
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
  /* The connection epoch lives as long as this process is present (OPT-10): only a wake after a reported sleep starts a
     new one, since claimed work may be hours old by then. Dock activation, focus and transport reconnects keep it, so a
     short drop leaves presence, claims and capability facts valid instead of rejecting commands as connection-changed. */
  async refresh(resumed = false) {
    const slept = resumed && this.presenceStopped;
    if (resumed) { this.presenceStopped = false; this.ports.transport.networkOnline?.(); }
    if (this.closed || this.discardReview?.confirmed || this.storageRetry) return;
    const generation = this.generation;
    let connectionGeneration = this.connectionGeneration;
    const current = () => !this.closed && generation === this.generation && connectionGeneration === this.connectionGeneration;
    try {
      if (this.login.active) { this.login.refresh(); return; }
      if (this.ports.vault.access.blocked) return;
      /* TASK-20 T20-1: a Dock activation keeps the socket, the token and the admitted scope (tearing them down re-read every watch
         on each click). Only a wake after a reported sleep starts over: a new epoch, and a fresh socket that fences calls the sleep
         left hanging; the sync run it closes comes back on re-admission (F2). */
      if (slept) {
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
      this.stored = storedAccount(value); this.armHeartbeat();
      if (value.signOutRequested) { this.signOutPending = true; await this.finishSignOut(); return; }
      if (value.login) { if (!this.login.active) { await this.ports.transport.handshake(); await this.login.resume(); } return; }
      if (!value.session) {
        if (["signed-out", "temporarily-offline", "environment-mismatch", "client-outdated"].includes(this.value.status) || this.value.error === "server-outdated") await this.checkAvailability();
        return;
      }
      await this.ports.scope?.initialize();
      if (!current()) return;
      await this.reconcile(value);
      // T20-9b: the handshake's Date sample becomes the renderer's server clock; a move under a second is not worth a publish.
      const offset = this.ports.transport.serverTimeOffset?.() ?? null, published = this.value.serverClockOffset;
      if (current() && offset !== null && (published === undefined || Math.abs(offset - published) > 1_000)) this.set({ serverClockOffset: offset });
      if (current() && this.value.status === "ready") await this.heartbeat();
    } catch (error) { if (current()) this.failure(error); }
  }
  private presenceStopped = false;
  private heartbeatFlight: Promise<void> | null = null;
  private readonly pendingSnapshot = new PendingCountSnapshot(CLOUD_LIMITS.heartbeatMs);
  reportOffline(reason: "sleep" | "quit"): Promise<void> {
    this.presenceStopped = true;
    const epoch = this.connectionEpoch, generation = this.generation;
    const flight = Promise.resolve(this.heartbeatFlight).catch(() => {}).then(async () => {
      if (this.closed || !this.presenceStopped || this.value.status !== "ready" || this.connectionEpoch !== epoch || this.generation !== generation) return;
      await this.ports.transport.mutate("devices:heartbeat", { ...protocolHeader(this.ports.config),
        connectionEpoch: epoch, previousConnectionEpoch: epoch, ...this.outboxSnapshot(), lastSeenReason: reason, ...this.machineKey() });
    }).finally(() => { if (this.heartbeatFlight === flight) this.heartbeatFlight = null; });
    this.heartbeatFlight = flight; return flight;
  }
  private machineKey() {
    const libraryId = this.ports.libraryId?.() ?? null;
    return { ...(this.machineIdHash ? { machineIdHash: this.machineIdHash } : {}), ...(libraryId ? { libraryId } : {}) };
  }
  private outboxSnapshot(sample = false) {
    const identity = this.syncIdentity(), generation = this.generation;
    const owner = identity ? JSON.stringify([generation, identity]) : null;
    if (!sample || !owner || !this.ports.scope) return this.pendingSnapshot.snapshot(owner);
    return this.pendingSnapshot.sample(owner, () => this.ports.scope!.pendingCount(),
      () => generation === this.generation && JSON.stringify(this.syncIdentity()) === JSON.stringify(identity));
  }
  remoteHealth(): RemoteHealthStatus {
    if (!this.syncIdentity()) return "recovering";
    const encryption = this.value.encryption.status;
    if (encryption !== "unlocked") return ["checking", "setting-up", "unlocking"].includes(encryption) ? "initializing" : "locked";
    try {
      const remote = this.ports.remoteHealth?.() ?? "recovering";
      if (remote === "ready" && this.ports.transport.uploadRecovering?.()) return "recovering";
      return remote === "ready" && ["error", "partial"].includes(this.value.sync.status) ? "content-error" : remote;
    } catch { return "recovering"; }
  }
  presenceDiagnostics() { this.outboxSnapshot(); return this.pendingSnapshot.diagnostics(); }
  private heartbeat(): Promise<void> {
    if (this.presenceStopped) return Promise.resolve();
    if (this.heartbeatFlight) return this.heartbeatFlight;
    const flight = this.sendHeartbeat().finally(() => { if (this.heartbeatFlight === flight) this.heartbeatFlight = null; });
    this.heartbeatFlight = flight; return flight;
  }
  private async sendHeartbeat() {
    const epoch = this.connectionEpoch, generation = this.generation, connectionGeneration = this.connectionGeneration;
    const current = () => !this.closed && generation === this.generation && connectionGeneration === this.connectionGeneration &&
      epoch === this.connectionEpoch && !this.presenceStopped && this.syncIdentity() !== null;
    const previousConnectionEpoch = this.serverConnectionEpoch;
    if (!current()) return;
    const outbox = this.outboxSnapshot(true), health = { status: this.remoteHealth(), sampledAt: Date.now() };
    try {
      await this.ports.transport.mutate("devices:heartbeat", {
        ...protocolHeader(this.ports.config), connectionEpoch: epoch, previousConnectionEpoch, ...outbox, remoteHealth: health.status, ...this.machineKey() });
    } catch (error) {
      /* The server holds another epoch for this device (another process of it, or a presence the sweep replaced): this
         process becomes present again under a new epoch (OPT-10 epoch table). The reconcile that follows reads the epoch
         the server holds, so the next heartbeat's CAS names it instead of failing the same way again. */
      if (!(error instanceof ConvexError && error.data === "connection-changed") || !current()) throw error;
      this.connectionEpoch = randomUUID(); this.serverConnectionEpoch = null; this.confirmConnection(null);
      queueMicrotask(() => { void this.refresh(); });
      return;
    }
    if (current()) {
      this.serverConnectionEpoch = epoch; this.confirmConnection(epoch);
      const previous = this.value.remoteHealth;
      if (!previous || previous.status !== health.status || health.sampledAt - previous.sampledAt >= 7 * 60_000) this.set({ remoteHealth: health });
    }
  }
  private reconcile(credentials?: CloudCredentials): Promise<void> {
    if (this.flight) return this.flight;
    const generation = this.generation, connectionGeneration = this.connectionGeneration;
    const current = () => !this.closed && generation === this.generation && connectionGeneration === this.connectionGeneration && !this.signOutPending && !this.login.isCancelling && !this.discardReview?.confirmed && !this.ports.vault.access.blocked;
    this.stored = true; this.armHeartbeat();
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
          if (this.blipTimer) { clearTimeout(this.blipTimer); this.blipTimer = null; }
          if (connected) { this.confirmConnection(null); void this.refresh(); }
          else if (this.value.status === "ready") {
            /* A blip keeps the scope and the ready state (no offline flash); remote work waits for a confirmed connection, and
               only past the grace does the normal offline state show (TASK-20 T20-1). */
            this.confirmConnection(null);
            this.blipTimer = setTimeout(() => {
              this.blipTimer = null;
              if (current() && this.value.status === "ready") this.set({ status: "temporarily-offline", error: "connection-failed" });
            }, this.ports.blipGraceMs ?? CLOUD_LIMITS.offlineAfterMs);
            this.blipTimer.unref?.();
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
      await this.syncControls.encryption?.cancel("account");
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
    await this.syncControls.encryption?.clear(original?.userId ?? null);
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
    this.syncControls.setup.cancel();
    this.confirmConnection(null); this.discardReview = null;
    await this.syncControls.encryption?.clear();
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
      await this.syncControls.encryption?.clear(original?.userId ?? null);
    }
    if (!current()) return;
    await this.ports.vault.clear(current);
    if (current()) this.completeRemoval();
  }
  private completeRemoval() {
    const status = this.removalStatus;
    if (!status) return;
    this.ports.http.clear(); this.signOutPending = false; this.removalStatus = null;
    this.stored = false; this.armHeartbeat();
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
        () => { if (key === this.computerKey) { this.computerWatch?.(); this.computerWatch = null; this.computerKey = ""; } }) ?? null;
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
  close() { if (this.blipTimer) clearTimeout(this.blipTimer); this.syncControls.setup.cancel(); this.storageUnsubscribe(); this.closed = true; this.pendingSnapshot.close(); this.confirmConnection(null); this.watchComputers(); if (this.recheckTimer) clearTimeout(this.recheckTimer); this.generation++; this.accessRevision++; this.login.stop(); this.closeTransport(); this.ports.http.clear(); if (this.timer) clearInterval(this.timer); this.listeners.clear(); this.identityListeners.clear(); this.connectionListeners.clear(); this.computerListeners.clear(); }
}
