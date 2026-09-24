/**
 * [INPUT]: Depends on the account connection identity/epoch, the durable sync binding, the content cipher port, the cloud transport (apply/head/revision and its watch), the Dock config store and ./state transitions.
 * [OUTPUT]: Provides AccountConfigSyncCoordinator (the one main-owned dock-layout synchronizer: admission, generations, debounced/backed-off passes, immutable candidates, merge/conflict handling, sealing, honest status) and the AccountConfigSyncHandle surface.
 * [POS]: cloud/sync/account-config runtime; independent of Dock windows, Library paths and the initial Library run, sharing the one account connection (PRD 4.4, INV-15/16).
 */
import { randomUUID } from "node:crypto";
import { ConvexError } from "convex/values";
import { canonicalJson, protocolHeader, type CloudBuildConfig } from "@ai-chat/cloud-protocol";
import { CryptoError } from "@ai-chat/cloud-protocol/encryption";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { DOCK_LAYOUT_CONFIG_ID, encryptedAccountConfigSchema, type AccountConfigReceipt, type EncryptedAccountConfig } from "@ai-chat/cloud-protocol/account-config/model";
import { openAccountConfig, sealAccountConfig } from "@ai-chat/cloud-protocol/account-config/encrypted";
import { DOCK_LAYOUT_SCHEMA_VERSION, dockLayoutSchema } from "../../../../../shared/system-dock/layout";
import { conflictChoiceSchema, type ConflictChoice, type DockSyncStatus } from "../../../../../shared/system-dock/ipc";
import type { DockCandidate, DockConfigRecord, DockConfigStore } from "../../../system-dock/store/config-store";
import type { AccountTransport } from "../../runtime/transport";
import type { CloudAccountService } from "../../runtime/service";
import type { SyncBindingStore } from "../account/binding";
import { ChangeNotifier } from "../../runtime/notifier";
import { accountConfigScopeKey } from "./cleanup";
import { captureCandidate, conflictList, enterScope, integrate, resolveConflict, sealScope, settleApplied, surfaceRace, uploadable, type RemoteView } from "./state";

const TARGET = { configKind: "dock-layout", configId: DOCK_LAYOUT_CONFIG_ID } as const;
const MAX_RACES = 3;
/* Terminal account states: the account really left, so the scope is sealed. A connecting or offline account is not. */
const SIGNED_OUT = new Set(["signed-out", "signing-out", "revoked", "deleted", "deleting"]);
/* Codes after which the frozen candidate can never succeed; anything else keeps the exact bytes for a resend. */
const DEAD_CANDIDATE = new Set(["operation-payload-mismatch", "sync-space-changed"]);
const TRANSIENT_CRYPTO = new Set(["sync-locked", "sync-operation-cancelled", "sync-operation-busy"]);
class Superseded extends Error { constructor() { super("account-config-superseded"); } }
/* Thrown inside a store mutation to roll it back when the transition changed nothing, so re-evaluation never rewrites the file. */
class Unchanged extends Error {}

export type AccountConfigPorts = {
  config: CloudBuildConfig; deviceId: string;
  binding: Pick<SyncBindingStore, "snapshot">;
  account: Pick<CloudAccountService, "connectionIdentity" | "remoteConnection" | "subscribeIdentity" | "subscribeConnection" | "subscribe">;
  transport: Pick<AccountTransport, "query" | "mutate" | "watchAccountConfig">;
  /** Throws `sync-locked` while the content key is unavailable; then no network is attempted and pending stays. */
  crypto(): FileCipherPort;
  store: DockConfigStore;
  /** The account scope's activity fence: cleanup, sign-out and pause close it before touching account-scoped state. */
  own?(activity: { close(): Promise<void> }): () => void;
  /** Resolves once cleanups that ran before the store attached have been applied. */
  ready?: Promise<unknown>;
  timing?: { debounceMs?: number; pollMs?: number; maxBackoffMs?: number };
  now?(): number;
  operationId?(): string;
};
type Admitted = { kind: "admitted"; key: string; scopeKey: string; crypto: FileCipherPort; header: ReturnType<typeof protocolHeader> & { expectedUserId: string;
  encryptedSpace: { scope: FileCipherPort["scope"]; keyPackageFingerprint: string } } };
type Admission = Admitted | { kind: "local-only"; signedOut: boolean } | { kind: "offline" } | { kind: "blocked" };
export type AccountConfigSyncHandle = {
  status(): DockSyncStatus;
  onChanged(listener: (status: DockSyncStatus) => void): () => void;
  resolveConflict(choice: ConflictChoice): Promise<DockSyncStatus>;
  wake(): void;
  close(): Promise<void>;
};

