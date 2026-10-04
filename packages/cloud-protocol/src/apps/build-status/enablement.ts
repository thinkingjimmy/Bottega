/**
 * [INPUT]: Depends on Zod and the canonical App identity.
 * [OUTPUT]: Provides bounded App disable previews and revision-checked enablement commands.
 * [POS]: Owner-executed App availability contract shared by desktop, Web and mobile.
 */
import { z } from "zod";
import { appIdSchema } from "../model";

export const appDisableImpactSchema = z.object({
  appId: appIdSchema,
  enabled: z.boolean(),
  revision: z.number().int().nonnegative(),
  runningCount: z.number().int().nonnegative(),
  runningChats: z.array(z.object({ id: z.string().min(1).max(128), title: z.string().max(80) }).strict()).max(8),
  queuedMessages: z.number().int().nonnegative(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict();
export type AppDisableImpact = z.infer<typeof appDisableImpactSchema>;
export const setAppEnabledInputSchema = z.object({
  appId: appIdSchema, enabled: z.boolean(), expectedRevision: z.number().int().nonnegative(),
  impactDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
}).strict().refine(value => value.enabled || value.impactDigest !== undefined, "disable-requires-impact");
export type SetAppEnabledInput = z.infer<typeof setAppEnabledInputSchema>;
