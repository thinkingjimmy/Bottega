/**
 * [INPUT]: Depends on BaseStore's durable synchronization API and authenticated, account-scoped cloud transport.
 * [OUTPUT]: Provides deletion/export-fenced upload, original-candidate recovery and subscriptions held only for on-screen or still-unsent Bases, following the confirmed Base owner.
 * [POS]: Main-only Base adapter; BaseStore owns every local mutation, candidate, pending operation and cursor.
 */
import { BaseSnapshotReader, canonicalJson, protocolHeader,
  type CloudBuildConfig, type CloudFunctionArgs } from "@ai-chat/cloud-protocol";
import { createEncryptedBaseReader, openEncryptedBaseReceipt, prepareEncryptedBaseCommit, assertBaseResolution,
  type BaseCipherPort, type BaseCipherFiles } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import type { SyncScope } from "../../../../../shared/local-storage/contracts";
import type { BaseStore } from "../../../bases/base-store";
import { nativeBaseOperation, candidatePatchIndexes, type PendingBaseOperation } from "../../../bases/store/sync/model";
import type { AccountTransport } from "../../runtime/transport";
import { DesktopBaseCandidates } from "./candidates";
type Target = { ownerKey: string; baseId: string };
type Transport = Pick<AccountTransport, "query" | "mutate"> & {
  watchBase?(args: CloudFunctionArgs<"bases/api:readSnapshot">, changed: () => void, failed: (error: unknown) => void): () => void;
};
type Ports = { store: BaseStore; transport: Transport; config: CloudBuildConfig; scope: SyncScope;
  crypto(): BaseCipherPort;
  files?: { codec(target: Target, operation?: PendingBaseOperation): BaseCipherFiles; admit(target: Target, replace?: boolean): Promise<void> };
  changed(target: Target): void; failure(target: Target, error: unknown): void };
