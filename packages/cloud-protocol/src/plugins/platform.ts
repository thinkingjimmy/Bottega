/**
 * [INPUT]: Public unified plugin contracts and Zod.
 * [OUTPUT]: Unified catalog/package offers, modes and persistent member transport contracts.
 * [POS]: Desktop, isolated Surface, Web and Cloud protocol-26 shared plugin boundary.
 */
import { z } from "zod";
import { pluginDigestSchema, pluginIdentitySchema, unifiedPluginTargetSchema } from "@bottega/contracts/plugins/platform";
export * from "@bottega/contracts/plugins/platform";
export const unifiedPluginPackageOfferSchema = z.object({
  pluginId: pluginIdentitySchema, revisionId: pluginDigestSchema, packageDigest: pluginDigestSchema,
  ownerDeviceId: z.string().min(1).max(256), bytes: z.number().int().nonnegative().max(256 * 1024 * 1024),
  target: unifiedPluginTargetSchema, createdAt: z.number().int().nonnegative(),
}).strict();
export type UnifiedPluginPackageOffer = z.infer<typeof unifiedPluginPackageOfferSchema>;
