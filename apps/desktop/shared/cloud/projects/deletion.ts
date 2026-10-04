/**
 * [INPUT]: Depends on closed Project identities, portable metadata and content hashes.
 * [OUTPUT]: Defines bounded deletion candidates, fresh reviews and explicit keep/reviewed-delete decisions.
 * [POS]: Main-frame Project recovery contract; paths, Store envelopes and authentication remain private.
 */
import { z } from "zod";
import { cloudIdSchema, sha256Schema } from "@ai-chat/cloud-protocol";
const id = cloudIdSchema, revision = z.number().int().nonnegative().safe();
export const projectDeletionCandidateSchema = z.object({ projectId: id, name: z.string().max(100), state: z.enum(["pending", "conflicted", "kept", "deleted"]),
  candidateHash: sha256Schema, proposedNames: z.array(z.string().max(100)).max(20) }).strict();
export const projectDeletionCatalogRequestSchema = z.object({ afterId: id.nullable() }).strict();
export const projectDeletionCatalogSchema = z.object({ items: z.array(projectDeletionCandidateSchema).max(20), cursor: id.nullable(), complete: z.boolean() }).strict();
export const projectDeletionIdentitySchema = z.object({ projectId: id }).strict();
export const projectDeletionReviewSchema = z.object({ projectId: id, candidateHash: sha256Schema, reviewHash: sha256Schema, name: z.string().max(100), revision }).strict();
export const projectDeletionDecisionSchema = z.object({ review: projectDeletionReviewSchema, decisionId: z.string().uuid(), action: z.enum(["keep", "delete"]) }).strict();
export type ProjectDeletionCandidate = z.infer<typeof projectDeletionCandidateSchema>;
export type ProjectDeletionCatalog = z.infer<typeof projectDeletionCatalogSchema>;
export type ProjectDeletionReview = z.infer<typeof projectDeletionReviewSchema>;
export type ProjectDeletionDecision = z.infer<typeof projectDeletionDecisionSchema>;
