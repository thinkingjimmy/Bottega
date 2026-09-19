/**
 * [INPUT]: Depends on bounded account identities, Agent selection and existing App disclosure types.
 * [OUTPUT]: Defines bounded catalog, source review, consent, local removal, all-device deletion, retained-file reveal and original recovery IPC.
 * [POS]: Main/preload/renderer contract; source bytes, transport and filesystem paths remain in main.
 */
import { z } from "zod";
import { agentBackendIdSchema } from "../../agent-schema";
import type { AppConfigValue, AppExtensionInstallPreflight, AppManifest } from "../../apps-ipc";
import type { AppCompatibilityBlocked } from "../../app-host/contract";
const id = z.string().min(1).max(192);
export const cloudAppsAccountSchema = z.object({ expectedUserId: id }).strict();
export const cloudAppRequestSchema = cloudAppsAccountSchema.extend({ appId: z.string().regex(/^[a-z0-9]{10}$/) }).strict();
export const cloudAppTokenSchema = cloudAppsAccountSchema.extend({ requestId: id }).strict();
export const cloudAppDeleteConfirmSchema = cloudAppTokenSchema.extend({ retainBase: z.boolean() }).strict();
export const cloudAppDeleteReviewSchema = z.object({ requestId: id, appId: id, name: z.string().max(120), revision: z.number().int().nonnegative() }).strict();
export const cloudAppDeleteResultSchema = z.enum(["deleted", "conflicted", "blocked", "review-expired"]);
export const cloudAppOriginSchema = z.object({ appId: id, name: z.string().max(512), deleted: z.boolean() }).strict().nullable();
export type CloudAppDeleteReview = z.infer<typeof cloudAppDeleteReviewSchema>;
export const cloudAppRemoveLocalSchema = cloudAppRequestSchema.extend({ requestId: id,
  generationId: id, bindingRevision: z.number().int().nonnegative(),
}).strict();
export const cloudAppConfirmSchema = cloudAppTokenSchema.extend({
  agent: agentBackendIdSchema,
  authorization: z.object({ scope: z.literal("studio-only"), decision: z.literal("approve-requested") }).strict(),
  config: z.object({ values: z.record(z.string().min(1).max(128), z.string().max(8192)).refine(value => Object.keys(value).length <= 16),
    agentReadableKeys: z.array(z.string().min(1).max(128)).max(16) }).strict(),
}).strict();
export const cloudAppCatalogSchema = z.object({ items: z.array(z.object({ appId: id, projectId: id, baseId: id, name: z.string().max(512),
  packageRevision: z.number().int().positive().nullable(), installedPackageRevision: z.number().int().positive().nullable(),
  coverage: z.enum(["base-only", "partial"]), state: z.enum(["not-installed", "installed", "update-available", "preparing", "failed", "deleted"]),
  baseReady: z.boolean(), requestId: id.nullable(), canCancel: z.boolean(),
  localInstallation: z.object({ generationId: id, bindingRevision: z.number().int().nonnegative() }).strict().nullable(),
  removalRequestId: id.nullable(), hasRetainedFiles: z.boolean(),
  deletion: z.object({ requestId: id, status: z.enum(["pending", "confirmed", "conflicted", "blocked"]), retainBase: z.boolean() }).strict().nullable(),
}).strict()).max(1000) }).strict();
export type CloudAppCatalog = z.infer<typeof cloudAppCatalogSchema>;
export type CloudAppReview = { requestId: string; appId: string; name: string; packageRevision: number; update: boolean;
  coverage: "base-only" | "partial"; manifest: AppManifest; readme: string; readmeZh: string;
  cliStatuses: Array<{ id: string; detectable: boolean; installed: boolean }>;
  extensions: AppExtensionInstallPreflight[]; config: AppConfigValue };
export const CLOUD_APPS_CHANNEL = { catalog: "cloud-apps:catalog", origin: "cloud-apps:origin", review: "cloud-apps:review", confirm: "cloud-apps:confirm",
  discard: "cloud-apps:discard", retry: "cloud-apps:retry", cancel: "cloud-apps:cancel", changed: "cloud-apps:changed",
  removeLocal: "cloud-apps:remove-local", retryRemoval: "cloud-apps:retry-removal", openRetained: "cloud-apps:open-retained",
  reviewDeletion: "cloud-apps:review-deletion", confirmDeletion: "cloud-apps:confirm-deletion", retryDeletion: "cloud-apps:retry-deletion",
  discardDeletion: "cloud-apps:discard-deletion", dismissDeletion: "cloud-apps:dismiss-deletion" } as const;
export interface CloudAppsBridge {
  catalog(input: z.infer<typeof cloudAppsAccountSchema>): Promise<CloudAppCatalog>;
  origin(input: z.infer<typeof cloudAppRequestSchema>): Promise<z.infer<typeof cloudAppOriginSchema>>;
  review(input: z.infer<typeof cloudAppRequestSchema>): Promise<CloudAppReview | AppCompatibilityBlocked>;
  confirm(input: z.infer<typeof cloudAppConfirmSchema>): Promise<void>;
  discard(input: z.infer<typeof cloudAppTokenSchema>): Promise<void>;
  retry(input: z.infer<typeof cloudAppTokenSchema>): Promise<void>;
  cancel(input: z.infer<typeof cloudAppTokenSchema>): Promise<void>;
  removeLocal(input: z.infer<typeof cloudAppRemoveLocalSchema>): Promise<void>;
  retryRemoval(input: z.infer<typeof cloudAppTokenSchema>): Promise<void>;
  openRetained(input: z.infer<typeof cloudAppRequestSchema>): Promise<void>;
  reviewDeletion(input: z.infer<typeof cloudAppRequestSchema>): Promise<CloudAppDeleteReview>;
  confirmDeletion(input: z.infer<typeof cloudAppDeleteConfirmSchema>): Promise<z.infer<typeof cloudAppDeleteResultSchema>>;
  retryDeletion(input: z.infer<typeof cloudAppTokenSchema>): Promise<z.infer<typeof cloudAppDeleteResultSchema>>;
  discardDeletion(input: z.infer<typeof cloudAppTokenSchema>): Promise<void>;
  dismissDeletion(input: z.infer<typeof cloudAppTokenSchema>): Promise<void>;
  onChanged(listener: () => void): () => void;
}
