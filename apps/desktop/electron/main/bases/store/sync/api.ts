/**
 * [INPUT]: Depends on BaseStore queue/commit/copy ports, authenticated identity recovery, exact candidate proofs and the causal envelope kernel.
 * [OUTPUT]: Provides initial identity plans/convergence, persistent candidate review, exact receipt/closed-scope export release, deletion reconciliation and detached custody.
 * [POS]: A facade over BaseStore's existing writer; all state becomes visible through the same snapshot path.
 */
import type { SerialQueue } from "../../../persistence/serial-queue";
import type { BaseAttachmentValue, BaseSnapshot } from "../../../../../shared/bases-ipc";
import { canonicalJson, sameScope, storageModeSchema, type StorageMode, type SyncScope } from "../../../../../shared/local-storage/contracts";
import type { StoredBase } from "../../base-store-model";
import { baseSyncEnvelopeSchema, confirmedBaseSchema, type BaseOperationReceipt, type BaseSyncEnvelope, type ConfirmedBase } from "./model";
import { projectBase, syncAttachmentRoots } from "./projection";
import type { BaseAttachmentStore } from "../attachments";
import { ownerFileStem } from "../base-files";
import { reconcileBase, restoreBaseCandidate, sealBaseOperation } from "./queue";
import { logicalBaseSnapshot } from "@ai-chat/base-ui/metadata/logical-snapshot";
import { enrollmentOpen, transitionStorageMode } from "../../../../../shared/local-storage/scope-mode";
import type { RuntimeStorageMode } from "../../../../../shared/local-storage/contracts";
import { captureInitialBase } from "./initial";
import { projectBaseCandidate, projectBaseSyncReview } from "./presentation";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema, type ChatClassificationOperation, type ChatClassificationReceipt } from "@ai-chat/cloud-protocol/chats/classification";
import { appDeletionSchema, type CloudAppDeletion } from "@ai-chat/cloud-protocol/apps/model";
import type { CloudBaseConflictLookup } from "@ai-chat/cloud-protocol";
import { reconcileRemoteBaseCandidate } from "./candidates/remote";
import { captureCandidateContext } from "./candidates/context";
import { candidateCopyPlan, type BaseCandidateCopyInput, type BaseCandidateCopyPlan } from "./candidates/copy-model";
import { initialIdentityRecoveryPlan, type InitialIdentityRecoveryPlan } from "./identity/model";
import { frozenBaseTransportSchema, type FrozenBaseTransport } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import { encryptedBaseInitialSchema, type EncryptedBaseInitial } from "@ai-chat/cloud-protocol/bases/encrypted";
import type { BaseStoreFiles } from "../base-files";
import { BaseEncryptionFileCustody } from "./encryption/files";

