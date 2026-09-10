/**
 * [INPUT]: Depends on strict storage scope and frozen owner identities
 * [OUTPUT]: Provides the complete ordered cleanup plan and checkpoint receipt codecs
 * [POS]: Durable input contract owned by the existing lifecycle journal
 */
import { z } from "zod";
import { storageIdSchema as id, storageHashSchema as hash, syncScopeSchema } from "../../../../shared/local-storage/contracts";
export const CLEANUP_PARTICIPANTS = ["homes", "blobs", "bases", "projects", "apps", "chats"] as const;
export const scopeCleanupPlanSchema = z.object({
  version: z.literal(1), operationId: id, scope: syncScopeSchema,
  chats: z.array(z.object({ chatId: id, incarnationId: id, retain: z.boolean(), homeIntentId: id.nullable() }).strict()).max(10000),
  bases: z.array(z.object({ ownerKey: z.string().regex(/^(chat|project):[A-Za-z0-9_-]{1,128}$/), ownerInstanceId: id, retain: z.literal(true) }).strict()).max(10000),
  projectIds: z.array(id).max(10000), appIds: z.array(id).max(1000),
  retainedBlobs: z.array(z.object({ owner: z.string().min(1).max(384), blobId: z.string().min(1).max(192), sha256: hash }).strict()).max(100000),
  participants: z.tuple([z.literal("homes"), z.literal("blobs"), z.literal("bases"), z.literal("projects"), z.literal("apps"), z.literal("chats")]),
}).strict().superRefine((plan, ctx) => {
  for (const ids of [plan.chats.map(item => item.chatId), plan.bases.map(item => item.ownerKey), plan.projectIds, plan.appIds]) {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Duplicate cleanup owner" });
  }
});
export type ScopeCleanupPlan = z.infer<typeof scopeCleanupPlanSchema>;
export type CleanupParticipant = typeof CLEANUP_PARTICIPANTS[number];
export const cleanupCheckpointSchema = z.object({ operationId: id, participant: z.enum(CLEANUP_PARTICIPANTS),
  planHash: hash, evidenceHash: hash, state: z.literal("complete") }).strict();
export type CleanupCheckpoint = z.infer<typeof cleanupCheckpointSchema>;