export class AccountConfigSyncCoordinator implements AccountConfigSyncHandle {
  private readonly listeners = new ChangeNotifier<DockSyncStatus>();
  private readonly releases: (() => void)[] = [];
  private readonly timing: Required<NonNullable<AccountConfigPorts["timing"]>>;
  private readonly now: () => number;
  private readonly poll: ReturnType<typeof setInterval>;
  private generation = 0;
  private selectedKey = "";
  private scoped: (() => void) | null = null;
  private watching: (() => void) | null = null;
  private header: Admitted["header"] | null = null;
  /** Latest server revision seen in this generation (watch, poll or receipt); null means unknown. */
  private remoteRevision: number | null = null;
  /** Set only after the server answered in this generation, so "synced" is never claimed from local state alone. */
  private confirmed = false;
  private error: string | null = null;
  /** The account scope refused this generation (cleanup, sign-out or content lock in progress). */
  private fenced = false;
  private failures = 0;
  private backoffUntil = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private timerAt = Infinity;
  private timerDebounced = false;
  private flight: Promise<void> | null = null;
  private again: { at: number; debounced: boolean } | null = null;
  private statusKey = "";
  private closed = false;
  constructor(private readonly ports: AccountConfigPorts) {
    this.timing = { debounceMs: 1_000, pollMs: 60_000, maxBackoffMs: 300_000, ...ports.timing };
    this.now = ports.now ?? Date.now;
    const changed = () => { this.reconcile(); this.schedule(0); };
    this.releases.push(ports.account.subscribeIdentity(changed), ports.account.subscribeConnection(changed), ports.account.subscribe(changed),
      ports.store.onChanged(change => { if (change.origin === "local") this.schedule(this.timing.debounceMs, true); this.publish(); }));
    // A missed watch notification, a lost socket or a lock/unlock without an account event is caught here.
    this.poll = setInterval(() => { if (!this.watching) { this.remoteRevision = null; this.watch(); } this.reconcile(); this.schedule(0); }, this.timing.pollMs);
    this.poll.unref?.();
    this.schedule(0);
  }

  /* ─────────────────────────────── admission (PRD 4.4) */

  private admission(): Admission {
    const { account, binding: bindings, config, deviceId } = this.ports;
    const identity = account.connectionIdentity();
    if (!identity.profile) return { kind: "local-only", signedOut: SIGNED_OUT.has(identity.status) };
    if (identity.status !== "ready") return ["temporarily-offline", "connecting", "signing-in"].includes(identity.status) ? { kind: "offline" } : { kind: "blocked" };
    const epoch = account.remoteConnection();
    if (!epoch) return { kind: "offline" };
    const binding = bindings.snapshot();
    // Initializing and active are both admitted (a refused first Library upload parks in initializing); closing and anything unknown are not.
    if (!binding || !(binding.phase === "initializing" || binding.phase === "active") || binding.paused) return { kind: "blocked" };
    if (identity.profile.userId !== binding.userId || identity.deviceId !== deviceId || binding.deviceId !== deviceId) return { kind: "blocked" };
    let crypto: FileCipherPort;
    try { crypto = this.ports.crypto(); } catch { return { kind: "blocked" }; }
    if (crypto.session.userId !== binding.userId || crypto.session.deviceId !== deviceId) return { kind: "blocked" };
    if (binding.encryption && (canonicalJson(binding.encryption.scope) !== canonicalJson(crypto.scope) ||
      binding.encryption.keyPackageFingerprint !== crypto.keyPackageFingerprint)) return { kind: "blocked" };
    const scopeKey = accountConfigScopeKey(config.environmentId, binding.userId, binding.manifestId);
    const encryptedSpace = { scope: crypto.scope, keyPackageFingerprint: crypto.keyPackageFingerprint };
    return { kind: "admitted", scopeKey, crypto, key: canonicalJson([scopeKey, epoch, crypto.session, encryptedSpace]),
      header: { ...protocolHeader(config), expectedUserId: binding.userId, encryptedSpace } };
  }
  /** Stops a generation whose identity moved; seals the scope when the account signed out. Synchronous except the seal write. */
  private reconcile(): Admission {
    const admission = this.admission();
    if (admission.kind !== "admitted") this.fenced = false;
    if (admission.kind !== "admitted" || admission.key !== this.selectedKey) this.stop();
    if (admission.kind === "local-only" && admission.signedOut && this.ports.store.snapshot().sync.scopeKey) void this.seal();
    return admission;
  }
  private async seal() {
    await this.ports.ready;
    await this.ports.store.updateSync(record => {
      const admission = this.admission();
      if (admission.kind === "local-only" && admission.signedOut) sealScope(record, this.now());
    }).catch(error => this.report(error));
  }
  private stop() {
    if (!this.selectedKey && !this.scoped && !this.watching) return;
    this.generation++; this.selectedKey = ""; this.header = null; this.remoteRevision = null; this.confirmed = false; this.error = null;
    this.failures = 0; this.backoffUntil = 0;
    const scoped = this.scoped, watching = this.watching; this.scoped = null; this.watching = null;
    scoped?.(); watching?.();
  }
  /** Opens a generation: the account scope owns it, and the revision watch feeds it until the identity moves. */
  private start(admission: Admitted) {
    this.stop();
    const generation = ++this.generation;
    try { this.scoped = this.ports.own?.({ close: async () => { if (this.generation === generation) this.stop(); } }) ?? null; }
    catch { this.fenced = true; return false; }
    this.fenced = false; this.selectedKey = admission.key; this.header = admission.header;
    this.watch();
    return true;
  }
  /** The socket may not exist yet; the poll retries the subscription and reads the revision until it does. */
  private watch() {
    const generation = this.generation, header = this.header;
    if (this.watching || !header || !this.selectedKey) return;
    try {
      this.watching = this.ports.transport.watchAccountConfig?.({ ...header, ...TARGET }, value => {
        if (this.generation !== generation || value.revision === this.remoteRevision) return;
        this.remoteRevision = this.newest(value.revision); this.schedule(0);
      }, error => { if (this.generation === generation) { this.watching?.(); this.watching = null; this.remoteRevision = null; this.report(error); } }) ?? null;
    } catch { this.watching = null; }
  }

