/**
 * [INPUT]: Depends only on Zod; imports no plugin manifest, lifecycle, catalog or delivery schemas.
 * [OUTPUT]: Provides portable plugin identities, tool/native selections and immutable Chat mode snapshots.
 * [POS]: Lightweight shared selection leaf for Chat persistence, encrypted sync and history workers.
 */
import { z } from "zod";
export const pluginIdentitySchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const pluginDigestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const pluginNativeRequirementsSchema = z.object({
  readOnly: z.boolean().optional(), toolSelection: z.boolean().optional(),
}).strict();
export const pluginToolSelectionSchema = z.object({
  plugins: z.array(pluginIdentitySchema).max(256).default([]),
  tools: z.array(z.string().min(1).max(256)).max(512).default([]),
}).strict();
export const pluginModeSelectionSchema = z.object({
  id: pluginIdentitySchema, pluginId: pluginIdentitySchema.optional(), name: z.string().min(1).max(160),
  prompt: z.string().max(65_536).optional(), tools: pluginToolSelectionSchema.optional(),
  nativeRequirements: pluginNativeRequirementsSchema.optional(),
}).strict();
