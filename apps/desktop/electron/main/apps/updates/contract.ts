/**
 * [INPUT]: Strict Zod schemas and the shared preset update wire vocabulary.
 * [OUTPUT]: Signed descriptor and durable transaction schemas, instance fences and transaction types.
 * [POS]: Independent Base App update contract; no package, path or consent authority comes from the renderer.
 */
import { z } from "zod";
import type { AppRecord } from "../../../../shared/ipc/apps/apps-ipc";
import { appRecordSchema } from "../store/app-store-schema";
import { canonicalJson, sha256 } from "../support";
const digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const updateDescriptorSchema = z.object({
  schemaVersion: z.literal(1), presetId: z.enum(["expense-tracker", "fitness-log"]),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/).max(100),
  sourceCommitSha: z.string().regex(/^[a-f0-9]{40}$/), packageDigest: digest,
  publishedAt: z.number().int().nonnegative(), expiresAt: z.number().int().positive(),
}).strict();
export const signedUpdateSchema = z.object({ descriptor: updateDescriptorSchema }).strict();
export type SignedUpdate = z.infer<typeof signedUpdateSchema>;
export const transactionSchema = z.object({
  schemaVersion: z.literal(1), operationId: z.string().uuid(), appId: z.string().regex(/^[a-z0-9]{10}$/),
  descriptor: updateDescriptorSchema, descriptorDigest: digest, instanceFence: digest, sourceDigest: digest,
  previousStudioGrant: appRecordSchema.shape.studioGrant.optional(), originalActiveGenerationId: z.string().min(1),
  publicationFence: digest.optional(), promotionFence: digest.optional(), pendingGenerationId: z.string().min(1).optional(),
  activeGenerationId: z.string().min(1).optional(), expectedConsentRevision: z.number().int().nonnegative().optional(),
  state: z.enum(["frozen", "validated", "pending-built", "awaiting-consent", "consent-resolved", "committed", "post-commit", "pending-source-sync", "completed", "failed"]),
  userConsentAt: z.number().int().nonnegative().optional(), studioGranted: z.boolean().optional(),
  grantedCapabilities: z.array(z.string()).optional(), grantedHostActions: z.array(z.string()).optional(),
  grantedCapabilityScopes: z.record(z.string(), z.string()).optional(),
  pinUpdated: z.boolean().default(false), sourceSynced: z.boolean().default(false),
  ledgerFailed: z.boolean().default(false), ledgerError: z.string().optional(), error: z.string().optional(),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}).strict();
export type UpdateTransaction = z.infer<typeof transactionSchema>;
export function instanceFence(record: AppRecord) {
  return sha256(Buffer.from(canonicalJson({ id: record.id, origin: record.origin, presetId: record.presetId, pin: record.installedPresetPin,
    dir: record.dir, enabled: record.enabled, enabledRevision: record.enabledRevision, state: record.state,
    lifecycleRevision: record.lifecycleRevision, bindingRevision: record.bindingRevision, generationBinding: record.generationBinding,
    defaultGrantRevision: record.defaultGrantRevision, studioGrantRevision: record.studioGrantRevision,
    editableSource: record.editableSource })));
}

export function promotionFence(record: AppRecord) {
  return sha256(Buffer.from(canonicalJson({ id: record.id, presetId: record.presetId, origin: record.origin, dir: record.dir,
    installedPresetPin: record.installedPresetPin, active: record.generationBinding.active, lifecycleRevision: record.lifecycleRevision,
    bindingRevision: record.bindingRevision, generationBindingRevision: record.generationBinding.bindingRevision,
    pendingGenerationId: record.generationBinding.pending?.generationId, enabled: record.enabled,
    enabledRevision: record.enabledRevision, defaultGrantRevision: record.defaultGrantRevision, state: record.state })));
}