export class DesktopBaseSync {
  private generation = 0;
  private closed = false;
  private retired = new Set<string>();
  private flights = new Map<string, Promise<void>>();
  private dirty = new Set<string>();
  private watches = new Map<string, () => void>();
  private watchedOwners = new Map<string, string>();
  private readers = new Map<string, { ownerKey: string; reader: BaseSnapshotReader }>();
  private readonly header;
  private readonly candidates: DesktopBaseCandidates;
  constructor(private readonly ports: Ports) {
    if (ports.scope.environment !== ports.config.environmentId) throw new Error("environment-mismatch");
    this.header = { ...protocolHeader(ports.config), expectedUserId: ports.scope.userId };
    this.candidates = new DesktopBaseCandidates(ports);
  }
  private requestHeader() {
    const port = this.ports.crypto();
    if (port.session.userId !== this.ports.scope.userId) throw new Error("account-scope-changed");
    return { ...this.header, encryptedSpace: { scope: port.scope, keyPackageFingerprint: port.keyPackageFingerprint } };
  }
  /* Every watch is two live Convex subscriptions re-evaluated on every write in the space, so only a Base the
     user is looking at or one with unsent local work keeps one; the rest ride the catalog sweep's revisions. */
  observe(target: Target) {
    if (this.watchedOwners.get(target.baseId) !== target.ownerKey) this.forget(target.baseId, false);
    if (!this.active(target)) return;
    if (!this.live(target)) { if (this.watches.has(target.baseId)) this.forget(target.baseId, false); return; }
    if (this.watches.has(target.baseId)) return;
    this.watchedOwners.set(target.baseId, target.ownerKey);
    const unsubscribe = this.ports.transport.watchBase?.({ ...this.requestHeader(), baseId: target.baseId, operationIds: [] },
      () => { void this.flush(target); }, error => { if (this.active(target)) this.ports.failure(target, error); });
    if (unsubscribe) this.watches.set(target.baseId, unsubscribe);
    void this.flush(target);
  }
  flush(target: Target): Promise<void> {
    if (!this.active(target)) {
      if (this.watchedOwners.get(target.baseId) === target.ownerKey) this.forget(target.baseId, false);
      return Promise.resolve();
    }
    this.dirty.add(target.baseId);
    const existing = this.flights.get(target.baseId); if (existing) return existing;
    const generation = this.generation, current = () => generation === this.generation && this.active(target);
    const flight = (async () => {
      let sent = 0;
      while (current() && this.dirty.delete(target.baseId)) {
        await this.reconcile(target, current); if (!current()) return;
        if (await this.candidates.pull(target, current)) { sent++; this.dirty.add(target.baseId); }
        if (!current()) return;
        const envelope = this.ports.store.sync.read(target.ownerKey, target.baseId);
        if (sent >= 64) { setTimeout(() => { void this.flush(target); }, 0).unref(); continue; }
        const discarded = envelope.conflictCandidates.find(candidate => candidate.state === "discarded" && candidate.receipt && !candidate.remoteResolved);
        if (discarded) {
          await this.ports.transport.mutate("bases/conflicts:resolveOperation", { ...this.requestHeader(), baseId: target.baseId,
            sourceOperationId: discarded.operation.operationId, action: "discard", commit: null });
          if (!current()) return;
          await this.ports.store.sync.acknowledgeDiscard(target.ownerKey, target.baseId, this.ports.scope, discarded.operation.operationId);
          sent++; if (current()) this.ports.changed(target); this.dirty.add(target.baseId); continue;
        }
        const operation = envelope.pendingOperations.find(operation => operation.state === "queued" &&
          operation.dependsOnOperationIds.every(id => envelope.receipts.some(receipt => receipt.operationId === id && receipt.results.every(item => ["applied", "converged"].includes(item.status)))));
        if (!operation) continue;
        const sealed = await this.ports.store.sync.seal(target.ownerKey, target.baseId, this.ports.scope, operation.operationId);
        if (!current()) return;
        const source = envelope.conflictCandidates.find(candidate => candidate.receipt && candidate.resolutionOperationId === sealed.operationId);
        const native = nativeBaseOperation(sealed);
        if (source) assertBaseResolution(nativeBaseOperation(source.operation), candidatePatchIndexes(source), native);
        let frozen = sealed.encryptedTransport;
        const files = this.ports.files?.codec(target, sealed), crypto = this.ports.crypto();
        if (!frozen) {
          if (!sealed.encryptionCapture) throw new Error("BASE_ENCRYPTION_CAPTURE_REQUIRED");
          const prepared = await prepareEncryptedBaseCommit(crypto, native, sealed.encryptionCapture, files);
          if (!current()) return;
          frozen = await this.ports.store.sync.freezeTransport(target.ownerKey, target.baseId, this.ports.scope, prepared);
        }
        if (!current()) return;
        const result = source ? await this.ports.transport.mutate("bases/conflicts:resolveOperation", { ...this.requestHeader(), baseId: target.baseId,
          sourceOperationId: source.operation.operationId, action: "apply", commit: frozen.commit }) :
          await this.ports.transport.mutate("bases/api:applyOperations", { ...this.requestHeader(), commit: frozen.commit });
        if (!result) throw new Error("BASE_RECEIPT_UNAVAILABLE");
        const receipt = await openEncryptedBaseReceipt(crypto, { baseId: target.baseId, operationId: frozen.commit.operationId }, result, frozen, files);
        if (receipt.operationId !== sealed.operationId || receipt.payloadHash !== sealed.payloadHash) throw new Error("BASE_RECEIPT_IDENTITY_MISMATCH");
        sent++; this.dirty.add(target.baseId);
      }
    })().catch(error => { if (current()) this.ports.failure(target, error); });
    this.flights.set(target.baseId, flight);
    void flight.finally(() => { if (this.flights.get(target.baseId) === flight) this.flights.delete(target.baseId); });
    return flight;
  }
  private live(target: Target) {
    if (this.ports.store.surfaced(target.ownerKey, target.baseId)) return true;
    const envelope = this.ports.store.sync.read(target.ownerKey, target.baseId);
    // A discarded candidate still owes the server its resolution, exactly as `flush` sends it.
    return envelope.pendingOperations.length > 0 ||
      envelope.conflictCandidates.some(candidate => candidate.state === "discarded" && candidate.receipt && !candidate.remoteResolved);
  }
  private active(target: Target) {
    if (this.closed || this.retired.has(target.baseId)) return false;
    try {
      const state = this.ports.store.sync.read(target.ownerKey, target.baseId);
      return state.scope?.environment === this.ports.scope.environment && state.scope.userId === this.ports.scope.userId &&
        !state.tombstones.includes("base") && !state.promotionExport;
    } catch { return false; }
  }
  forget(baseId: string, permanent = true) {
    if (permanent) this.retired.add(baseId);
    this.dirty.delete(baseId); this.watchedOwners.delete(baseId);
    this.watches.get(baseId)?.(); this.watches.delete(baseId);
    this.readers.get(baseId)?.reader.clear(); this.readers.delete(baseId);
    this.candidates.clear(baseId);
  }
  private async reconcile(target: Target, current: () => boolean) {
    const envelope = this.ports.store.sync.read(target.ownerKey, target.baseId);
    if (!envelope.scope || envelope.scope.environment !== this.ports.scope.environment || envelope.scope.userId !== this.ports.scope.userId) throw new Error("BASE_SYNC_SCOPE_UNAVAILABLE");
    const operationIds = envelope.pendingOperations.filter(operation => operation.sealed).map(operation => operation.operationId);
    if (operationIds.length > 64) throw new Error("BASE_RECEIPT_QUERY_LIMIT");
    const cached = this.readers.get(target.baseId);
    let reader = cached?.ownerKey === target.ownerKey ? cached.reader : undefined;
    if (cached && !reader) cached.reader.clear();
    if (!reader) {
      reader = createEncryptedBaseReader({ transport: this.ports.transport, crypto: this.ports.crypto, files: this.ports.files?.codec(target),
        pair: id => this.ports.store.sync.read(target.ownerKey, target.baseId).pendingOperations.find(item => item.operationId === id)?.encryptedTransport }, this.header, target.baseId);
      this.readers.set(target.baseId, { ownerKey: target.ownerKey, reader });
    }
    const snapshot = await reader.read(operationIds);
    if (!current()) return;
    const { baseId, receipts, tombstones, ...confirmed } = snapshot;
    if (baseId !== target.baseId) throw new Error("BASE_IDENTITY_CONFLICT");
    const before = this.ports.store.sync.read(target.ownerKey, target.baseId);
    if (before.confirmed && confirmed.cloudRevision < before.confirmed.cloudRevision) return;
    if (canonicalJson(confirmed) === canonicalJson(before.confirmed) && tombstones.every(value => before.tombstones.includes(value)) &&
      receipts.every(receipt => before.receipts.some(previous => canonicalJson(previous) === canonicalJson(receipt)))) return;
    await this.ports.store.sync.reconcile(target.ownerKey, target.baseId, this.ports.scope, confirmed, receipts, tombstones, String(confirmed.cloudRevision));
    if (current()) await this.ports.files?.admit(target);
    if (current()) this.ports.changed(target);
  }
  async close() {
    this.closed = true; this.generation++; for (const unsubscribe of this.watches.values()) unsubscribe(); this.watches.clear(); this.dirty.clear();
    for (const { reader } of this.readers.values()) reader.clear(); this.readers.clear();
    this.candidates.clear();
    await Promise.all(this.flights.values());
  }
}