  /* ─────────────────────────────── scheduling */

  /** Edits are debounced (each edit pushes the pass back); everything else runs as soon as backoff allows. */
  private schedule(delay: number, debounced = false) {
    if (this.closed) return;
    const at = Math.max(this.now() + delay, this.backoffUntil);
    if (this.flight) {
      if (!this.again || (debounced ? this.again.debounced : at < this.again.at)) this.again = { at, debounced };
      return;
    }
    if (this.timer && (debounced ? !this.timerDebounced && this.timerAt <= at : this.timerAt <= at)) return;
    if (this.timer) clearTimeout(this.timer);
    this.timerAt = at; this.timerDebounced = debounced;
    this.timer = setTimeout(() => { this.timer = null; this.timerAt = Infinity; this.run(); }, Math.max(0, at - this.now()));
    this.timer.unref?.();
  }
  private run() {
    if (this.closed || this.flight) return;
    this.again = null;
    this.flight = this.pass().then(() => { this.failures = 0; this.backoffUntil = 0; }, error => this.fail(error)).finally(() => {
      this.flight = null; this.publish();
      const again = this.again; this.again = null;
      if (again && !this.closed) this.schedule(Math.max(0, again.at - this.now()), again.debounced);
    });
  }
  private fail(error: unknown) {
    if (error instanceof Superseded) { this.schedule(0); return; }
    if (error instanceof CryptoError && TRANSIENT_CRYPTO.has(error.code)) return; // The next unlock/account event wakes us.
    this.failures++;
    this.backoffUntil = this.now() + Math.min(this.timing.maxBackoffMs, 1_000 * 2 ** Math.min(this.failures - 1, 16));
    this.report(error);
    this.schedule(0);
  }
  /* A ConvexError is a server decision the user may need to see; transport failures only mean "not yet". */
  private report(error: unknown) {
    if (error instanceof ConvexError) this.error = String(error.data);
    else if (error instanceof Error && error.message === "account-config-budget") this.error = error.message;
    if (process.env.BOTTEGA_SYNC_DIAGNOSTICS === "1") console.warn("[account-config]", error instanceof Error ? error.message : "unclassified");
  }

  /* ─────────────────────────────── the pass */

