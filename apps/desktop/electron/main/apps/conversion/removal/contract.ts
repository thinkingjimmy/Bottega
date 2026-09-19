/**
 * [INPUT]: Depends on bounded App identities and the existing local sync scope contract.
 * [OUTPUT]: Defines immutable local removal and confirmed cloud-deletion retirement inputs.
 * [POS]: Installation retirement journal contract; it grants no cloud mutation or Base ownership authority.
 */
import { z } from "zod";
import { syncScopeSchema } from "../../../../../shared/local-storage/contracts";
import { appDeletionSchema } from "@ai-chat/cloud-protocol/apps/model";
export const localAppRemovalSchema = z.object({
  scope: syncScopeSchema, appId: z.string().regex(/^[a-z0-9]{10}$/),
  generationId: z.string().min(1).max(192), bindingRevision: z.number().int().nonnegative(),
}).strict();
export type LocalAppRemoval = z.infer<typeof localAppRemovalSchema>;
export const cloudAppRetirementSchema = localAppRemovalSchema.extend({
  generationId: localAppRemovalSchema.shape.generationId.nullable(), deletion: appDeletionSchema,
}).refine(value => value.appId === value.deletion.appId);
export type CloudAppRetirement = z.infer<typeof cloudAppRetirementSchema>;
export const appRemovalSchema = z.union([localAppRemovalSchema, cloudAppRetirementSchema]);
export type AppRemoval = z.infer<typeof appRemovalSchema>;
export const APP_REMOVAL_PHASES = ["proposed", "admitted", "verified", "admission-closed", "source-retained", "turns-drained", "chats-retained",
  "builds-settled", "generations-retired", "grants-settled", "workspace-retained", "data-retained", "record-removed"] as const;