type SyncPorts = {
  queue: SerialQueue;
  files: Pick<BaseStoreFiles, "readCiphertext" | "writeCiphertext">;
  attachments: Pick<BaseAttachmentStore, "describe" | "put">;
  state(ownerKey: string, ownerInstanceId: string): StoredBase;
  scopes(): Iterable<SyncScope | null>;
  states(): Iterable<StoredBase>;
  commit(ownerKey: string, ownerInstanceId: string, envelope: BaseSyncEnvelope, snapshot?: BaseSnapshot): Promise<BaseSnapshot>;
  publishCopy(plan: BaseCandidateCopyPlan): Promise<BaseSnapshot>;
  recoverIdentity(source: StoredBase, plan: InitialIdentityRecoveryPlan, confirmed: ConfirmedBase | null, tombstones: string[]): Promise<BaseSnapshot>;
};
export class BaseSyncApi {
  private mode: StorageMode;
  readonly encryptedFiles: BaseEncryptionFileCustody;
  constructor(private ports: SyncPorts, mode: StorageMode = { kind: "local-only" }) {
    this.mode = storageModeSchema.parse(mode); if (mode.kind === "fixture" && process.versions.electron) throw new Error("FIXTURE_MODE_UNAVAILABLE");
    this.encryptedFiles = new BaseEncryptionFileCustody({ queue: ports.queue, files: ports.files,
      current: (target, scope) => {
        this.assertMode(scope); const state = ports.state(target.ownerKey, target.baseId);
        if (state.sync.scope && !sameScope(state.sync.scope, scope)) throw new Error("BASE_SYNC_SCOPE_UNAVAILABLE");
        return state.sync;
      }, commit: (target, envelope) => ports.commit(target.ownerKey, target.baseId, envelope) });
  }
  configureMode(mode: RuntimeStorageMode) {
    return this.ports.queue.enqueue(async () => { this.mode = transitionStorageMode(this.mode, mode, this.ports.scopes()); });
  }
  read(ownerKey: string, ownerInstanceId: string) { return structuredClone(this.ports.state(ownerKey, ownerInstanceId).sync); }
  freezeInitial(ownerKey: string, ownerInstanceId: string, scope: SyncScope, raw: EncryptedBaseInitial) {
    return this.ports.queue.enqueue(async () => {
      this.assertMode(scope);
      const state = this.ports.state(ownerKey, ownerInstanceId), initial = encryptedBaseInitialSchema.parse(raw);
      if (state.sync.initialCiphertext) {
        if (!sameScope(scope, state.sync.initialCiphertext.scope)) throw new Error("BASE_SYNC_SCOPE_CONFLICT");
        return structuredClone(state.sync.initialCiphertext.initial);
      }
      if (state.sync.cloudState !== "local-only" || initial.baseId !== ownerInstanceId ||
        canonicalJson(initial.intent.owner) !== canonicalJson(state.meta.owner)) throw new Error("BASE_INITIAL_IDENTITY_CONFLICT");
      await this.ports.commit(ownerKey, ownerInstanceId, baseSyncEnvelopeSchema.parse({ ...state.sync, initialCiphertext: { scope, initial } }));
      return initial;
    });
  }
  freezeTransport(ownerKey: string, ownerInstanceId: string, scope: SyncScope, raw: FrozenBaseTransport) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope), prepared = frozenBaseTransportSchema.parse(raw);
      if (state.sync.tombstones.includes("base") || state.sync.promotionExport) throw new Error("BASE_OPERATION_UNAVAILABLE");
      const envelope = structuredClone(state.sync), operation = envelope.pendingOperations.find(value => value.operationId === prepared.commit.operationId);
      if (!operation || !operation.sealed || operation.state !== "queued" || operation.payloadHash !== prepared.plaintextHash || prepared.commit.baseId !== ownerInstanceId) throw new Error("BASE_CIPHERTEXT_IDENTITY_CHANGED");
      if (operation.encryptedTransport) return operation.encryptedTransport;
      operation.encryptedTransport = prepared;
      await this.ports.commit(ownerKey, ownerInstanceId, baseSyncEnvelopeSchema.parse(envelope));
      return prepared;
    });
  }
  initialIdentityPlan(ownerKey: string, ownerInstanceId: string, scope: SyncScope, input: ConfirmedBase | null) {
    this.assertMode(scope);
    return initialIdentityRecoveryPlan(this.ports.state(ownerKey, ownerInstanceId), ownerKey, scope, input && confirmedBaseSchema.parse(input), this.ports.states());
  }
  retainDeletedIdentity(ownerKey: string, ownerInstanceId: string, scope: SyncScope, recoveryId: string) {
    return this.ports.queue.enqueue(async () => {
      this.assertMode(scope);
      const source = this.ports.state(ownerKey, ownerInstanceId);
      if (source.sync.tombstones.includes("base")) return;
      const plan = initialIdentityRecoveryPlan(source, ownerKey, scope, null, this.ports.states());
      if (plan.recoveryId !== recoveryId) throw new Error("BASE_INITIAL_RECOVERY_CHANGED");
      await this.ports.recoverIdentity(source, plan, null, []);
      // The complete independent copy is durable before the old identity becomes unavailable.
      await this.ports.commit(ownerKey, ownerInstanceId, baseSyncEnvelopeSchema.parse({ ...source.sync, tombstones: ["base"] }));
    });
  }
  recoverInitialIdentity(ownerKey: string, ownerInstanceId: string, scope: SyncScope, input: ConfirmedBase, tombstones: string[], recoveryId: string) {
    return this.ports.queue.enqueue(async () => {
      this.assertMode(scope);
      const source = this.ports.state(ownerKey, ownerInstanceId), confirmed = confirmedBaseSchema.parse(input);
      const plan = initialIdentityRecoveryPlan(source, ownerKey, scope, confirmed, this.ports.states());
      if (plan.recoveryId !== recoveryId || tombstones.includes("base")) throw new Error("BASE_INITIAL_RECOVERY_CHANGED");
      return this.ports.recoverIdentity(source, plan, confirmed, tombstones);
    });
  }
  review(ownerKey: string, ownerInstanceId: string, scope: SyncScope, afterId: string | null) {
    const state = this.ports.state(ownerKey, ownerInstanceId);
    if (state.sync.cloudState === "local-only") return null;
    return projectBaseSyncReview(this.scoped(ownerKey, ownerInstanceId, scope).sync, afterId);
  }
  candidate(ownerKey: string, ownerInstanceId: string, scope: SyncScope, operationId: string, offset: number) {
    return projectBaseCandidate(this.scoped(ownerKey, ownerInstanceId, scope).sync, operationId, offset);
  }
  copyPlan(scope: SyncScope, input: BaseCandidateCopyInput) {
    return candidateCopyPlan(this.scoped(input.ownerKey, input.baseId, scope).sync, scope, input);
  }
  prepareCopy(scope: SyncScope, input: BaseCandidateCopyInput) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(input.ownerKey, input.baseId, scope), plan = candidateCopyPlan(state.sync, scope, input);
      if (!plan.candidate.copyRequest) {
        const envelope = structuredClone(state.sync);
        envelope.conflictCandidates.find(item => item.operation.operationId === input.operationId)!.copyRequest = { name: plan.name };
        await this.ports.commit(input.ownerKey, input.baseId, baseSyncEnvelopeSchema.parse(envelope));
      }
      return this.copyPlan(scope, input);
    });
  }
  copyCandidate(scope: SyncScope, input: BaseCandidateCopyInput) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(input.ownerKey, input.baseId, scope), plan = candidateCopyPlan(state.sync, scope, input);
      const result = await this.ports.publishCopy(plan);
      if (!plan.candidate.copiedTo) {
        const envelope = structuredClone(state.sync);
        envelope.conflictCandidates.find(item => item.operation.operationId === input.operationId)!.copiedTo = { projectId: plan.projectId, baseId: plan.baseId };
        await this.ports.commit(input.ownerKey, input.baseId, baseSyncEnvelopeSchema.parse(envelope));
      }
      return result;
    });
  }
  receiveCandidate(ownerKey: string, ownerInstanceId: string, scope: SyncScope, proof: CloudBaseConflictLookup, resolutionOperationId: string | null) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      const envelope = reconcileRemoteBaseCandidate(state.sync, proof, resolutionOperationId);
      if (canonicalJson(envelope) === canonicalJson(state.sync)) return false;
      await this.ports.commit(ownerKey, ownerInstanceId, envelope, projectBase(envelope)); return true;
    });
  }
  candidateDiscovery(ownerKey: string, ownerInstanceId: string, scope: SyncScope, revision: number, complete: boolean) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      if (state.sync.tombstones.includes("base") || state.sync.candidateDiscovery?.revision === revision && state.sync.candidateDiscovery.complete === complete) return false;
      await this.ports.commit(ownerKey, ownerInstanceId, baseSyncEnvelopeSchema.parse({ ...state.sync, candidateDiscovery: { revision, complete } }));
      return true;
    });
  }
  attachmentScope(ownerKey: string, ownerInstanceId: string, blobId: string): SyncScope {
    const state = this.ports.state(ownerKey, ownerInstanceId);
    if (!state.sync.scope || (!state.attachmentBlobIds.has(blobId) && !syncAttachmentRoots(state.sync).has(blobId))) {
      throw new Error("BASE_ATTACHMENT_REFERENCE_UNAVAILABLE");
    }
    return { ...state.sync.scope };
  }
  cacheAttachment(ownerKey: string, ownerInstanceId: string, scope: SyncScope, value: BaseAttachmentValue, bytes: Buffer, signal: AbortSignal) {
    return this.ports.queue.enqueue(async () => {
      signal.throwIfAborted(); this.scoped(ownerKey, ownerInstanceId, scope);
      if (!sameScope(scope, this.attachmentScope(ownerKey, ownerInstanceId, value.blobId))) throw new Error("BASE_SYNC_SCOPE_UNAVAILABLE");
      const input = { filename: value.filename, bytes, sourceRevision: value.revision };
      const verified = this.ports.attachments.describe(input);
      if (verified.blobId !== value.blobId || verified.byteLength !== value.byteLength || verified.mediaType !== value.mediaType ||
        verified.width !== value.width || verified.height !== value.height) throw new Error("BASE_ATTACHMENT_IDENTITY_CHANGED");
      // The Store queue orders caching before deletion/GC without changing rows, retention or revision.
      await this.ports.attachments.put({ ...input, chatId: ownerFileStem(ownerKey), incarnationId: ownerInstanceId });
    });
  }
  private scoped(ownerKey: string, ownerInstanceId: string, scope: SyncScope, closing = false) {
    this.assertMode(scope, closing);
    const state = this.ports.state(ownerKey, ownerInstanceId);
    if (!state.sync.scope || !sameScope(scope, state.sync.scope)) throw new Error("BASE_SYNC_SCOPE_UNAVAILABLE");
    return state;
  }
  private assertMode(scope: SyncScope, closing = false) {
    if (this.mode.kind === "local-only" || !sameScope(this.mode.scope, scope) || (!closing && !enrollmentOpen(this.mode))) throw new Error("BASE_SYNC_MODE_UNAVAILABLE");
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
      if (canonicalJson(logicalBaseSnapshot(confirmed)) !== canonicalJson(logicalBaseSnapshot(state))) {
        throw new Error("BASE_INITIAL_SNAPSHOT_CONFLICT");
      }
      const envelope = baseSyncEnvelopeSchema.parse({ ...state.sync, cloudState, scope, confirmed });
      return this.ports.commit(ownerKey, ownerInstanceId, envelope, projectBase(envelope));
    });
  }
  captureInitial(ownerKey: string, ownerInstanceId: string, scope: SyncScope, input: ConfirmedBase, manifestId: string) {
    return this.ports.queue.enqueue(async () => {
      this.assertMode(scope);
      const state = this.ports.state(ownerKey, ownerInstanceId);
      if (state.sync.cloudState !== "local-only") {
        this.scoped(ownerKey, ownerInstanceId, scope);
        if (state.sync.cloudState !== "synced") throw new Error("BASE_INITIAL_SNAPSHOT_CONFLICT");
        return { meta: state.meta, rows: state.rows };
      }
      const envelope = captureInitialBase(state, confirmedBaseSchema.parse(input), scope, manifestId);
      return this.ports.commit(ownerKey, ownerInstanceId, envelope, projectBase(envelope));
    });
  }
  installMirror(ownerKey: string, ownerInstanceId: string, scope: SyncScope, input: ConfirmedBase, expectedLocalRevision: number) {
    return this.ports.queue.enqueue(async () => {
      this.assertMode(scope);
      const state = this.ports.state(ownerKey, ownerInstanceId), confirmed = confirmedBaseSchema.parse(input);
      if (confirmed.meta.ownerInstanceId !== ownerInstanceId || canonicalJson(confirmed.meta.owner) !== canonicalJson(state.meta.owner)) throw new Error("BASE_IDENTITY_CONFLICT");
      if (expectedLocalRevision !== 0 || state.meta.revision !== expectedLocalRevision || state.rows.length || state.sync.cloudState !== "local-only" || state.meta.historyGeneration || state.meta.galleryGeneration) throw new Error("BASE_MIRROR_ADMISSION_CONFLICT");
      const envelope = baseSyncEnvelopeSchema.parse({ ...state.sync, cloudState: "mirror", scope, confirmed });
      return this.ports.commit(ownerKey, ownerInstanceId, envelope, projectBase(envelope));
    });
  }
  seal(ownerKey: string, ownerInstanceId: string, scope: SyncScope, operationId: string) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      if (state.sync.promotionExport) throw new Error("BASE_PROMOTION_IN_PROGRESS");
      const envelope = sealBaseOperation(state.sync, operationId);
      await this.ports.commit(ownerKey, ownerInstanceId, envelope);
      return structuredClone(envelope.pendingOperations.find(item => item.operationId === operationId)!);
    });
  }
  freezePromotion(ownerKey: string, scope: SyncScope, intentId: string, input: ChatClassificationOperation) {
    return this.ports.queue.enqueue(async () => {
      const operation = chatClassificationOperationSchema.parse(input), transfer = operation.basePromotion;
      if (!transfer) throw new Error("BASE_PROMOTION_REQUIRED");
      const state = this.scoped(ownerKey, transfer.baseId, scope);
      const exportState = { intentId, projectId: transfer.destination.projectId, payloadHash: operation.payloadHash };
      if (state.sync.promotionExport) {
        if (canonicalJson(state.sync.promotionExport) !== canonicalJson(exportState)) throw new Error("BASE_PROMOTION_EXPORT_CHANGED");
        return;
      }
      if (state.meta.owner.kind !== "chat" || state.meta.owner.chatId !== operation.chatId ||
          state.meta.owner.incarnationId !== operation.incarnationId || state.sync.tombstones.includes("base") ||
          state.sync.confirmed?.cloudRevision !== transfer.expectedRevision) throw new Error("BASE_PROMOTION_BASELINE_CHANGED");
      await this.ports.commit(ownerKey, transfer.baseId, baseSyncEnvelopeSchema.parse({ ...state.sync, promotionExport: exportState }));
    });
  }
  releasePromotion(ownerKey: string, scope: SyncScope, intentId: string, input: ChatClassificationOperation, rawReceipt: ChatClassificationReceipt) {
    return this.ports.queue.enqueue(async () => {
      const operation = chatClassificationOperationSchema.parse(input), receipt = chatClassificationReceiptSchema.parse(rawReceipt);
      if (!operation.basePromotion || receipt.status === "applied" || receipt.lifecycleOperationId !== operation.lifecycleOperationId ||
        receipt.payloadHash !== operation.payloadHash || receipt.candidateHash !== operation.candidateHash) throw new Error("BASE_PROMOTION_REJECTION_REQUIRED");
      const state = this.scoped(ownerKey, operation.basePromotion.baseId, scope), fence = state.sync.promotionExport;
      if (!fence) return;
      if (fence.intentId !== intentId || fence.payloadHash !== operation.payloadHash) throw new Error("BASE_PROMOTION_EXPORT_CHANGED");
      const { promotionExport: _export, ...envelope } = state.sync;
      await this.ports.commit(ownerKey, operation.basePromotion.baseId, baseSyncEnvelopeSchema.parse(envelope));
    });
  }
  releasePromotionForCleanup(ownerKey: string, ownerInstanceId: string, scope: SyncScope, intentId: string, payloadHash: string) {
    return this.ports.queue.enqueue(async () => {
      if (this.mode.kind !== "sync" || enrollmentOpen(this.mode)) throw new Error("BASE_CLEANUP_REQUIRES_CLOSED_SCOPE");
      const state = this.scoped(ownerKey, ownerInstanceId, scope, true), fence = state.sync.promotionExport;
      if (!fence) return;
      if (fence.intentId !== intentId || fence.payloadHash !== payloadHash || state.sync.ownershipTransfer || state.sync.remoteOwnershipTransfer) throw new Error("BASE_PROMOTION_EXPORT_CHANGED");
      const { promotionExport: _export, ...envelope } = state.sync;
      await this.ports.commit(ownerKey, ownerInstanceId, baseSyncEnvelopeSchema.parse(envelope));
    });
  }
  reconcile(ownerKey: string, ownerInstanceId: string, scope: SyncScope, confirmed: ConfirmedBase, receipts: BaseOperationReceipt[], tombstones: string[], cursor: string) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      // A request started before deletion cannot replace the retained baseline or candidate evidence.
      if (state.sync.tombstones.includes("base") || state.sync.promotionExport) return { meta: state.meta, rows: state.rows };
      const envelope = reconcileBase(state.sync, confirmedBaseSchema.parse(confirmed), receipts, tombstones, cursor);
      return this.ports.commit(ownerKey, ownerInstanceId, envelope, projectBase(envelope));
    });
  }
  acceptDeletion(ownerKey: string, ownerInstanceId: string, scope: SyncScope) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      if (state.sync.tombstones.includes("base") && !state.sync.pendingOperations.length) return;
      const envelope = reconcileBase(state.sync, state.sync.confirmed!, [], ["base"], state.sync.cursor ?? "0");
      for (const operation of envelope.pendingOperations) envelope.conflictCandidates.push({ operation, receipt: null,
        state: "unresolved", remoteResolved: false, blockedReason: "tombstone", currentValues: {}, resolutionOperationId: null,
        recoveryContext: captureCandidateContext(state.sync, operation) });
      envelope.pendingOperations = [];
      await this.ports.commit(ownerKey, ownerInstanceId, envelope, projectBase(envelope));
    });
  }
  resolve(ownerKey: string, ownerInstanceId: string, scope: SyncScope, candidateOperationId: string,
    action: ({ kind: "discard" } | { kind: "restore"; operationId: string }) & { expectedPayloadHash?: string }) {
    return this.ports.queue.enqueue(() => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope);
      if (state.sync.promotionExport) throw new Error("BASE_PROMOTION_IN_PROGRESS");
      if (action.expectedPayloadHash && state.sync.conflictCandidates.find(item => item.operation.operationId === candidateOperationId)?.operation.payloadHash !== action.expectedPayloadHash) {
        throw new Error("BASE_CANDIDATE_IDENTITY_CHANGED");
      }
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
  acknowledgeDiscard(ownerKey: string, ownerInstanceId: string, scope: SyncScope, candidateOperationId: string) {
    return this.ports.queue.enqueue(async () => {
      const state = this.scoped(ownerKey, ownerInstanceId, scope), envelope = structuredClone(state.sync);
      const candidate = envelope.conflictCandidates.find(item => item.operation.operationId === candidateOperationId);
      if (!candidate || candidate.state !== "discarded" || !candidate.receipt) throw new Error("BASE_CONFLICT_DISPOSITION_CHANGED");
      if (candidate.remoteResolved) return { meta: state.meta, rows: state.rows };
      candidate.remoteResolved = true;
      return this.ports.commit(ownerKey, ownerInstanceId, envelope);
    });
  }
  cleanup(ownerKey: string, ownerInstanceId: string, scope: SyncScope, retainCustody = false, retainedApp?: CloudAppDeletion) {
    return this.ports.queue.enqueue(async () => {
      const local = this.ports.state(ownerKey, ownerInstanceId);
      if (local.sync.cloudState === "local-only") {
        const initial = local.sync.initialCiphertext;
        if (!initial) return { meta: local.meta, rows: local.rows };
        if (!sameScope(initial.scope, scope)) throw new Error("BASE_SYNC_SCOPE_CONFLICT");
        const envelope = baseSyncEnvelopeSchema.parse({ ...local.sync, initialCiphertext: undefined,
          detachedInitialCiphertexts: [...local.sync.detachedInitialCiphertexts ?? [], initial] });
        return this.ports.commit(ownerKey, ownerInstanceId, envelope);
      }
      const state = this.scoped(ownerKey, ownerInstanceId, scope, true);
      const proof = retainedApp && appDeletionSchema.parse(retainedApp);
      if (proof && (!proof.retainBase || !retainCustody || proof.baseId !== ownerInstanceId || state.meta.owner.kind !== "project" ||
        proof.projectId !== state.meta.owner.projectId || state.meta.navigation.kind === "internal-app" && state.meta.navigation.appId !== proof.appId)) throw new Error("BASE_APP_RETENTION_CHANGED");
      if (state.sync.promotionExport) throw new Error("BASE_PROMOTION_IN_PROGRESS");
      if (!retainCustody && (state.sync.pendingOperations.length || state.sync.conflictCandidates.some(item => item.state === "unresolved"))) throw new Error("BASE_PENDING_CUSTODY_REQUIRES_RETENTION");
      const envelope: BaseSyncEnvelope = { ...state.sync, cloudState: "local-only", scope: null, confirmed: null,
        initialCiphertext: undefined, encryptionFiles: undefined,
        detachedInitialCiphertexts: [...state.sync.detachedInitialCiphertexts ?? [], ...state.sync.initialCiphertext ? [state.sync.initialCiphertext] : []],
        ownershipTransfer: undefined, remoteOwnershipTransfer: undefined,
        detachedCustody: [...state.sync.detachedCustody, { scope, confirmed: state.sync.confirmed!, pendingOperations: state.sync.pendingOperations,
          encryptionFiles: state.sync.encryptionFiles,
          conflictCandidates: state.sync.conflictCandidates, receipts: state.sync.receipts, tombstones: state.sync.tombstones, cursor: state.sync.cursor,
          ownershipTransfer: state.sync.ownershipTransfer, remoteOwnershipTransfer: state.sync.remoteOwnershipTransfer }],
        pendingOperations: [], conflictCandidates: [], receipts: [], tombstones: [], cursor: null };
      return this.ports.commit(ownerKey, ownerInstanceId, envelope, proof ? {
        meta: { ...state.meta, revision: state.meta.revision + 1, navigation: { kind: "root-user-managed", source: "retained-app-data", activatedAt: proof.tombstone.deletedAt } }, rows: state.rows,
      } : undefined);
    });
  }
}
