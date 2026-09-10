/**
 * [INPUT]: Depends on BaseStore's queue/commit port and the causal envelope kernel.
 * [OUTPUT]: Provides explicit baseline admission, receipt reconciliation, sealed retry and conflict recovery.
 * [POS]: A facade over BaseStore's existing writer; all state becomes visible through the same snapshot path.
 */
import type { SerialQueue } from "../../../persistence/serial-queue";
import type { BaseSnapshot } from "../../../../../shared/bases-ipc";
import { canonicalJson, sameScope, storageModeSchema, type StorageMode, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { StoredBase } from "../../base-store-model";
import { baseSyncEnvelopeSchema, confirmedBaseSchema, type BaseOperationReceipt, type BaseSyncEnvelope, type ConfirmedBase } from "./model";
import { projectBase } from "./projection";
import { reconcileBase, restoreBaseCandidate, sealBaseOperation } from "./queue";

type SyncPorts = {
  queue: SerialQueue;
  state(ownerKey: string, ownerInstanceId: string): StoredBase;
  commit(ownerKey: string, ownerInstanceId: string, envelope: BaseSyncEnvelope, snapshot?: BaseSnapshot): Promise<BaseSnapshot>;
};
export class BaseSyncApi {
  private readonly mode: StorageMode;
  constructor(private ports: SyncPorts, mode: StorageMode = { kind: "local-only" }) { this.mode = storageModeSchema.parse(mode); if (mode.kind === "fixture" && process.versions.electron) throw new Error("FIXTURE_MODE_UNAVAILABLE"); }
  read(ownerKey: string, ownerInstanceId: string) { return structuredClone(this.ports.state(ownerKey, ownerInstanceId).sync); }
  private scoped(ownerKey: string, ownerInstanceId: string, scope: SyncScope) {
    this.assertMode(scope);
    const state = this.ports.state(ownerKey, ownerInstanceId);
    if (!state.sync.scope || !sameScope(scope, state.sync.scope)) throw new Error("BASE_SYNC_SCOPE_UNAVAILABLE");
    return state;
  }
  private assertMode(scope: SyncScope) {
    if (this.mode.kind === "local-only" || !sameScope(this.mode.scope, scope)) throw new Error("BASE_SYNC_MODE_UNAVAILABLE");
  }
  enable(ownerKey: string, ownerInstanceId: string, scope: SyncScope, input: ConfirmedBase, cloudState: "synced" | "mirror" = "synced") {
    return this.ports.queue.enqueue(async () => {
      this.assertMode(scope);
      const state = this.ports.state(ownerKey, ownerInstanceId);
      const confirmed = confirmedBaseSchema.parse(input);
      if (confirmed.meta.ownerInstanceId !== ownerInstanceId) throw new Error("BASE_IDENTITY_CONFLICT");
      if (state.sync.scope && !sameScope(state.sync.scope, scope)) throw new Error("BASE_SYNC_SCOPE_CONFLICT");
      if (state.sync.cloudState !== "local-only") {
        if (JSON.stringify(state.sync.confirmed) !== JSON.stringify(confirmed)) throw new Error("BASE_BASELINE_ALREADY_INSTALLED");
        if (state.sync.cloudState === "mirror" && cloudState === "synced") return this.ports.commit(ownerKey, ownerInstanceId,
          baseSyncEnvelopeSchema.parse({ ...state.sync, cloudState: "synced" }));
        return { meta: state.meta, rows: state.rows };
      }
      if (canonicalJson(confirmed.rows) !== canonicalJson(state.rows) || canonicalJson(confirmed.meta) !== canonicalJson(state.meta)) {
        throw new Error("BASE_INITIAL_SNAPSHOT_CONFLICT");
      }
      const envelope = baseSyncEnvelopeSchema.parse({ ...state.sync, cloudState, scope, confirmed });
      return this.ports.commit(ownerKey, ownerInstanceId, envelope, projectBase(envelope));
    });
  }
  seal(ownerKey: string, ownerInstanceId: string, scope: SyncScope, operationId: string) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      const envelope = sealBaseOperation(state.sync, operationId);
      await this.ports.commit(ownerKey, ownerInstanceId, envelope);
      return structuredClone(envelope.pendingOperations.find(item => item.operationId === operationId)!);
    });
  }
  reconcile(ownerKey: string, ownerInstanceId: string, scope: SyncScope, confirmed: ConfirmedBase, receipts: BaseOperationReceipt[], tombstones: string[], cursor: string) {
    return this.ports.queue.enqueue(() => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      const envelope = reconcileBase(state.sync, confirmedBaseSchema.parse(confirmed), receipts, tombstones, cursor);
      return this.ports.commit(ownerKey, ownerInstanceId, envelope, projectBase(envelope));
    });
  }
  resolve(ownerKey: string, ownerInstanceId: string, scope: SyncScope, candidateOperationId: string, action: { kind: "discard" } | { kind: "restore"; operationId: string }) {
    return this.ports.queue.enqueue(() => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      if (action.kind === "restore") {
        const result = restoreBaseCandidate(state, candidateOperationId, action.operationId);
        return this.ports.commit(ownerKey, ownerInstanceId, result.envelope, result.projected);
      }
      const envelope = structuredClone(state.sync);
      const candidate = envelope.conflictCandidates.find(item => item.operation.operationId === candidateOperationId);
      if (!candidate || candidate.state !== "unresolved" || candidate.resolutionOperationId) throw new Error("Base candidate is unavailable");
      candidate.state = "discarded";
      return this.ports.commit(ownerKey, ownerInstanceId, envelope);
    });
  }
  cleanup(ownerKey: string, ownerInstanceId: string, scope: SyncScope, retainCustody = false) {
    return this.ports.queue.enqueue(async () => {
      const local = this.ports.state(ownerKey, ownerInstanceId);
      if (local.sync.cloudState === "local-only") return { meta: local.meta, rows: local.rows };
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      if (!retainCustody && (state.sync.pendingOperations.length || state.sync.conflictCandidates.some(item => item.state === "unresolved"))) throw new Error("BASE_PENDING_CUSTODY_REQUIRES_RETENTION");
      const envelope: BaseSyncEnvelope = { ...state.sync, cloudState: "local-only", scope: null, confirmed: null,
        detachedCustody: [...state.sync.detachedCustody, { scope, confirmed: state.sync.confirmed!, pendingOperations: state.sync.pendingOperations,
          conflictCandidates: state.sync.conflictCandidates, receipts: state.sync.receipts, tombstones: state.sync.tombstones, cursor: state.sync.cursor }],
        pendingOperations: [], conflictCandidates: [], receipts: [], tombstones: [], cursor: null };
      return this.ports.commit(ownerKey, ownerInstanceId, envelope);
    });
  }
}