  private async pass() {
    await this.ports.ready;
    const admission = this.reconcile();
    if (admission.kind !== "admitted") return;
    if (admission.key !== this.selectedKey && !this.start(admission)) return;
    const generation = this.generation, scopeKey = admission.scopeKey;
    const current = () => { if (this.closed || this.generation !== generation || this.admission().kind !== "admitted" || this.selectedKey !== admission.key) throw new Superseded(); };
    const write = (change: (record: DockConfigRecord) => void) => { current(); return this.ports.store.updateSync(record => {
      // A cleanup participant or a newer generation may have moved the scope while this write waited in the queue.
      current(); if (record.sync.scopeKey !== scopeKey) throw new Superseded(); change(record);
    }); };
    current();
    if (this.ports.store.snapshot().sync.scopeKey !== scopeKey) {
      await this.ports.store.updateSync(record => { current(); enterScope(record, scopeKey, this.now()); });
    }
    let races = 0;
    for (;;) {
      let record = this.ports.store.snapshot();
      const candidate = record.sync.candidate;
      if (candidate) {
        const receipt = await this.send(candidate, admission, write, current);
        if (!receipt) continue;
        if (receipt.status === "applied") {
          await write(next => { if (next.sync.candidate?.operationId === candidate.operationId) settleApplied(next, candidate, receipt.head!.revision); });
          this.remoteRevision = Math.max(this.remoteRevision ?? 0, receipt.head!.revision); this.confirmed = true; this.error = null;
          continue;
        }
        const remote = await this.view(receipt.head, admission.crypto); current();
        this.remoteRevision = this.newest(remote.revision);
        const lost = ++races > MAX_RACES;
        await write(next => { if (next.sync.candidate?.operationId !== candidate.operationId) return; next.sync.candidate = null; next.sync.pending = true;
          if (lost) surfaceRace(next, remote, this.now()); else integrate(next, remote, this.now()); });
        this.confirmed = true;
        if (lost) return;
        continue;
      }
      if (this.remoteRevision === null) {
        const value = await this.ports.transport.query("accountConfig/sync:revision", { ...admission.header, ...TARGET }); current();
        this.remoteRevision = this.newest(value.revision);
      }
      record = this.ports.store.snapshot();
      const sync = record.sync, revision = this.remoteRevision;
      const known = sync.unsupportedRemote?.revision === revision;
      const reevaluate = !known && (revision !== sync.acknowledgedRevision || (sync.conflict !== null && sync.conflict.kind !== "unsupported"));
      if (reevaluate) {
        const remote: RemoteView = sync.conflict?.remote && sync.conflict.remoteRevision === revision
          ? { kind: "layout", revision, layout: sync.conflict.remote }
          : await this.read(admission, current);
        this.remoteRevision = this.newest(remote.revision);
        await write(next => { const before = JSON.stringify(next); integrate(next, remote, this.now()); if (JSON.stringify(next) === before) throw new Unchanged(); })
          .catch(error => { if (!(error instanceof Unchanged)) throw error; });
        // The subscription already announced a newer head than this read returned: read again, never settle on the older one.
        if ((this.remoteRevision ?? 0) > remote.revision) continue;
      }
      this.confirmed = true; this.error = null;
      record = this.ports.store.snapshot();
      if (!uploadable(record, scopeKey)) return;
      await this.capture(record, admission, write, current);
    }
  }
  /** Server revisions only grow under CAS; a slower response must never move the known head backwards. */
  private newest(revision: number) { return Math.max(this.remoteRevision ?? 0, revision); }
  private async read(admission: Admitted, current: () => void): Promise<RemoteView> {
    const head = await this.ports.transport.query("accountConfig/sync:head", { ...admission.header, ...TARGET }); current();
    const view = await this.view(head, admission.crypto); current();
    return view;
  }
  /** Unknown schema, a record this key cannot open or a layout that fails validation is kept verbatim, never interpreted. */
  private async view(head: EncryptedAccountConfig | null, crypto: FileCipherPort): Promise<RemoteView> {
    if (!head) return { kind: "absent", revision: 0 };
    const unsupported = (): RemoteView => ({ kind: "unsupported", revision: head.revision, bytes: JSON.stringify(head) });
    if (head.configSchemaVersion !== DOCK_LAYOUT_SCHEMA_VERSION) return unsupported();
    try {
      const parsed = dockLayoutSchema.safeParse(await openAccountConfig(head, TARGET, crypto));
      return parsed.success ? { kind: "layout", revision: head.revision, layout: parsed.data } : unsupported();
    } catch (error) {
      if (error instanceof CryptoError && TRANSIENT_CRYPTO.has(error.code)) throw error;
      return unsupported();
    }
  }
  /** Seals the exact snapshot and persists the candidate before any byte leaves the machine. */
  private async capture(record: DockConfigRecord, admission: Admitted, write: (change: (record: DockConfigRecord) => void) => Promise<DockConfigRecord>, current: () => void) {
    const snapshot = structuredClone(record.layout), localRevision = record.localRevision, expected = record.sync.acknowledgedRevision;
    const sealed = await sealAccountConfig({ ...TARGET, configSchemaVersion: DOCK_LAYOUT_SCHEMA_VERSION, revision: expected + 1,
      operationId: (this.ports.operationId ?? randomUUID)() }, snapshot, admission.crypto);
    current();
    await write(next => {
      if (next.sync.candidate || next.sync.acknowledgedRevision !== expected || !uploadable(next, admission.scopeKey)) throw new Superseded();
      captureCandidate(next, sealed, snapshot, localRevision);
    });
  }
  /**
   * Sends the frozen bytes. An unknown outcome keeps the same operation and bytes for the next attempt, where the
   * server's original receipt answers it; nothing is ever re-encrypted under an old operation ID (INV-15).
   */
  private async send(candidate: DockCandidate, admission: Admitted, write: (change: (record: DockConfigRecord) => void) => Promise<DockConfigRecord>, current: () => void): Promise<AccountConfigReceipt | null> {
    const drop = () => write(next => { if (next.sync.candidate?.operationId === candidate.operationId) { next.sync.candidate = null; next.sync.pending = true; } });
    let record: EncryptedAccountConfig | null = null;
    try { record = candidate.ciphertext ? encryptedAccountConfigSchema.parse(JSON.parse(candidate.ciphertext)) : null; } catch { record = null; }
    // Bytes sealed under another space can never be accepted here; a new candidate gets a new operation ID.
    if (!record || record.operationId !== candidate.operationId || canonicalJson(record.encryptedSpace) !== canonicalJson(admission.header.encryptedSpace)) { await drop(); return null; }
    if (candidate.state === "prepared") await write(next => { if (next.sync.candidate?.operationId === candidate.operationId) next.sync.candidate.state = "sent"; });
    let receipt: AccountConfigReceipt;
    try { receipt = await this.ports.transport.mutate("accountConfig/sync:apply", { ...admission.header, record }); }
    catch (error) {
      if (error instanceof ConvexError && DEAD_CANDIDATE.has(String(error.data))) await drop().catch(() => undefined);
      else await this.ports.store.updateSync(next => { if (next.sync.candidate?.operationId === candidate.operationId) next.sync.candidate.state = "unknown"; }).catch(() => undefined);
      throw error;
    }
    current();
    if (receipt.operationId !== candidate.operationId || receipt.ciphertextHash !== record.packet.ciphertextHash) throw new Error("account-config-receipt-mismatch");
    return receipt;
  }

