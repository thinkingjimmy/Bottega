/**
 * [INPUT]: Depends on the closing account binding, original classification candidates, Base export fences and domain sagas.
 * [OUTPUT]: Journals local conversion dispositions before cleanup, retaining unknown requests and completing receipt-proven ownership.
 * [POS]: Account cleanup preparation; no network, credentials or second operation queue are available here.
 */
import { z } from "zod";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema } from "@ai-chat/cloud-protocol/chats/classification";
import { hashChatContent } from "@ai-chat/cloud-protocol/chats/transcript/body";
import { sameScope, syncScopeSchema, storageIdSchema as id, storageHashSchema as hash, type SyncScope } from "../../../../../../shared/local-storage/contracts";
import { confirmedBasePromotionSchema } from "../../../../bases/store/promotion/cloud";
import type { BasePromotionService } from "../../../../bases/base-promotion-service";
import type { SaveAsAppService } from "../../../../apps/conversion/save-as-app";
import type { ProjectRescueService } from "../../../../projects/rescue/service";
import type { LifecycleIntentStore } from "../../../../lifecycle/intent-store";
import type { LifecycleIntent } from "../../../../lifecycle/intent-types";
import type { ConversionScopeCleanup, ConversionCleanupDecision } from "../../../../lifecycle/scope-cleanup/conversion";
import type { SyncBindingStore } from "../binding";
import type { CleanupOwners } from "./plan";

