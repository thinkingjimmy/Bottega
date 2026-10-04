/**
 * [INPUT]: Depends on authenticated complete Base snapshots and the existing original-operation reconciliation envelope.
 * [OUTPUT]: Freezes a remotely confirmed owner transfer without fabricating a classification receipt or replacing candidate identities.
 * [POS]: Base Store ownership leaf; the generation holds its observed snapshot and the lifecycle journal owns the transfer intent.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalJson, sameScope, syncScopeSchema, storageRevisionSchema, storageIdSchema } from "../../../../../shared/local-storage/contracts";
import { baseReceiptSchema, baseSyncEnvelopeSchema, confirmedBaseSchema } from "../sync/model";
import { reconcileBase } from "../sync/queue";
import type { StoredBase } from "../../base-store-model";
export const remoteBaseTransferIdentitySchema = z.object({ scope: syncScopeSchema, baseId: storageIdSchema }).strict();
export const remoteBasePromotionSchema = z.object({ scope: syncScopeSchema,
  confirmed: confirmedBaseSchema, receipts: z.array(baseReceiptSchema).max(64),
  tombstones: z.array(z.string().min(1).max(384)).max(20000), expectedLocalRevision: storageRevisionSchema }).strict();
export type RemoteBasePromotion = z.infer<typeof remoteBasePromotionSchema>;
export function freezeRemoteBase(source: StoredBase, fromOwnerKey: string, projectId: string, intentId: string, raw: RemoteBasePromotion) {
  const input = remoteBasePromotionSchema.parse(raw), current = source.sync.confirmed, next = input.confirmed;
  if (!source.sync.scope || !sameScope(source.sync.scope, input.scope) || !current || source.sync.promotionExport ||
      source.sync.tombstones.includes("base") || source.meta.revision !== input.expectedLocalRevision ||
      source.meta.owner.kind !== "chat" || fromOwnerKey !== `chat:${source.meta.owner.chatId}` ||
      current.meta.owner.kind !== "chat" || canonicalJson(current.meta.owner) !== canonicalJson(source.meta.owner) ||
      source.meta.ownerInstanceId !== next.meta.ownerInstanceId || next.meta.owner.kind !== "project" || next.meta.owner.projectId !== projectId ||
      next.cloudRevision <= current.cloudRevision) throw new Error("REMOTE_BASE_TRANSFER_CHANGED");
  // Only this authenticated owner observation may cross the ordinary same-owner reconciliation guard.
  const baseline = structuredClone(source.sync);
  baseline.confirmed!.meta.owner = structuredClone(next.meta.owner);
  baseline.confirmed!.meta.navigation = structuredClone(next.meta.navigation);
  const envelope = reconcileBase(baseline, next, input.receipts, input.tombstones, String(next.cloudRevision));
  const snapshotHash = createHash("sha256").update(canonicalJson({ scope: input.scope, confirmed: next, receipts: input.receipts, tombstones: input.tombstones })).digest("hex");
  envelope.remoteOwnershipTransfer = { intentId, fromOwnerKey, baseId: source.meta.ownerInstanceId, projectId, revision: next.cloudRevision, snapshotHash };
  envelope.promotionExport = { intentId, projectId, payloadHash: snapshotHash };
  return baseSyncEnvelopeSchema.parse(envelope);
}
export function transferredRemoteEnvelope(source: StoredBase, fromOwnerKey: string, projectId: string, intentId: string) {
  const transfer = source.sync.remoteOwnershipTransfer, fence = source.sync.promotionExport;
  if (!transfer || transfer.intentId !== intentId || transfer.fromOwnerKey !== fromOwnerKey || transfer.projectId !== projectId ||
      fence?.intentId !== intentId || fence.payloadHash !== transfer.snapshotHash || fence.projectId !== projectId ||
      source.meta.ownerInstanceId !== transfer.baseId) throw new Error("REMOTE_BASE_TRANSFER_CHANGED");
  const envelope = structuredClone(source.sync); delete envelope.promotionExport;
  return baseSyncEnvelopeSchema.parse(envelope);
}
