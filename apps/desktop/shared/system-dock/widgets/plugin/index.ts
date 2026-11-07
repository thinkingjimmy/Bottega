/**
 * [INPUT]: Depends on unified plugin identities and public Dock geometry.
 * [OUTPUT]: Provides portable unified plugin widget instances, configuration forms, layout CAS mutations and native card requests.
 * [POS]: Unified Dock contract; it carries separate plugin/contribution/instance identities and no source Project ownership.
 */
import { z } from "zod";
import { pluginIdentitySchema } from "@bottega/contracts/plugins/platform";
import { dockSizeSchema, type DockSummarySize } from "@bottega/contracts/plugins/dock/summary";
export const pluginDockWidgetSchema = z.object({ type: z.literal("plugin"), configVersion: z.literal(1), pluginId: pluginIdentitySchema,
  contributionId: pluginIdentitySchema, instanceId: pluginIdentitySchema, size: dockSizeSchema,
  configuration: z.record(z.string(), z.unknown()).refine(value => new TextEncoder().encode(JSON.stringify(value)).length <= 4096, "Instance configuration exceeds budget") }).strict();
export type PluginDockWidget = z.infer<typeof pluginDockWidgetSchema>;
export const pluginWidgetFormInputSchema = z.object({ pluginId: pluginIdentitySchema, contributionId: pluginIdentitySchema, itemId: pluginIdentitySchema.optional() }).strict();
export const savePluginWidgetSchema = pluginWidgetFormInputSchema.extend({ name: z.string().min(1).max(80).optional(), size: dockSizeSchema,
  configuration: z.record(z.string(), z.unknown()), expectedLayoutRevision: z.number().int().nonnegative() }).strict();
export const removePluginWidgetSchema = z.object({ itemId: pluginIdentitySchema, expectedLayoutRevision: z.number().int().nonnegative() }).strict();
export const pluginDockSurfaceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("open"), itemId: pluginIdentitySchema }).strict(),
  z.object({ kind: z.literal("call"), itemId: pluginIdentitySchema, leaseId: z.string().max(160), method: z.string().min(1).max(128), input: z.unknown() }).strict(),
  z.object({ kind: z.literal("release"), itemId: pluginIdentitySchema, leaseId: z.string().max(160) }).strict(),
]);
export type PluginWidgetForm = { pluginId: string; contributionId: string; itemId: string | null; name: string; settingsSchema: Record<string, unknown>;
  configuration: Record<string, unknown>; size: DockSummarySize; layoutRevision: number; customCard: boolean };
export type PluginWidgetReceipt = { itemId: string; layoutRevision: number };
