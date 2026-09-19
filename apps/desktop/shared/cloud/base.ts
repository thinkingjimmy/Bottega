/**
 * [INPUT]: Depends on bounded shared Base synchronization display contracts and the explicit account identity.
 * [OUTPUT]: Defines fixed-purpose status, comparison, candidate-decision and named-copy IPC without raw operations or target allocation.
 * [POS]: Main/preload/renderer Base review boundary; renderer input never chooses a cloud scope or transport method.
 */
import { z } from "zod";
import { baseSyncIdentitySchema, baseSyncReviewSchema, baseCandidateDetailSchema } from "@ai-chat/base-ui/sync/model";
export { baseSyncReviewSchema, baseCandidateDetailSchema, baseSyncIdentitySchema };
const id = z.string().min(1).max(192);
const identity = baseSyncIdentitySchema.extend({ expectedUserId: id }).strict();
export const baseSyncReviewRequestSchema = identity.extend({ afterId: id.nullable() }).strict();
export const baseCandidateRequestSchema = identity.extend({ operationId: id, offset: z.number().int().min(0).max(512) }).strict();
export const baseCandidateDecisionSchema = identity.extend({ operationId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  action: z.enum(["restore", "discard"]) }).strict();
export const baseCandidateCopySchema = identity.extend({ operationId: id, payloadHash: z.string().regex(/^[a-f0-9]{64}$/), name: z.string().trim().min(1).max(100) }).strict();
export const BASE_SYNC_CHANNEL = { review: "cloud-base:review", detail: "cloud-base:detail", decide: "cloud-base:decide", copy: "cloud-base:copy", changed: "cloud-base:changed" } as const;
export interface CloudBaseBridge {
  review(input: z.infer<typeof baseSyncReviewRequestSchema>): Promise<z.infer<typeof baseSyncReviewSchema> | null>;
  detail(input: z.infer<typeof baseCandidateRequestSchema>): Promise<z.infer<typeof baseCandidateDetailSchema>>;
  decide(input: z.infer<typeof baseCandidateDecisionSchema>): Promise<void>;
  copy(input: z.infer<typeof baseCandidateCopySchema>): Promise<z.infer<typeof baseSyncIdentitySchema>>;
  onChanged(changed: () => void): () => void;
}
