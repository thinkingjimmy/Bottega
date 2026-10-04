/**
 * [INPUT]: Depends on portable classification, confirmed heads and deterministic operation hashes.
 * [OUTPUT]: Defines owner-fenced lifecycle CAS operations, optional atomic Base promotion, explicit Project rescue and immutable receipts.
 * [POS]: Dedicated classification contract; local context, paths and grants never enter its payload.
 */
import { z } from "zod";
import { cloudIdSchema as id } from "../auth";
import { canonicalJson } from "../encryption/encoding";
import { versionSchema as rev } from "../scalars";
import { hashBytes } from "../blobs/transfer";
import { classificationSchema, cloudChatHeadSchema } from "./model";
import { basePromotionSchema, basePromotionProofSchema } from "../apps/promotion";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const projectRescueSchema = z.object({ projectId: id }).strict();
export const chatClassificationOperationSchema = z.object({
  lifecycleOperationId: id, chatId: id, incarnationId: id, candidateHash: hash, payloadHash: hash,
  expectedRevision: rev.positive(),
  previous: classificationSchema, next: classificationSchema,
  basePromotion: basePromotionSchema.optional(),
  projectRescue: projectRescueSchema.optional(),
}).strict().refine(value => !value.projectRescue || !value.basePromotion &&
  value.previous.projectId === value.projectRescue.projectId && value.next.conversationKind === "ordinary" &&
  value.next.projectId === null && value.next.appId === null, "Project rescue must release the original Project into an ordinary root Chat");
export type ChatClassificationOperation = z.infer<typeof chatClassificationOperationSchema>;
export const chatClassificationReceiptSchema = z.object({
  lifecycleOperationId: id, chatId: id, candidateHash: hash, payloadHash: hash,
  expectedRevision: rev.positive(), status: z.enum(["applied", "conflicted", "fenced", "deleted"]),
  head: cloudChatHeadSchema.nullable(), sourceDeviceId: id, createdAt: rev,
  basePromotion: basePromotionProofSchema.optional(),
}).strict().refine(value => (value.status === "deleted") === (value.head === null));
export type ChatClassificationReceipt = z.infer<typeof chatClassificationReceiptSchema>;
export function hashChatClassificationOperation(input: ChatClassificationOperation) {
  const { payloadHash: _hash, ...operation } = chatClassificationOperationSchema.parse(input);
  return hashBytes(new TextEncoder().encode(canonicalJson(operation)));
}
