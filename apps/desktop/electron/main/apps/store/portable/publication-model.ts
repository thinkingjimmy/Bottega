/**
 * [INPUT]: Depends on public App operations, source digests, logical files and stable scope identities.
 * [OUTPUT]: Defines immutable App identity proofs, acknowledged source baselines, package plans and durable delivery checkpoints.
 * [POS]: Outbound detail inside the sole AppStore catalog; no installation authority is derived from receipts.
 */
import { z } from "zod";
import { appOperationSchema, appReceiptSchema, packageCandidateInputSchema, verifiedAppSourceSchema } from "@ai-chat/cloud-protocol/apps/model";
import { MAX_BLOB_BYTES } from "@ai-chat/cloud-protocol";
import { sameScope, storageHashSchema, storageIdSchema, syncScopeSchema } from "../../../../../shared/local-storage/contracts";
import { confirmedBasePromotionSchema } from "../../../bases/store/promotion/cloud";
import { frozenAppOperationSchema } from "@ai-chat/cloud-protocol/apps/encrypted";
import { verifyFrozenAppOperation } from "@ai-chat/cloud-protocol/apps/encrypted/client";
import { encryptedFileDescriptorSchema } from "@ai-chat/cloud-protocol/blobs/encrypted";
export const appPublicationBaselineSchema = z.object({ revision: z.number().int().positive(), packageRevision: z.number().int().nonnegative(),
  manifestDigest: storageHashSchema.nullable(), sourcePackageDigest: storageHashSchema.nullable(),
}).strict().refine(value => value.packageRevision === 0 ? value.manifestDigest === null && value.sourcePackageDigest === null :
  value.manifestDigest !== null && value.sourcePackageDigest !== null);
export type AppPublicationBaseline = z.infer<typeof appPublicationBaselineSchema>;
export const appPublicationSchema = z.object({ scope: syncScopeSchema.nullable(), manifestId: storageIdSchema,
  promotion: confirmedBasePromotionSchema.optional(),
  association: z.object({ scope: syncScopeSchema, appId: storageIdSchema, projectId: storageIdSchema, baseId: storageIdSchema,
    revision: z.number().int().positive() }).strict().optional(),
  operation: appOperationSchema.options[0], source: verifiedAppSourceSchema.extend({
    generationId: storageIdSchema, sha256: storageHashSchema, bytes: z.number().int().nonnegative().max(MAX_BLOB_BYTES),
  }).strict().nullable(),
  baseline: appPublicationBaselineSchema.nullable().default(null),
  createReceipt: appReceiptSchema.nullable(), packageBlob: encryptedFileDescriptorSchema.nullable(),
  encryptedCreate: frozenAppOperationSchema.nullable().default(null), encryptedCandidate: frozenAppOperationSchema.nullable().default(null),
  packageOperationId: storageIdSchema.nullable().default(null),
  candidate: packageCandidateInputSchema.nullable(), publishReceipt: appReceiptSchema.nullable(),
  attempts: z.number().int().nonnegative(), state: z.enum(["pending", "blocked", "complete"]),
}).strict().superRefine((plan, ctx) => {
  try {
    if (plan.encryptedCreate) verifyFrozenAppOperation(plan.encryptedCreate, plan.operation);
    if (plan.encryptedCandidate) {
      if (!plan.candidate) throw new Error("Missing original candidate");
      verifyFrozenAppOperation(plan.encryptedCandidate, plan.candidate);
    }
    if (plan.candidate && plan.packageOperationId !== plan.candidate.operationId) throw new Error("Package identity changed");
  } catch { ctx.addIssue({ code: "custom", message: "App ciphertext binding changed" }); }
  const proof = plan.promotion;
  if (proof && (plan.operation.operationId !== proof.operation.lifecycleOperationId ||
      plan.operation.appId !== proof.receipt.basePromotion?.appId || plan.operation.projectId !== proof.receipt.basePromotion.projectId ||
      plan.operation.baseId !== proof.receipt.basePromotion.baseId || plan.createReceipt ||
      plan.scope && !sameScope(plan.scope, proof.scope))) {
    ctx.addIssue({ code: "custom", message: "App promotion publication changed" });
  }
  const association = plan.association;
  if (association && (plan.promotion || plan.createReceipt || plan.operation.appId !== association.appId ||
      plan.operation.projectId !== association.projectId || plan.operation.baseId !== association.baseId ||
      plan.scope && !sameScope(plan.scope, association.scope))) {
    ctx.addIssue({ code: "custom", message: "App publication association changed" });
  }
});
export type AppPublication = z.infer<typeof appPublicationSchema>;
