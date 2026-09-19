/**
 * [INPUT]: Depends on original classification operations/receipts and the existing scoped Base envelope.
 * [OUTPUT]: Validates confirmed promotion and preserves distinct metadata/cloud revisions and original pending-operation custody.
 * [POS]: Pure Store promotion leaf; network delivery and lifecycle recovery stay outside the Base writer.
 */
import { z } from "zod";
import { chatClassificationOperationSchema, chatClassificationReceiptSchema, hashChatClassificationOperation } from "@ai-chat/cloud-protocol/chats/classification";
import { matchesBasePromotionProof } from "@ai-chat/cloud-protocol/apps/promotion";
import { canonicalJson, sameScope, syncScopeSchema } from "../../../../../shared/local-storage/contracts";
import { baseSyncEnvelopeSchema } from "../sync/model";
import type { StoredBase } from "../../base-store-model";
export const confirmedBasePromotionSchema = z.object({ scope: syncScopeSchema,
  operation: chatClassificationOperationSchema, receipt: chatClassificationReceiptSchema }).strict().superRefine((value, ctx) => {
  const { operation, receipt } = value;
  if (!operation.basePromotion || !receipt.basePromotion || receipt.status !== "applied" ||
      hashChatClassificationOperation(operation) !== operation.payloadHash || receipt.payloadHash !== operation.payloadHash ||
      receipt.lifecycleOperationId !== operation.lifecycleOperationId || receipt.chatId !== operation.chatId ||
      receipt.candidateHash !== operation.candidateHash || receipt.expectedRevision !== operation.expectedRevision ||
      receipt.head?.chat.incarnationId !== operation.incarnationId || receipt.head.chat.cloudRevision !== operation.expectedRevision + 1 ||
      receipt.head.executorDeviceId !== receipt.sourceDeviceId || receipt.head.executionEpoch !== operation.executionEpoch ||
      canonicalJson(receipt.head.chat.classification) !== canonicalJson(operation.next) ||
      !matchesBasePromotionProof(operation.basePromotion, receipt.basePromotion)) ctx.addIssue({ code: "custom", message: "Confirmed Base promotion proof is invalid" });
});
export type ConfirmedBasePromotion = z.infer<typeof confirmedBasePromotionSchema>;
export function promotedBy(state: StoredBase, intentId: string) {
  return state.sync.ownershipTransfer?.intentId === intentId || state.sync.remoteOwnershipTransfer?.intentId === intentId ||
    state.sync.cloudState === "local-only" && state.meta.ownerInstanceId === intentId;
}
export function transferBaseEnvelope(source: StoredBase, fromOwnerKey: string, projectId: string, intentId: string, raw: ConfirmedBasePromotion) {
  const input = confirmedBasePromotionSchema.parse(raw), transfer = input.operation.basePromotion!, proof = input.receipt.basePromotion!;
  if (source.sync.promotionExport && (source.sync.promotionExport.intentId !== intentId || source.sync.promotionExport.projectId !== projectId ||
      source.sync.promotionExport.payloadHash !== input.operation.payloadHash)) throw new Error("BASE_PROMOTION_EXPORT_CHANGED");
  if (source.sync.cloudState === "local-only" || !source.sync.scope || !sameScope(source.sync.scope, input.scope) ||
      source.meta.owner.kind !== "chat" || source.meta.owner.chatId !== input.operation.chatId ||
      source.meta.owner.incarnationId !== input.operation.incarnationId || source.meta.ownerInstanceId !== proof.baseId ||
      proof.projectId !== projectId || fromOwnerKey !== `chat:${input.operation.chatId}` ||
      source.sync.confirmed?.cloudRevision !== transfer.expectedRevision) throw new Error("BASE_PROMOTION_BASELINE_CHANGED");
  // A later tombstone travels with its candidates; ownership recovery must not strand them on the old owner.
  const envelope = structuredClone(source.sync), confirmed = envelope.confirmed!;
  delete envelope.promotionExport;
  confirmed.meta.owner = { kind: "project", projectId };
  confirmed.meta.navigation = transfer.destination.kind === "app" ? { kind: "internal-app", appId: transfer.destination.appId } :
    { kind: "project-contained", projectId };
  confirmed.meta.revision += 1; confirmed.cloudRevision = proof.revision;
  envelope.ownershipTransfer = { intentId, operationId: input.operation.lifecycleOperationId, payloadHash: input.operation.payloadHash, fromOwnerKey, proof };
  envelope.cursor = String(proof.revision);
  envelope.cloudState = "synced";
  return baseSyncEnvelopeSchema.parse(envelope);
}
