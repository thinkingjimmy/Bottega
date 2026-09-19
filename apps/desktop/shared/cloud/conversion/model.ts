/**
 * [INPUT]: Depends on bounded portable classification and explicit account identity schemas.
 * [OUTPUT]: Defines bounded Save as App, Project Base and Project Chat rescue reviews and explicit keep-original IPC decisions.
 * [POS]: Credential-free main/preload/renderer contract; no operation payloads or local authority are exposed.
 */
import { z } from "zod";
import { classificationSchema } from "@ai-chat/cloud-protocol/chats/model";
const id = z.string().min(1).max(192);
export const conversionRequestSchema = z.object({ expectedUserId: id, chatId: id }).strict();
export const keepOriginalSchema = conversionRequestSchema.extend({ intentId: id, candidateHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export const conversionReviewSchema = z.object({ intentId: id, state: z.enum(["pending", "conflicted", "confirmed"]),
  input: z.object({ chatId: id, requestId: id, name: z.string().min(1).max(120), icon: z.string().min(1).max(32) }).strict(),
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/).nullable(), previous: classificationSchema.nullable(),
  current: classificationSchema.nullable(), proposed: classificationSchema.nullable() }).strict();
export const projectPromotionReviewSchema = conversionReviewSchema.omit({ input: true }).extend({
  input: z.object({ chatId: id, requestId: id, projectId: id }).strict(),
}).strict();
export type ProjectPromotionReview = z.infer<typeof projectPromotionReviewSchema>;
export const projectRescueRequestSchema = z.object({ expectedUserId: id, projectId: id }).strict();
export const projectRescueReviewSchema = z.object({ items: z.array(projectPromotionReviewSchema.extend({ title: z.string().max(512) })).max(50), hasMore: z.boolean() }).strict();
export type ProjectRescueReview = z.infer<typeof projectRescueReviewSchema>;
export type ConversionReview = z.infer<typeof conversionReviewSchema>;
export const CONVERSION_CHANNEL = { review: "cloud-conversion:review", keepOriginal: "cloud-conversion:keep-original",
  projectReview: "cloud-conversion:project-review", keepProjectOriginal: "cloud-conversion:keep-project-original",
  rescueReview: "cloud-conversion:rescue-review", keepRescueOriginal: "cloud-conversion:keep-rescue-original" } as const;
export interface CloudConversionBridge {
  rescueReview(input: z.infer<typeof projectRescueRequestSchema>): Promise<ProjectRescueReview | null>;
  keepRescueOriginal(input: z.infer<typeof keepOriginalSchema>): Promise<void>;
  projectReview(input: z.infer<typeof conversionRequestSchema>): Promise<ProjectPromotionReview | null>;
  keepProjectOriginal(input: z.infer<typeof keepOriginalSchema>): Promise<void>;
  review(input: z.infer<typeof conversionRequestSchema>): Promise<ConversionReview | null>;
  keepOriginal(input: z.infer<typeof keepOriginalSchema>): Promise<void>;
}
