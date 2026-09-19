/**
 * [INPUT]: Depends on guarded credential transactions, fixed-origin auth and main-owned browser/preparation ports.
 * [OUTPUT]: Coordinates browser approval, durable delivery, mapped server failure codes, backed-off and terminal registration outcomes, a local abandon for an unconfirmable cancellation, and fresh admission after credential removal.
 * [POS]: Sole login owner; a browser launch attempt precedes approval polling, and only display facts plus a state-only URL leave main.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ConvexError } from "convex/values";
import { protocolHeader, type CloudBuildConfig, type DesktopAuthResult, type LoginReturnMode } from "@ai-chat/cloud-protocol";
import { pendingLoginSchema, type PendingLoginProjection, type CloudError } from "../../../../shared/cloud-ipc";
import { CredentialStore, type CloudCredentials, type PendingLogin } from "./credential-store";
import { credentialError, StorageSuperseded } from "./storage/access";
import { AuthTransportError, SessionClient } from "./session-client";
type Proof = { state: string; verifier: string; codeChallenge: string };
type VolatileLogin = Omit<PendingLogin, "phase" | "exchangeId"> & {
  phase: "opening" | "waiting" | "securing"; exchangeId?: string;
};
type Request = VolatileLogin | PendingLogin;
// Registration refusals no retry of the same delivery can clear; the user has to start a new sign-in.
const TERMINAL_REGISTRATION = new Set(["session-already-bound", "invalid-device-kind", "session-owner-mismatch"]);
type Ports = { returnMode: LoginReturnMode; config: CloudBuildConfig; vault: CredentialStore; http: SessionClient;
  platform: "macos" | "windows" | "linux"; name(): Promise<string>; openBrowser(url: string): Promise<void>;
  changed(pending: PendingLoginProjection | null, error: CloudError): void;
  registerSession(): Promise<void> };
export class LoginFlow {
  private generation = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private controller: AbortController | null = null;
  private flight: Promise<unknown> | null = null;
  private starting: Promise<void> | null = null;
  private opening: Promise<void> | null = null;
  private cancelling: Promise<void> | null = null;
  private abandoning: Promise<void> | null = null;
  private remoteCancel: Promise<boolean> | null = null;
  private pending: Request | null = null;
  private proof: Proof | null = null;
  private saveResult: CloudCredentials | null = null;
  private delivery: DesktopAuthResult<"exchange"> | null = null;
  private occupied = false;
  private completed = false;
  private cancelled = false;
  private registered = false;
  private browserAttempted = false;
  private remoteConfirmed = false;
  private mayRetryExchange = false;
  private stopped = false;
  private restarted = false;
  private deviceName: string | null = null;
  private preparation: () => Promise<void> = async () => {};
  private retryDelay = 2000;
  private shownPhase: Request["phase"] | null = null;
  private error: CloudError = null;
  private terminalError: CloudError = null;
  constructor(private readonly ports: Ports) {}
  get state() { return this.pending?.state ?? null; }
  get active() { return this.occupied; }
  get succeeded() { return this.completed; }
  get isCancelling() { return this.cancelled; }
  get cancelUnconfirmed() { return this.cancelled && !this.remoteConfirmed && !!this.error; }
  get canAbandon() { return this.cancelUnconfirmed && !!this.pending && !this.abandoning; }
  get canRetrySave() { return this.active && !this.cancelled && this.error === "secure-save-failed"; }
  private current(generation: number) { return generation === this.generation && !this.stopped; }
  private check(generation: number) { if (!this.current(generation) || this.cancelled) throw new StorageSuperseded(); }
  private browserUrl(pending: Request) {
    const url = new URL("/auth/desktop", this.ports.config.appOrigin);
    url.searchParams.set("state", pending.state); return url.toString();
  }
  private show(error: CloudError = null) {
    const pending = this.pending;
    // Any observed progress restores the full retry budget; only an unchanged failure keeps backing off.
    if (error !== this.error || pending?.phase !== this.shownPhase) this.retryDelay = 2000;
    this.error = error; this.shownPhase = pending?.phase ?? null;
    this.ports.changed(pending ? pendingLoginSchema.parse({ deviceNameSnapshot: pending.deviceNameSnapshot,
      platform: pending.platform, environmentId: pending.environmentId, verificationCode: pending.verificationCode,
      browserUrl: !this.cancelled && ["opening", "waiting"].includes(pending.phase) && pending.expiresAt > Date.now() ? this.browserUrl(pending) : null,
      expiresAt: pending.expiresAt, progress: this.cancelled ? "cancelling" : error === "connection-failed" && pending.phase === "waiting" ? "connection-failed" :
        ({ opening: "opening", waiting: "waiting", securing: "securing", exchanging: "exchanging", "awaiting-ack": "confirming", registering: "registering" } as const)[pending.phase],
    }) : null, error);
  }
  private freshProof() {
    const verifier = randomBytes(32).toString("base64url");
    this.proof = { state: randomBytes(32).toString("base64url"), verifier,
      codeChallenge: createHash("sha256").update(verifier).digest("base64url") };
  }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule(delay = 2000) {
    this.clearTimer(); if (!this.active || this.stopped) return;
    this.timer = setTimeout(() => { this.timer = null; this.tick(); }, delay); this.timer.unref();
  }
  refresh() { this.tick(); }
  private async save(generation: number, change: (value: CloudCredentials) => CloudCredentials | null, retry = false) {
    const expected = this.pending!;
    const guarded = (value: CloudCredentials) => {
      this.check(generation);
      if (retry && this.saveResult && JSON.stringify(value) === JSON.stringify(this.saveResult)) return null;
      if (value.login && (value.login.state !== expected.state || value.login.exchangeId !== expected.exchangeId) ||
        value.signOutRequested || !value.login && value.session) throw new StorageSuperseded();
      const next = change(value); if (next) this.saveResult = next; return next;
    };
    const guard = () => this.current(generation) && !this.cancelled;
    const value = retry ? await this.ports.vault.retryUpdate(guarded, guard) : await this.ports.vault.update(guarded, { guard });
    this.check(generation);
    this.pending = value.login; this.saveResult = null;
    if (!value.login) { this.occupied = false; this.completed = !!value.session; this.proof = null; this.delivery = null; }
    this.show(); return value;
  }
  async resume() {
    if (this.active || this.ports.vault.access.blocked || this.ports.vault.access.frozen) return;
    this.stopped = false;
    const generation = this.generation;
    try {
      const value = await this.ports.vault.read(); if (!this.current(generation)) return;
      this.pending = value.login; this.occupied = !!value.login;
      this.proof = value.login; this.registered = !!value.login;
      this.cancelled = !!value.login?.cancelRequested;
      this.show(); if (value.login) this.tick();
    } catch (error) { if (this.current(generation)) this.report(error); }
  }
  start(prepare: () => Promise<void> = async () => {}): Promise<void> {
    if (this.starting) return this.starting;
    if (this.pending || this.cancelled || this.stopped && this.active) return Promise.resolve();
    if (!this.active) {
      this.generation++; this.stopped = false; this.occupied = true; this.completed = false; this.browserAttempted = false;
      this.restarted = false; this.deviceName = null; this.freshProof();
    }
    this.preparation = prepare;
    const generation = this.generation, proof = this.proof!;
    this.show();
    // Defer even the first preparation call until the accepted projection has been published.
    const request = Promise.resolve().then(async () => {
      await prepare(); this.check(generation);
      // The snapshot is pinned for the whole attempt: a re-read name would make the retry a different request.
      const name = this.deviceName ??= await this.ports.name(); this.check(generation);
      const controller = new AbortController(); this.controller = controller;
      const display = await this.ports.http.request("start", { ...protocolHeader(this.ports.config), state: proof.state,
        codeChallenge: proof.codeChallenge, returnMode: this.ports.returnMode, callback: this.ports.config.callbackScheme === "bottega" ? "bottega://auth/callback" : "bottega-dev://auth/callback",
        deviceNameSnapshot: name, platform: this.ports.platform }, { signal: controller.signal });
      this.registered = true;
      this.check(generation);
      const { status: _status, returnMode: _returnMode, ...snapshot } = display;
      this.pending = { ...snapshot, ...proof, phase: "opening" }; this.show();
      await this.reopen();
    }).catch(error => { if (this.current(generation) && !(error instanceof StorageSuperseded)) this.report(error); });
    this.starting = request;
    void request.finally(() => { if (this.starting === request) this.starting = null; });
    return request;
  }
  reopen(): Promise<void> {
    if (this.opening) return this.opening;
    const pending = this.pending, generation = this.generation;
    if (!pending || this.cancelled || !["opening", "waiting"].includes(pending.phase)) return Promise.resolve();
    if (pending.expiresAt <= Date.now()) { this.release("login-expired"); return Promise.resolve(); }
    this.pending = { ...pending, phase: "opening" }; this.show();
    const awaitingBrowser = () => this.current(generation) && !this.cancelled && this.pending?.state === pending.state &&
      ["opening", "waiting"].includes(this.pending.phase);
    const request = Promise.resolve().then(() => {
      this.check(generation); this.browserAttempted = true;
      const opening = this.ports.openBrowser(this.browserUrl(pending));
      // OS launch success cannot prove that a window opened; manual approval must still be observed.
      this.tick(); return opening;
    }).then(() => {
      if (!awaitingBrowser()) return;
      this.pending = { ...this.pending!, phase: "waiting" }; this.show(); this.tick();
    }).catch(error => {
      if (awaitingBrowser() && !(error instanceof StorageSuperseded)) {
        this.pending = { ...this.pending!, phase: "waiting" }; this.show("browser-open-failed"); this.tick();
      }
    });
    this.opening = request;
    void request.finally(() => { if (this.opening === request) this.opening = null; }); return request;
  }
  cancel(): Promise<void> {
    if (!this.active || this.abandoning) return Promise.resolve();
    if (!this.cancelled) {
      this.cancelled = true; this.generation++; this.controller?.abort(); this.clearTimer(); this.show();
    }
    return this.runCancellation();
  }
  /* A cancellation the server never confirms must still have an exit: the durable record goes now and the
     request on the server is left to expire, so the user can start a different sign-in instead of quitting. */
  abandon(): Promise<void> {
    if (this.abandoning) return this.abandoning;
    if (!this.canAbandon) return Promise.resolve();
    this.generation++; this.controller?.abort(); this.clearTimer();
    const generation = this.generation, pending = this.pending!;
    // Best effort and unawaited: the local record must not wait for a network that is already failing.
    if (this.registered) void this.requestCancel();
    const request = (async () => {
      await this.ports.vault.finishLogin(pending.state, pending.exchangeId, () => generation === this.generation && !this.stopped);
      if (generation !== this.generation) return;
      this.release();
    })().catch(error => { if (this.current(generation)) this.report(error); });
    this.abandoning = request;
    void request.finally(() => { if (this.abandoning === request) this.abandoning = null; });
    return request;
  }
  private requestCancel(): Promise<boolean> {
    if (this.remoteConfirmed) return Promise.resolve(true);
    if (this.remoteCancel) return this.remoteCancel;
    const proof = this.proof;
    if (!proof) return Promise.resolve(true);
    const generation = this.generation;
    const request = this.ports.http.request("cancel", { ...protocolHeader(this.ports.config), state: proof.state, verifier: proof.verifier })
      .then(result => {
        const confirmed = result.status === "cancelled" || result.status === "expired";
        if (this.current(generation)) this.remoteConfirmed = confirmed;
        return confirmed;
      }).catch(() => false);
    this.remoteCancel = request;
    void request.finally(() => { if (this.remoteCancel === request) this.remoteCancel = null; });
    return request;
  }
  private runCancellation(): Promise<void> {
    if (this.cancelling) return this.cancelling;
    const generation = this.generation;
    // Send the retained proof before waiting for any keychain or filesystem operation.
    const remote = this.registered ? this.requestCancel() : null;
    const request = (async () => {
      await Promise.allSettled([this.starting, this.flight, this.opening]);
      if (!this.current(generation)) return;
      const confirmed = await (remote ?? this.requestCancel());
      if (!this.current(generation)) return;
      const proof = this.proof;
      if (!proof) { this.release(); return; }
      const value = await this.ports.vault.cancelLogin(proof.state, this.pending?.exchangeId,
        () => this.current(generation) && this.cancelled, this.pending?.phase === "registering" ? this.pending : undefined);
      if (!this.current(generation)) return;
      if (!value) { this.release(); return; }
      this.pending = value.login;
      if (!confirmed) { this.show("connection-failed"); return; }
      if (value.session) try { await this.ports.http.signOut(value.session.bearer); }
      catch (error) { if (!(error instanceof AuthTransportError) || error.kind !== "invalid-session") throw error; }
      await this.finish(generation);
    })().catch(error => { if (this.current(generation)) this.report(error); });
    this.cancelling = request;
    void request.finally(() => {
      if (this.cancelling === request) this.cancelling = null;
      if (this.current(generation) && this.cancelled) this.schedule();
    });
    return request;
  }
  stop() { this.stopped = true; this.generation++; this.controller?.abort(); this.clearTimer(); }
  async drain() { await Promise.allSettled([this.starting, this.flight, this.opening, this.cancelling, this.abandoning]); }
  async quiesce() {
    // Discard drains writers without trying to decrypt the file it is about to remove.
    if (this.proof) void this.requestCancel();
    this.stop(); await this.drain();
  }
  // The account owner publishes removal atomically after its durable cleanup finishes.
  credentialsCleared() { this.stopped = false; this.release(null, false); }
  private release(error: CloudError = null, notify = true) {
    this.generation++; this.clearTimer(); this.pending = null; this.proof = null; this.delivery = null; this.saveResult = null; this.occupied = false; this.completed = false;
    error ??= this.terminalError; this.terminalError = null;
    this.cancelled = false; this.remoteConfirmed = false; this.remoteCancel = null; this.registered = false;
    this.browserAttempted = false; this.mayRetryExchange = false; this.restarted = false; this.deviceName = null; this.error = error;
    if (notify) this.show(error);
  }
  private tick() {
    if (this.stopped || !this.active || this.abandoning) return;
    if (this.cancelled) { void this.runCancellation(); return; }
    if (this.flight || !this.pending || this.ports.vault.access.blocked || this.ports.vault.access.frozen ||
      ["opening", "waiting"].includes(this.pending.phase) && !this.browserAttempted) return;
    const generation = this.generation;
    const request = this.step(generation).catch(error => {
      if (this.current(generation) && !(error instanceof StorageSuperseded)) this.report(error);
      return false;
    });
    this.flight = request;
    void request.then(immediate => {
      if (this.flight === request) this.flight = null;
      if (this.current(generation) && this.active && !this.ports.vault.access.blocked) this.schedule(immediate ? 300 : this.retryDelay);
    });
  }
  private report(error: unknown) {
    const transport = error instanceof AuthTransportError ? error : null;
    // The bridge reports the server's own failure code; without it every delivery refusal reads the same.
    const code = transport?.code ?? (error instanceof ConvexError ? error.data : error instanceof Error ? error.message : "");
    if (this.pending && !this.cancelled && (code === "login-expired" || TERMINAL_REGISTRATION.has(String(code)))) {
      this.terminalError = code === "login-expired" ? "login-expired" : "request-failed"; void this.cancel(); return;
    }
    if (!this.pending && code === "sign-out-required") { this.release("sign-out-required"); return; }
    // The server still holds an identical challenge for this state; one fresh state retries it invisibly.
    if (!this.pending && code === "login-request-exists" && this.active && !this.cancelled && !this.restarted) {
      this.restarted = true; this.freshProof();
      const prepare = this.preparation, settled = this.starting ?? Promise.resolve();
      void settled.then(() => { if (!this.stopped && this.active && !this.pending && !this.cancelled) void this.start(prepare); });
      return;
    }
    if (!this.pending && (code === "environment-mismatch" || code === "client-outdated" || code === "server-outdated")) { this.release(code); return; }
    const previous = this.error, phase = this.shownPhase;
    this.show(credentialError(error) ?? (code === "rate-limited" || transport?.status === 429 ? "rate-limited" :
      transport?.kind === "temporarily-offline" ? "connection-failed" :
      code === "installation-already-active" ? "installation-already-active" :
      code === "environment-mismatch" || code === "client-outdated" || code === "server-outdated" ? code : "request-failed"));
    if (this.error === previous && this.shownPhase === phase) this.retryDelay = Math.min(this.retryDelay * 2, 30_000);
  }
  private async finish(generation: number, error: CloudError = null) {
    if (!this.current(generation)) throw new StorageSuperseded();
    const pending = this.pending;
    if (pending && !["opening", "waiting"].includes(pending.phase)) {
      await this.ports.vault.finishLogin(pending.state, pending.exchangeId, () => this.current(generation));
    }
    if (!this.current(generation)) throw new StorageSuperseded();
    this.release(error);
  }
  private async handoff(generation: number, retry = false) {
    const pending = this.pending!;
    if (pending.expiresAt <= Date.now()) { await this.cancelExpired(generation); return; }
    const durable: PendingLogin = { ...pending, phase: "exchanging", exchangeId: pending.exchangeId ?? randomUUID() };
    this.pending = { ...durable, phase: "securing" }; this.show();
    await this.save(generation, value => value.login ? null : { ...value, login: durable }, retry);
    this.mayRetryExchange = false;
  }
  private async saveDelivery(generation: number, retry = false) {
    const result = this.delivery!, pending = this.pending!;
    if (result.deliveryDeadline <= Date.now()) { await this.cancelExpired(generation); return; }
    await this.save(generation, value => ({ ...value,
      session: { userId: result.profile.userId, sessionId: result.issuedSessionId, bearer: result.bearer },
      login: { ...pending, phase: "awaiting-ack", exchangeId: result.exchangeId,
        issuedSessionId: result.issuedSessionId, deliveryDeadline: result.deliveryDeadline } }), retry);
    this.delivery = null;
  }
  retrySave(): Promise<void> {
    if (this.flight || !this.canRetrySave || !this.pending) return Promise.resolve();
    const generation = this.generation;
    const request = (async () => {
      if (this.delivery) await this.saveDelivery(generation, true);
      else if (this.pending?.phase === "securing") await this.handoff(generation, true);
      else {
        // A later phase write may already have committed; verify that original record before continuing.
        const candidate = this.saveResult;
        await this.save(generation, () => candidate, true);
      }
    })().catch(error => { if (this.current(generation) && !(error instanceof StorageSuperseded)) this.report(error); });
    this.flight = request;
    void request.finally(() => { if (this.flight === request) this.flight = null; if (this.current(generation)) this.tick(); });
    return request;
  }
  private async cancelExpired(generation: number) {
    this.check(generation);
    // A possible committed record must be cancelled and reconciled, even after the challenge expires.
    this.terminalError = "login-expired"; void this.cancel();
  }
  private async step(generation: number): Promise<boolean> {
    let pending = this.pending!;
    this.check(generation);
    const controller = new AbortController(); this.controller = controller;
    const options = { signal: controller.signal }, header = protocolHeader(this.ports.config);
    const proof = { ...header, state: pending.state, verifier: pending.verifier };
    if (["opening", "waiting"].includes(pending.phase)) {
      if (pending.expiresAt <= Date.now()) { await this.finish(generation, "login-expired"); return false; }
      const response = await this.ports.http.request("status", proof, options); this.check(generation);
      if (response.status === "pending") { this.show(this.error === "browser-open-failed" ? this.error : null); return false; }
      if (response.status === "approved") { await this.handoff(generation); return true; }
      if (["consumed", "acknowledged"].includes(response.status)) { void this.cancel(); return false; }
      await this.finish(generation, response.status === "expired" ? "login-expired" : "login-rejected"); return false;
    }
    const value = await this.ports.vault.read(); this.check(generation);
    if (!value.login || value.login.state !== pending.state || value.login.exchangeId !== pending.exchangeId) throw new StorageSuperseded();
    pending = value.login; this.pending = pending;
    if (pending.cancelRequested) { void this.cancel(); return false; }
    if (pending.phase === "exchanging") {
      if (!this.mayRetryExchange) {
        const response = await this.ports.http.request("exchangeStatus", { ...proof, exchangeId: pending.exchangeId }, options); this.check(generation);
        if (["pending", "approved"].includes(response.status)) { this.mayRetryExchange = true; return true; }
        if (["consumed", "acknowledged"].includes(response.status)) { void this.cancel(); return false; }
        await this.finish(generation, response.status === "expired" ? "login-expired" : "login-rejected"); return false;
      }
      const response = await this.ports.http.request("status", proof, options); this.check(generation);
      if (response.status === "approved" && pending.expiresAt > Date.now()) {
        this.mayRetryExchange = false;
        const result = await this.ports.http.request("exchange", { ...proof, exchangeId: pending.exchangeId, code: response.code }, options);
        this.check(generation); this.delivery = result;
        await this.saveDelivery(generation); return true;
      }
      this.mayRetryExchange = false;
      if (pending.expiresAt <= Date.now() && response.status === "approved") await this.cancelExpired(generation);
      return false;
    }
    if (pending.phase === "awaiting-ack") {
      try { await this.ports.http.request("ack", { ...header, exchangeId: pending.exchangeId }, { ...options, bearer: value.session!.bearer }); }
      catch (error) {
        if (error instanceof AuthTransportError && error.kind !== "temporarily-offline") { void this.cancel(); return false; }
        throw error;
      }
      this.check(generation);
      await this.save(generation, current => ({ ...current, login: { ...pending, phase: "registering" } })); return true;
    }
    await this.ports.registerSession(); this.check(generation);
    await this.save(generation, current => ({ ...current, login: null })); return false;
  }
}
