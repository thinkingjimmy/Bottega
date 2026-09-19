/**
 * [INPUT]: Verified account/space/continuity RPCs, native key persistence and the original sync review owner.
 * [OUTPUT]: Main-owned setup, durable consent detection, coalesced space checks, password recovery, retained workers, waiting background admission and cancellation-safe reinspection.
 * [POS]: Desktop encryption admission owner; no business outbox, account authority or renderer key API.
 */
import { passwordsMatch, validatePassword, validateNewPassword, CryptoQueue, cryptoConcurrency, type CryptoCommand, type CryptoResult, type CryptoWorkerOwner } from "@ai-chat/cloud-crypto";
import { ConvexError } from "convex/values";
import { CryptoError, decodeBase64url, encodeBase64url, parseKeyPackage, assertExpectedScope, encodeContext, scopeTuple, MAX_ENVELOPE_BYTES, PLAINTEXT_LIMITS, type KeyPackageFingerprint } from "@ai-chat/cloud-protocol/encryption";
import type { SpaceDescriptor } from "@ai-chat/cloud-protocol/spaces";
import type { ContinuityIdentity } from "@ai-chat/cloud-protocol/continuity/functions";
import { ServerClock } from "@ai-chat/cloud-protocol/continuity/clock";
import { initialEncryptionState, syncEncryptionErrorSchema, type SyncEncryptionError, type SyncEncryptionState, type SyncSetupInput } from "../../../../shared/cloud/encryption";
import { SyncKeyStorageError, type SyncKeyRecord } from "./storage/model";
import { sameIdentity, sameSpace, verifySpace, type EncryptedConsent, type EncryptionPorts, type SyncIdentity } from "./model";