  /* ─────────────────────────────── surface */

  status(): DockSyncStatus {
    const record = this.ports.store.snapshot(), admission = this.admission();
    if (record.sync.conflict) return { state: "conflict", conflict: { kind: record.sync.conflict.kind, conflicts: conflictList(record) } };
    if (admission.kind === "local-only") return { state: "local-only", conflict: null };
    if (admission.kind === "offline" || admission.kind === "blocked") return { state: admission.kind, conflict: null };
    if (this.fenced) return { state: "blocked", conflict: null };
    if (this.error) return { state: "error", conflict: null };
    const settled = this.confirmed && record.sync.scopeKey === admission.scopeKey && !record.sync.pending && !record.sync.candidate;
    return { state: settled ? "synced" : "pending", conflict: null };
  }
  onChanged(listener: (status: DockSyncStatus) => void) { return this.listeners.subscribe(listener); }
  private publish() {
    if (this.closed) return;
    const status = this.status(), key = JSON.stringify(status);
    if (key === this.statusKey) return;
    this.statusKey = key; this.listeners.notify(status);
  }
  async resolveConflict(choice: ConflictChoice) {
    const parsed = conflictChoiceSchema.parse(choice);
    await this.ports.ready;
    await this.ports.store.updateSync(record => resolveConflict(record, parsed));
    this.error = null; this.schedule(0);
    return this.status();
  }
  wake() { this.reconcile(); this.schedule(0); }
  /** Resolves once no pass is running or due now; test and shutdown seam. */
  async idle() {
    while (!this.closed && (this.flight || (this.timer && this.timerAt <= this.now()))) await (this.flight ?? new Promise(resolve => setTimeout(resolve, 1)));
  }
  async close() {
    if (this.closed) return;
    this.closed = true; this.stop(); clearInterval(this.poll);
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    for (const release of this.releases.splice(0)) release();
    await this.flight?.catch(() => undefined);
    this.listeners.clear();
  }
}