export type ConversionCleanupServices = {
  save: Pick<SaveAsAppService, "settleScopeCleanup">;
  promotion: Pick<BasePromotionService, "settleScopeCleanup">;
  rescue: Pick<ProjectRescueService, "settleScopeCleanup">;
};
const markerSchema = z.object({ version: z.literal(1), scope: syncScopeSchema, cleanupOperationId: id,
  lifecycleOperationId: hash, candidateHash: hash.nullable(), originalState: z.string().max(32).nullable(),
  receiptHash: hash.nullable(), disposition: z.enum(["preserve", "complete"]), proof: confirmedBasePromotionSchema.optional(),
  export: z.object({ ownerKey: z.string().min(1).max(384), ownerInstanceId: id, intentId: id, projectId: id, payloadHash: hash }).strict().optional(),
}).strict();
type Marker = z.infer<typeof markerSchema>;
export class AccountConversionCleanup {
  constructor(private readonly ports: { binding: SyncBindingStore; owners: CleanupOwners; journal: LifecycleIntentStore; services: ConversionCleanupServices }) {}
  async run(scope: SyncScope, cleanupOperationId: string) {
    this.current(scope, cleanupOperationId);
    for (const intent of await this.ports.journal.listPending()) {
      if (intent.parentIntentId || !["save-as-app", "base-promotion", "project-chat-rescue"].includes(intent.kind) || !await this.belongs(intent, scope)) continue;
      const cleanup: ConversionScopeCleanup = {
        prepare: current => this.prepare(current, scope, cleanupOperationId),
        commit: current => this.commit(current, scope, cleanupOperationId),
        release: current => this.release(current, scope, cleanupOperationId),
      };
      const service = intent.kind === "save-as-app" ? this.ports.services.save : intent.kind === "base-promotion" ? this.ports.services.promotion : this.ports.services.rescue;
      await service.settleScopeCleanup(intent.intentId, cleanup);
      const remaining = await this.ports.journal.getById(intent.intentId);
      if (remaining && !remaining.terminal) throw new Error("CONVERSION_CLEANUP_PENDING");
    }
  }
  private current(scope: SyncScope, operationId: string) {
    const binding = this.ports.binding.snapshot(), mode = this.ports.binding.mode();
    if (!binding || binding.phase !== "closing" || binding.cleanup?.operationId !== operationId || binding.userId !== scope.userId ||
      mode.kind !== "sync" || !sameScope(mode.scope, scope) || mode.enrollment !== "closed") throw new Error("CONVERSION_CLEANUP_SCOPE_CHANGED");
  }
  private async belongs(intent: LifecycleIntent, scope: SyncScope) {
    const tagged = intent.recoveryState.scopeCleanup ? markerSchema.parse(intent.recoveryState.scopeCleanup).scope :
      intent.recoveryState.cloudPromotionScope ?? intent.recoveryState.cloudRescueScope ??
      (intent.recoveryState.remoteBaseTransfer as { scope?: unknown } | undefined)?.scope;
    if (tagged) return sameScope(syncScopeSchema.parse(tagged), scope);
    const base = this.ports.owners.bases.get(`chat:${String(intent.input.chatId)}`);
    if (base && sameScope(this.ports.owners.bases.sync.read(`chat:${String(intent.input.chatId)}`, base.meta.ownerInstanceId).scope, scope)) return true;
    try {
      const metadata = await this.ports.owners.chats.sync.read(scope, { type: "chat-metadata", chatId: String(intent.input.chatId) });
      return metadata.type === "chat-metadata" && Boolean(metadata.value.head || metadata.value.pendingCount);
    } catch (error) {
      if (error instanceof Error && error.message === "CHAT_METADATA_BASELINE_UNAVAILABLE") return false;
      throw error;
    }
  }
  private async candidate(scope: SyncScope, operationId: string) {
    const result = await this.ports.owners.chats.sync.read(scope, { type: "classification", lifecycleOperationId: operationId });
    if (result.type !== "classification") throw new Error("CONVERSION_CLEANUP_CANDIDATE_UNAVAILABLE");
    return result.value;
  }
  private decision(marker: Marker): ConversionCleanupDecision {
    return { disposition: marker.disposition, proof: marker.proof, receipt: { cleanupOperationId: marker.cleanupOperationId,
      scope: marker.scope, lifecycleOperationId: marker.lifecycleOperationId, candidateHash: marker.candidateHash,
      originalState: marker.originalState, receiptHash: marker.receiptHash, disposition: marker.disposition } };
  }
  private async prepare(intent: LifecycleIntent, scope: SyncScope, cleanupOperationId: string) {
    this.current(scope, cleanupOperationId);
    if (!await this.belongs(intent, scope)) throw new Error("CONVERSION_CLEANUP_SCOPE_CHANGED");
    const lifecycleOperationId = hashChatContent([intent.kind, scope, intent.intentId]);
    const candidate = await this.candidate(scope, lifecycleOperationId);
    const receipt = candidate?.receipt_json ? chatClassificationReceiptSchema.parse(JSON.parse(candidate.receipt_json)) : null;
    const receiptHash = receipt ? hashChatContent(receipt) : null;
    if (intent.recoveryState.scopeCleanup) {
      const marker = markerSchema.parse(intent.recoveryState.scopeCleanup);
      if (!sameScope(marker.scope, scope) || marker.cleanupOperationId !== cleanupOperationId || marker.lifecycleOperationId !== lifecycleOperationId ||
          marker.candidateHash !== (candidate?.candidate_hash ?? null) || marker.receiptHash !== receiptHash) throw new Error("CONVERSION_CLEANUP_CUSTODY_CHANGED");
      return this.decision(marker);
    }
    const operation = candidate?.operation_json ? chatClassificationOperationSchema.parse(JSON.parse(candidate.operation_json)) : null;
    const ownerKey = `chat:${String(intent.input.chatId)}`, base = this.ports.owners.bases.get(ownerKey);
    const envelope = base ? this.ports.owners.bases.sync.read(ownerKey, base.meta.ownerInstanceId) : null;
    const target = this.ports.owners.bases.get(`project:${String(intent.input.projectId)}`);
    const remote = envelope?.remoteOwnershipTransfer ?? (target ? this.ports.owners.bases.sync.read(`project:${String(intent.input.projectId)}`, target.meta.ownerInstanceId).remoteOwnershipTransfer : null);
    const complete = receipt?.status === "applied" || Boolean(intent.recoveryState.remoteBaseTransfer && remote?.intentId === intent.intentId);
    if (candidate?.state === "committed" && !complete || complete && operation && receipt?.candidateHash !== candidate?.candidate_hash) throw new Error("CONVERSION_CLEANUP_PROOF_CHANGED");
    const marker = markerSchema.parse({ version: 1, scope, cleanupOperationId, lifecycleOperationId, candidateHash: candidate?.candidate_hash ?? null,
      originalState: candidate?.state ?? null, receiptHash, disposition: complete ? "complete" : "preserve",
      ...(complete && operation?.basePromotion ? { proof: confirmedBasePromotionSchema.parse({ scope, operation, receipt }) } : {}),
      ...(envelope?.promotionExport ? { export: { ...envelope.promotionExport, ownerKey, ownerInstanceId: base!.meta.ownerInstanceId } } : {}) });
    await this.ports.journal.advance(intent.intentId, intent.phase, { scopeCleanup: marker });
    return this.decision(marker);
  }
  private async marker(intent: LifecycleIntent, scope: SyncScope, cleanupOperationId: string) {
    const current = await this.ports.journal.getById(intent.intentId);
    if (!current || current.terminal) throw new Error("CONVERSION_CLEANUP_INTENT_CHANGED");
    await this.prepare(current, scope, cleanupOperationId);
    return markerSchema.parse((await this.ports.journal.getById(intent.intentId))!.recoveryState.scopeCleanup);
  }
  private async commit(intent: LifecycleIntent, scope: SyncScope, cleanupOperationId: string) {
    const marker = await this.marker(intent, scope, cleanupOperationId);
    if (marker.disposition !== "complete" || !marker.receiptHash) throw new Error("CONVERSION_CLEANUP_PROOF_REQUIRED");
    await this.ports.owners.chats.sync.mutate(scope, hashChatContent(["classification-commit", marker.lifecycleOperationId]),
      { type: "commit-classification", lifecycleOperationId: marker.lifecycleOperationId });
  }
  private async release(intent: LifecycleIntent, scope: SyncScope, cleanupOperationId: string) {
    const marker = await this.marker(intent, scope, cleanupOperationId);
    if (marker.disposition !== "preserve") throw new Error("CONVERSION_CLEANUP_PRESERVATION_CHANGED");
    if (marker.export) await this.ports.owners.bases.sync.releasePromotionForCleanup(marker.export.ownerKey, marker.export.ownerInstanceId,
      scope, marker.export.intentId, marker.export.payloadHash);
  }
}
