/**
 * [INPUT]: Depends on shared cloud field/receipt contracts, canonical Base schemas and explicit synchronization scopes.
 * [OUTPUT]: Provides Base synchronization and detached custody envelopes with original ownership proofs, initial-identity recovery provenance, immutable operations and candidate/receipt baselines.
 * [POS]: BaseStore-owned durable synchronization state; local revision remains independent of cloud versions.
 */
import { z } from "zod";
import { createHash } from "node:crypto";
import { baseMetaSchema, baseRowSchema } from "../../../../../shared/bases-schema";
import { canonicalJson, storageIdSchema as id, storageRevisionSchema as rev, syncScopeSchema } from "../../../../../shared/local-storage/contracts";

import { basePatchSchema, baseOperationSchema, baseReceiptSchema, fieldVersionMapSchema as versionMap, fieldKey, isMetadataField, metadataTargets, type BasePatch } from "@ai-chat/cloud-protocol";
import { basePromotionProofSchema } from "@ai-chat/cloud-protocol/apps/promotion";
import { toolBatchReceiptSchema } from "../tool/model";
import { initialIdentityRecoverySchema } from "./identity/model";
import { baseEncryptionCaptureSchema, frozenBaseTransportSchema } from "@ai-chat/cloud-protocol/bases/encrypted/client";
import { encryptedBaseInitialSchema } from "@ai-chat/cloud-protocol/bases/encrypted";
import { baseEncryptionFilesSchema } from "./encryption/model";
export { basePatchSchema, baseReceiptSchema, fieldKey };
export type { BasePatch };
export function isBasePatchDeleted(tombstones: readonly string[], patch: BasePatch) {
  return tombstones.includes("base") || tombstones.includes(fieldKey(patch)) ||
    isMetadataField(patch) && metadataTargets(patch).some(key => tombstones.includes(key)) || "target" in patch &&
    (tombstones.includes(`row:${patch.target.rowId}`) || tombstones.includes(`column:${patch.target.columnId}`));
}
export const confirmedBaseSchema = z.object({
  meta: baseMetaSchema, rows: z.array(baseRowSchema).max(10000), cloudRevision: rev,
  schemaRevision: rev, columnSchemaVersions: versionMap, fieldVersions: versionMap, rowVersions: versionMap,
}).strict();
export type ConfirmedBase = z.infer<typeof confirmedBaseSchema>;
export const pendingOperationSchema = baseOperationSchema.extend({
  sealed: z.boolean(), attempts: rev, state: z.enum(["queued", "blocked"]),
  encryptionCapture: baseEncryptionCaptureSchema.optional(), encryptedTransport: frozenBaseTransportSchema.optional(),
}).strict();
export type PendingBaseOperation = z.infer<typeof pendingOperationSchema>;
export type BaseOperationReceipt = z.infer<typeof baseReceiptSchema>;
const candidateSchema = z.object({
  operation: pendingOperationSchema, receipt: baseReceiptSchema.nullable(), state: z.enum(["unresolved", "discarded", "applied", "superseded"]),
  remoteResolved: z.boolean().default(false),
  blockedReason: z.enum(["dependency", "tombstone"]).nullable().default(null),
  currentValues: z.record(z.string(), z.json()), resolutionOperationId: id.nullable(),
  origin: z.object({ deviceId: id, deviceName: z.string().min(1).max(40).nullable(), createdAt: rev }).strict().optional(),
  unresolvedIndexes: z.array(rev).max(512).optional(),
  staleResolutions: z.array(pendingOperationSchema).max(128).optional(),
  recoveryContext: z.object({ meta: baseMetaSchema, rows: z.array(baseRowSchema).max(10000) }).strict().optional(),
  copiedTo: z.object({ projectId: id, baseId: id }).strict().optional(),
  copyRequest: z.object({ name: z.string().min(1).max(100) }).strict().optional(),
}).strict();
const ownershipFields = {
  remoteOwnershipTransfer: z.object({ intentId: id, fromOwnerKey: z.string().min(1).max(384), baseId: id,
    projectId: id, revision: rev, snapshotHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  promotionExport: z.object({ intentId: id, projectId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional(),
  ownershipTransfer: z.object({ intentId: id, operationId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
    fromOwnerKey: z.string().min(1).max(384), proof: basePromotionProofSchema }).strict().optional(),
};
const detachedCustodySchema = z.object({ ...ownershipFields, scope: syncScopeSchema, confirmed: confirmedBaseSchema,
  encryptionFiles: baseEncryptionFilesSchema.optional(),
  pendingOperations: z.array(pendingOperationSchema), conflictCandidates: z.array(candidateSchema), receipts: z.array(baseReceiptSchema),
  tombstones: z.array(z.string()), cursor: id.nullable() }).strict();
const initialCiphertextSchema = z.object({ scope: syncScopeSchema, initial: encryptedBaseInitialSchema }).strict();
export const baseSyncEnvelopeSchema = z.object({
  ...ownershipFields,
  initialCiphertext: initialCiphertextSchema.optional(),
  detachedInitialCiphertexts: z.array(initialCiphertextSchema).max(32).optional(),
  encryptionFiles: baseEncryptionFilesSchema.optional(),
  initialIdentityRecovery: initialIdentityRecoverySchema.optional(),
  toolBatches: z.array(toolBatchReceiptSchema).max(100000).default([]),
  candidateDiscovery: z.object({ revision: rev, complete: z.boolean() }).strict().optional(),
  recoveredFrom: z.object({ scope: syncScopeSchema, ownerKey: z.string().min(1).max(256), baseId: id, operationId: id,
    payloadHash: z.string().regex(/^[a-f0-9]{64}$/), recoveryId: id }).strict().optional(),
  detachedCustody: z.array(detachedCustodySchema).max(32).default([]),
  version: z.literal(1), baseId: id, cloudState: z.enum(["local-only", "synced", "mirror"]),
  scope: syncScopeSchema.nullable(), confirmed: confirmedBaseSchema.nullable(),
  pendingOperations: z.array(pendingOperationSchema).max(4096),
  conflictCandidates: z.array(candidateSchema).max(4096), receipts: z.array(baseReceiptSchema).max(100000),
  tombstones: z.array(z.string().min(1).max(384)).max(20000), cursor: id.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.promotionExport && (value.cloudState === "local-only" || value.confirmed?.meta.owner.kind !== "chat" && !value.remoteOwnershipTransfer)) ctx.addIssue({ code: "custom", message: "Base promotion export is inconsistent" });
  if (value.remoteOwnershipTransfer && (value.cloudState === "local-only" || value.ownershipTransfer ||
      value.baseId !== value.remoteOwnershipTransfer.baseId || value.confirmed?.meta.owner.kind !== "project" ||
      value.confirmed.meta.owner.projectId !== value.remoteOwnershipTransfer.projectId || value.confirmed.cloudRevision < value.remoteOwnershipTransfer.revision)) ctx.addIssue({ code: "custom", message: "Remote Base ownership evidence is inconsistent" });
  if (value.ownershipTransfer && (value.cloudState === "local-only" || value.baseId !== value.ownershipTransfer.proof.baseId ||
      value.confirmed?.meta.owner.kind !== "project" || value.confirmed.meta.owner.projectId !== value.ownershipTransfer.proof.projectId ||
      value.confirmed.cloudRevision < value.ownershipTransfer.proof.revision)) ctx.addIssue({ code: "custom", message: "Base ownership proof is inconsistent" });
  if (value.cloudState === "local-only" && (value.scope || value.confirmed || value.pendingOperations.length || value.receipts.length || value.cursor) ||
      value.cloudState !== "local-only" && (!value.scope || !value.confirmed)) ctx.addIssue({ code: "custom", message: "Base synchronization mode is inconsistent" });
  const operationIds = value.pendingOperations.map(operation => operation.operationId);
  if (new Set(value.toolBatches.map(item => item.operationId)).size !== value.toolBatches.length) ctx.addIssue({ code: "custom", message: "Duplicate Base tool operation identity" });
  if (new Set(operationIds).size !== operationIds.length) ctx.addIssue({ code: "custom", message: "Duplicate pending operation identity" });
  for (const operation of value.pendingOperations) {
    if (operation.baseId !== value.baseId || operation.payloadHash !== operationHash(operation)) ctx.addIssue({ code: "custom", message: "Base operation digest mismatch" });
    if (operation.encryptedTransport && (!operation.sealed || operation.encryptedTransport.plaintextHash !== operation.payloadHash ||
      operation.encryptedTransport.commit.operationId !== operation.operationId || operation.encryptedTransport.commit.baseId !== operation.baseId)) ctx.addIssue({ code: "custom", message: "Base ciphertext identity mismatch" });
  }
  for (const candidate of value.conflictCandidates) {
    const permanentlyDeleted = candidate.blockedReason === "tombstone" && candidate.operation.state === "blocked" &&
      candidate.operation.patches.some(patch => isBasePatchDeleted(value.tombstones, patch));
    if (candidate.operation.baseId !== value.baseId || candidate.operation.payloadHash !== operationHash(candidate.operation) ||
      (candidate.receipt === null) !== Boolean(candidate.blockedReason) || (!candidate.receipt && candidate.operation.sealed && !permanentlyDeleted)) ctx.addIssue({ code: "custom", message: "Base candidate evidence mismatch" });
  }
});
export type BaseSyncEnvelope = z.infer<typeof baseSyncEnvelopeSchema>;
export function candidatePatchIndexes(candidate: BaseSyncEnvelope["conflictCandidates"][number]) {
  return candidate.unresolvedIndexes ?? candidate.operation.patches.flatMap((_, index) =>
    !candidate.receipt || ["conflicted", "rejected"].includes(candidate.receipt.results[index]!.status) ? [index] : []);
}
export type BaseSyncIntent = { operationId?: string; patches?: BasePatch[]; atomicGroup?: string; batchId?: string };
export function operationHash(operation: Omit<PendingBaseOperation, "payloadHash"> | PendingBaseOperation) {
  const { sealed: _sealed, attempts: _attempts, state: _state, encryptionCapture: _capture, encryptedTransport: _transport, ...payload } = operation;
  delete (payload as Partial<PendingBaseOperation>).payloadHash;
  return createHash("sha256").update(canonicalJson(payload)).digest("hex");
}
export function nativeBaseOperation(operation: PendingBaseOperation) {
  const { sealed: _sealed, attempts: _attempts, state: _state, encryptionCapture: _capture, encryptedTransport: _transport, ...payload } = operation;
  return baseOperationSchema.parse(payload);
}
export function emptyBaseSync(baseId: string): BaseSyncEnvelope {
  return { toolBatches: [], detachedCustody: [], version: 1, baseId, cloudState: "local-only", scope: null, confirmed: null,
    pendingOperations: [], conflictCandidates: [], receipts: [], tombstones: [], cursor: null };
}
