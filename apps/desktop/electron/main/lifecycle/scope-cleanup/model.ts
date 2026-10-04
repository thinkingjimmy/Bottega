/**
 * [INPUT]: Depends on strict storage scope and frozen owner identities
 * [OUTPUT]: Provides the complete ordered cleanup participants (ending with account-config), the version-1/version-2 plan codec and checkpoint receipt codecs
 * [POS]: Durable input contract owned by the existing lifecycle journal
 */
import { z } from "zod";
import { storageIdSchema as id, storageHashSchema as hash, syncScopeSchema } from "../../../../shared/local-storage/contracts";
/* Version 1 plans (six owners) were written by released builds and still sit in journals; they parse unchanged and
   resume through the complete current list, so the appended account-config step also runs for them. Nothing is
   dropped and nothing is rewritten in place (INV-17). New plans are version 2. */
const LEGACY_PARTICIPANTS = ["homes", "blobs", "bases", "projects", "apps", "chats"] as const;
export const CLEANUP_PARTICIPANTS = [...LEGACY_PARTICIPANTS, "account-config"] as const;
export const SCOPE_CLEANUP_PLAN_VERSION = 2;
const planFields = {
  operationId: id, scope: syncScopeSchema,
  chats: z.array(z.object({ chatId: id, incarnationId: id, retain: z.boolean(), homeIntentId: id.nullable() }).strict()).max(10000),
  bases: z.array(z.object({ ownerKey: z.string().regex(/^(chat|project):[A-Za-z0-9_-]{1,128}$/), ownerInstanceId: id, retain: z.boolean() }).strict()).max(10000),
  projectIds: z.array(id).max(10000), appIds: z.array(id).max(1000),
  discardedProjectIds: z.array(id).max(10000).optional(), discardedAppIds: z.array(id).max(1000).optional(),
  retainedBlobs: z.array(z.object({ owner: z.string().min(1).max(384), blobId: z.string().min(1).max(192), sha256: hash }).strict()).max(100000),
};
const legacy = [z.literal("homes"), z.literal("blobs"), z.literal("bases"), z.literal("projects"), z.literal("apps"), z.literal("chats")] as const;
export const scopeCleanupPlanSchema = z.discriminatedUnion("version", [
  z.object({ version: z.literal(1), ...planFields, participants: z.tuple(legacy) }).strict(),
  z.object({ version: z.literal(SCOPE_CLEANUP_PLAN_VERSION), ...planFields, participants: z.tuple([...legacy, z.literal("account-config")]) }).strict(),
]).superRefine((plan, ctx) => {
  for (const ids of [plan.chats.map(item => item.chatId), plan.bases.map(item => item.ownerKey),
    [...plan.projectIds, ...(plan.discardedProjectIds ?? [])], [...plan.appIds, ...(plan.discardedAppIds ?? [])]]) {
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Duplicate cleanup owner" });
  }
});
export type ScopeCleanupPlan = z.infer<typeof scopeCleanupPlanSchema>;
export type CleanupParticipant = typeof CLEANUP_PARTICIPANTS[number];
export const cleanupCheckpointSchema = z.object({ operationId: id, participant: z.enum(CLEANUP_PARTICIPANTS),
  planHash: hash, evidenceHash: hash, state: z.literal("complete") }).strict();
export type CleanupCheckpoint = z.infer<typeof cleanupCheckpointSchema>;
