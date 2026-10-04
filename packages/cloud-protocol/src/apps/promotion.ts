/**
 * [INPUT]: Depends on bounded portable identities and Base revisions.
 * [OUTPUT]: Defines reviewed Chat-owned Base transfers and content-free confirmation proofs.
 * [POS]: Shared lifecycle payload; the original Base identity survives App or Project promotion.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { versionSchema as revision } from "../scalars";
import { appIdSchema } from "./model";
export const basePromotionSchema = z.object({ baseId: id, expectedRevision: revision,
  destination: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("project"), projectId: id }).strict(),
    z.object({ kind: z.literal("app"), projectId: id, appId: appIdSchema, displayName: z.string().trim().min(1).max(120) }).strict(),
  ]),
}).strict();
export type BasePromotion = z.infer<typeof basePromotionSchema>;
export const basePromotionProofSchema = z.object({ baseId: id, projectId: id, appId: appIdSchema.nullable(), revision }).strict();
export type BasePromotionProof = z.infer<typeof basePromotionProofSchema>;
export function matchesBasePromotionProof(operation: BasePromotion | undefined, proof: BasePromotionProof | undefined) {
  if (!operation) return proof === undefined;
  return Boolean(proof && proof.baseId === operation.baseId && proof.projectId === operation.destination.projectId &&
    proof.appId === (operation.destination.kind === "app" ? operation.destination.appId : null) && proof.revision === operation.expectedRevision + 1);
}