type Operation = { identity: SyncIdentity; generation: number; guard(): void; current(): boolean };
type ContentCommand = Extract<CryptoCommand, { kind: "encrypt" | "decrypt" }>;
type ContentResult = Extract<CryptoResult, { kind: "encrypted" | "decrypted" }>;
const PASSWORD_RECOVERABLE: readonly string[] = ["sync-unlock-failed", "sync-password-invalid", "sync-password-mismatch", "sync-password-weak", "sync-key-cache-unreadable"];
export class SyncEncryptionController {
  private value: SyncEncryptionState = { ...initialEncryptionState };
  private space: SpaceDescriptor | null = null;
  private worker: CryptoWorkerOwner | null = null;
  private workerScope = "";
  private verified: ContinuityIdentity | null = null;
  private generation = 0;
  private closed = false;
  private active = false;
  private accountRevision = 0;
  private finished: Promise<void> = Promise.resolve();
  private checking: { generation: number; retry: boolean; entered: boolean; result: Promise<void> } | null = null;
  private identityKey = "";
  private lastUserId: string | null = null;
  private cancelling: Promise<void> | null = null;
  private content = new CryptoQueue(cryptoConcurrency());
  private readonly serverClock: ServerClock;
  private clockGeneration = 0;
  private clockConnection: string | null = null;
  constructor(private readonly ports: EncryptionPorts) {
    this.serverClock = new ServerClock({ current: () => {
      const connection = ports.connection();
      if (connection !== this.clockConnection) { this.clockConnection = connection; this.clockGeneration++; }
      return connection && this.verified && this.isUnlocked() && ports.consent() && sameIdentity(this.verified, ports.identity()) ?
        { identity: { ...this.verified }, generation: this.clockGeneration } : null;
    }, sample: (sampleId, scope) => ports.sampleTime(scope.identity, sampleId),
    monotonicNow: () => performance.now(), randomId: () => globalThis.crypto.randomUUID() });
  }
  clock(): ServerClock { return this.serverClock; }
  invalidateClock() { this.clockGeneration++; this.serverClock.invalidate(); }
  snapshot() { return structuredClone(this.value); }
  private publish(status: SyncEncryptionState["status"], error: SyncEncryptionError | null = null) {
    if (this.closed) return;
    const available = Boolean(this.ports.identity());
    this.value = { status, error,
      canSetPassword: available && status === "not-configured",
      canUnlock: available && Boolean(this.space) && ["locked", "blocked"].includes(status) &&
        !["sync-space-changed", "legacy-sync-unsupported", "sync-encryption-unsupported"].includes(error ?? ""),
      canCancel: status === "setting-up" || status === "unlocking" || status === "checking",
      canRetry: available && (status === "blocked" || status === "locked" && !this.space) &&
        error !== "sync-space-changed",
    };
    this.ports.changed(this.snapshot());
  }
  private operation(): Operation {
    const identity = this.ports.identity(), generation = this.generation;
    if (!identity || this.closed) throw new CryptoError("sync-locked");
    const current = () => !this.closed && generation === this.generation && sameIdentity(identity, this.ports.identity());
    return { identity, generation, current, guard() { if (!current()) throw new CryptoError("sync-operation-cancelled"); } };
  }
  private async execute(status: SyncEncryptionState["status"], work: (op: Operation) => Promise<void>) {
    if (this.active || this.cancelling) throw new CryptoError("sync-operation-busy");
    const op = this.operation(); this.active = true;
    let finish!: () => void;
    this.finished = new Promise<void>(resolve => { finish = resolve; });
    this.publish(status);
    try { await work(op); op.guard(); }
    catch (error) {
      if (op.current()) {
        const candidate = error instanceof ConvexError && typeof error.data === "string" ? error.data : error instanceof SyncKeyStorageError || error instanceof CryptoError ? error.code :
          error instanceof Error ? error.message : "";
        const known = syncEncryptionErrorSchema.safeParse(candidate);
        const code = known.success ? known.data : candidate === "SYNC_REVIEW_EXPIRED" ? "sync-review-expired" : "sync-connection-failed";
        /* A space that exists plus a password-shaped failure is the unlock screen, not a retry loop:
           an unreadable cache is recovered by re-entering the password, never by reading it again. */
        this.publish(PASSWORD_RECOVERABLE.includes(code) && this.space ? "locked" : "blocked", code);
      }
      throw error;
    } finally { this.active = false; finish(); }
  }
  async accountChanged() {
    const identity = this.ports.identity(), key = identity ? JSON.stringify(identity) : "";
    if (key === this.identityKey) return;
    const revision = ++this.accountRevision;
    this.identityKey = key; this.lastUserId = identity?.userId ?? this.lastUserId;
    const cancelling = this.cancel("account"), generation = this.generation;
    await cancelling;
    await this.finished;
    if (revision === this.accountRevision && generation === this.generation && identity && sameIdentity(identity, this.ports.identity())) await this.check().catch(() => {});
  }
  private async authenticate(op: Operation) {
    const verified = await this.ports.verifyIdentity(op.identity); op.guard();
    if (!sameIdentity(verified, op.identity) || verified.environmentId !== this.ports.config.environmentId ||
      verified.deploymentId !== this.ports.config.deploymentId) throw new CryptoError("sync-space-changed");
    this.verified = verified;
  }
  private async inspectSpace(op: Operation) {
    const space = await this.ports.getSpace(op.identity); op.guard();
    if (space) verifySpace(space);
    const consent = this.ports.consent();
    if (this.ports.hasBinding() && !consent) throw new Error("legacy-sync-unsupported");
    if (consent && (!space || !sameSpace(consent, space)) || this.space && (!space || !sameSpace(this.space, space))) {
      throw new CryptoError("sync-space-changed");
    }
    this.space = space;
  }
  async check(retry = false, entered = false) {
    const requested = this.operation();
    while (this.active || this.cancelling) {
      const checking = this.checking;
      if (!this.cancelling && checking?.generation === requested.generation &&
        (checking.retry || !retry) && (checking.entered || !entered)) {
        await checking.result; requested.guard(); return;
      }
      // Setup entry may need cache access after a storage-free startup lookup.
      await Promise.all([this.finished, this.cancelling]); requested.guard();
    }
    const result = this.execute("checking", async op => {
      await this.inspectSpace(op);
      if (!this.space) { this.publish("not-configured"); return; }
      if (!this.ports.hasBinding() && !entered) { this.publish("locked"); return; }
      await this.authenticate(op);
      const record = await this.ports.store.read(op.identity.userId, { guard: op.current, retry }); op.guard();
      if (!record) { this.publish("locked"); return; }
      if (!sameSpace(record, this.space)) throw new CryptoError("sync-space-changed");
      const previous = { sessionId: record.sessionId, deviceId: record.deviceId, restoreGeneration: record.restoreGeneration };
      const proof = await this.ports.continuity(op.identity, previous); op.guard();
      if (!sameIdentity(proof.current, this.verified) || proof.current.restoreGeneration !== this.verified?.restoreGeneration ||
        JSON.stringify(proof.previous) !== JSON.stringify(previous)) throw new CryptoError("sync-space-changed");
      if (proof.state === "revoked") {
        await this.ports.store.clear(op.identity.userId, op.current); op.guard(); this.publish("locked"); return;
      }
      if (proof.state !== "active" && proof.state !== "expired" && proof.state !== "replaced") { this.publish("locked"); return; }
      await this.importRecord(record, op);
      /* The steady state re-reads its own record: rewriting identical key material would
         cost a keychain round trip and an fsync on every start for nothing. */
      if (record.sessionId !== op.identity.sessionId || record.deviceId !== op.identity.deviceId ||
        record.restoreGeneration !== this.verified!.restoreGeneration || record.phase !== "accepted") {
        await this.ports.store.saveVerified({ ...record, sessionId: op.identity.sessionId, deviceId: op.identity.deviceId,
          restoreGeneration: this.verified!.restoreGeneration, phase: "accepted" }, { guard: op.current, retry });
      }
      op.guard(); this.publish("unlocked");
    });
    const checking = { generation: requested.generation, retry, entered, result };
    this.checking = checking;
    try { await result; requested.guard(); }
    finally { if (this.checking === checking) this.checking = null; }
  }
  private async selectWorker(space: EncryptedConsent, op: Operation) {
    // Each respawn costs a Node thread plus a libsodium init; the same space keeps its live worker.
    const tuple = JSON.stringify(scopeTuple(space.scope));
    if (this.worker && this.workerScope === tuple) { op.guard(); return this.worker; }
    if (this.worker) await this.worker.close(); op.guard();
    this.workerScope = tuple; this.worker = this.ports.createWorker(space.scope); return this.worker;
  }
  private async importRecord(record: SyncKeyRecord, op: Operation) {
    const worker = await this.selectWorker(record, op), rootKey = decodeBase64url(record.rootKey, 32);
    try {
      const result = await worker.run({ kind: "import-local-key", expectedScope: record.scope,
        expectedFingerprint: record.keyPackageFingerprint as KeyPackageFingerprint, keyPackage: decodeBase64url(record.keyPackage, 1, 4096), rootKey });
      op.guard(); if (result.kind !== "unlocked") throw new CryptoError("sync-unlock-failed");
    } finally { rootKey.fill(0); }
  }
  private async saveWorker(space: SpaceDescriptor, phase: SyncKeyRecord["phase"], op: Operation) {
    op.guard();
    const result = await this.worker!.run({ kind: "export-local-key", expectedScope: space.scope,
      expectedFingerprint: space.keyPackageFingerprint as KeyPackageFingerprint });
    if (result.kind !== "exported-local-key") throw new CryptoError("sync-integrity-failed");
    try {
      op.guard();
      const record: SyncKeyRecord = { format: 1, environmentId: this.ports.config.environmentId, deploymentId: this.ports.config.deploymentId,
        installationId: this.ports.installationId, ...op.identity, restoreGeneration: this.verified!.restoreGeneration,
        scope: space.scope, keyPackage: space.keyPackage, keyPackageFingerprint: space.keyPackageFingerprint,
        createOperationId: space.createOperationId, rootKey: encodeBase64url(result.rootKey), phase };
      await this.ports.store.saveVerified(record, { guard: op.current, retry: true }); op.guard();
    } finally { result.rootKey.fill(0); }
  }
  private async unlockSpace(password: string, space: SpaceDescriptor, op: Operation, phase: SyncKeyRecord["phase"] = "accepted") {
    validatePassword(password);
    const worker = await this.selectWorker(space, op);
    const result = await worker.run({ kind: "unlock", password, keyPackage: verifySpace(space), expectedScope: space.scope,
      expectedFingerprint: space.keyPackageFingerprint as KeyPackageFingerprint });
    op.guard(); if (result.kind !== "unlocked") throw new CryptoError("sync-unlock-failed");
    await this.saveWorker(space, phase, op);
  }
  async unlock(password: string) {
    return this.execute("unlocking", async op => {
      await this.inspectSpace(op); if (!this.space) throw new CryptoError("sync-locked");
      await this.authenticate(op); await this.unlockSpace(password, this.space, op); this.publish("unlocked");
    });
  }
  async setup(input: SyncSetupInput) {
    return this.execute("setting-up", async op => {
      this.ports.validateReview(input.reviewId);
      await this.inspectSpace(op); await this.authenticate(op);
      if (this.space) await this.unlockSpace(input.password, this.space, op);
      else {
        validateNewPassword(input.password);
        if (input.confirmation === undefined || !passwordsMatch(input.password, input.confirmation)) throw new Error("sync-password-mismatch");
        if (input.riskAccepted !== true) throw new Error("sync-password-invalid");
        const cached = await this.ports.store.read(op.identity.userId, { guard: op.current, retry: true }); op.guard();
        let candidate: SpaceDescriptor;
        if (cached) {
          if (cached.phase !== "prepared") throw new CryptoError("sync-space-changed");
          candidate = { scope: cached.scope, keyPackage: cached.keyPackage, keyPackageFingerprint: cached.keyPackageFingerprint,
            createOperationId: cached.createOperationId, createdAt: 0 };
          await this.unlockSpace(input.password, candidate, op, "prepared");
        } else {
          const source = { sourceEnvironment: this.ports.config.environmentId, sourceAccountId: op.identity.userId };
          const worker = await this.selectWorker({ scope: { ...source, vaultId: "pending", keyId: "pending" }, keyPackageFingerprint: "" }, op);
          const created = await worker.run({ kind: "create", password: input.password, source }); op.guard();
          if (created.kind !== "created") throw new CryptoError("sync-encryption-unsupported");
          candidate = { scope: created.scope, keyPackage: encodeBase64url(created.keyPackage), keyPackageFingerprint: created.fingerprint,
            createOperationId: parseKeyPackage(created.keyPackage).createOperationId, createdAt: 0 };
          await this.saveWorker(candidate, "prepared", op);
        }
        op.guard(); this.ports.validateReview(input.reviewId);
        const result = await this.ports.createSpace(op.identity, { createOperationId: candidate.createOperationId, keyPackage: candidate.keyPackage });
        op.guard(); verifySpace(result.space); this.space = result.space;
        if (!sameSpace(candidate, result.space)) await this.unlockSpace(input.password, result.space, op);
        else await this.saveWorker(result.space, "accepted", op);
      }
      op.guard(); this.ports.validateReview(input.reviewId);
      this.publish("unlocked");
      await this.ports.approveReview(input.reviewId, this.consent(), op.current, true); op.guard();
    });
  }
  async approve(reviewId: string) {
    const consent = this.consent();
    return this.execute("setting-up", async op => {
      this.ports.validateReview(reviewId);
      this.publish("unlocked");
      await this.ports.approveReview(reviewId, consent, op.current, false); op.guard();
    });
  }
  consent(): EncryptedConsent {
    if (this.value.status !== "unlocked" || !this.space || !this.worker || !this.ports.identity()) throw new CryptoError("sync-locked");
    return { scope: structuredClone(this.space.scope), keyPackageFingerprint: this.space.keyPackageFingerprint };
  }
  hasApprovedSync() { return this.ports.hasBinding() && this.ports.consent() !== null; }
  isUnlocked() {
    const consent = this.ports.consent();
    return this.value.status === "unlocked" && Boolean(this.ports.identity() && this.space && this.worker &&
      (!this.ports.hasBinding() || consent && sameSpace(consent, this.space)));
  }
  contentPort() {
    if (!this.isUnlocked() || !this.ports.consent()) throw new CryptoError("sync-locked");
    const op = this.operation(), consent = this.consent();
    return { ...consent, session: { ...op.identity }, skillSlugKey: (normalizedSlug: string, signal?: AbortSignal) => {
      op.guard();
      return this.content.add(async () => {
        op.guard(); if (!this.isUnlocked() || signal?.aborted) throw new CryptoError("sync-operation-cancelled");
        const result = await this.worker!.run({ kind: "skill-slug-key", expectedScope: consent.scope, normalizedSlug });
        op.guard(); if (signal?.aborted) throw new CryptoError("sync-operation-cancelled");
        if (result.kind !== "skill-slug-key") throw new CryptoError("sync-integrity-failed");
        return result.slugKey;
      }, "background", signal, 128);
    }, run: (command: ContentCommand, signal?: AbortSignal, options?: { priority?: "foreground" | "background" }) => {
      op.guard(); return this.run(command, signal, options);
    } };
  }
  async run(command: ContentCommand, signal?: AbortSignal, options?: { priority?: "foreground" | "background" }): Promise<ContentResult> {
    if (!this.isUnlocked() || !this.ports.consent()) throw new CryptoError("sync-locked");
    if (signal?.aborted) throw new CryptoError("sync-operation-cancelled");
    if (command.kind !== "encrypt" && command.kind !== "decrypt") throw new CryptoError("sync-integrity-failed");
    const op = this.operation(), context = command.kind === "encrypt" ? command.context : command.expectedContext;
    assertExpectedScope(context, this.consent().scope);
    const bytes = command.kind === "encrypt" ? command.plaintext : command.envelope;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > (command.kind === "encrypt" ? PLAINTEXT_LIMITS[context.purpose] : MAX_ENVELOPE_BYTES)) throw new CryptoError("sync-integrity-failed");
    const custody = bytes.byteLength + encodeContext(context).byteLength, priority = options?.priority ?? "foreground";
    // Background callers wait for capacity inside the queue; only foreground work refuses immediately.
    if (priority === "foreground") this.content.assertCapacity(priority, custody);
    /* One copy of the bytes is the custody boundary; the context is validated above and read-only. */
    const captured: ContentCommand = command.kind === "encrypt" ? { ...command, plaintext: new Uint8Array(command.plaintext) } :
      { ...command, envelope: new Uint8Array(command.envelope) };
    try {
      return await this.content.add(async () => {
        op.guard(); if (!this.isUnlocked() || signal?.aborted) throw new CryptoError("sync-operation-cancelled");
        const result = await this.worker!.run(captured);
        try {
          op.guard(); if (signal?.aborted) throw new CryptoError("sync-operation-cancelled");
          if (result.kind !== "encrypted" && result.kind !== "decrypted") throw new CryptoError("sync-integrity-failed");
          return result;
        } catch (error) { if (result.kind === "decrypted") result.plaintext.fill(0); throw error; }
      }, priority, signal, custody);
    } finally { if (captured.kind === "encrypt") captured.plaintext.fill(0); }
  }
  cancel(reason: "user" | "account" | "shutdown" = "user"): Promise<void> {
    /* Leaving the setup form after consent is durable has nothing left to cancel: the binding
       is written and this computer is unlocked, so main — not the renderer snapshot — decides. */
    if (reason === "user" && this.ports.hasBinding() && this.isUnlocked()) return Promise.resolve();
    this.generation++; this.invalidateClock(); this.ports.store.invalidate(); this.verified = null;
    this.content.clear();
    if (reason !== "user") this.space = null;
    if (this.cancelling) return this.cancelling;
    const worker = this.worker; this.worker = null; this.workerScope = "";
    const work = Promise.all([this.ports.stopContent(), worker?.close(), this.content.flush()]).then(() => {
      this.publish("locked");
    });
    this.cancelling = work;
    void work.finally(() => { if (this.cancelling === work) this.cancelling = null; }).catch(() => {});
    return work;
  }
  async clear(userId = this.lastUserId) {
    await this.cancel("account"); if (userId) await this.ports.store.clear(userId);
  }
  async close() { this.closed = true; await this.cancel("shutdown"); this.content.close(); await this.ports.store.drain(); }
}
