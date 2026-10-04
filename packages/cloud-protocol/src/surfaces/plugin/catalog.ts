/**
 * [INPUT]: Depends on Zod and bounded composer/record contribution metadata.
 * [OUTPUT]: Provides RemotePluginCatalog with optional record actions and unchanged directory count/plaintext budgets.
 * [POS]: Encrypted catalog leaf shared by owner publication and local admission; data operations require a separate authorized transport.
 */
import { z } from "zod";
import { recordUiSchema } from "@bottega/contracts/plugins/records/definition";
const id = z.string().min(1).max(128);
export const REMOTE_PLUGIN_CATALOG_LIMITS={entries:64,plaintextBytes:48*1024} as const;
export const remotePluginCatalogSchema = z.array(z.object({ id, name: z.string().min(1).max(160), enabled: z.boolean(), error: z.string().max(500).nullable(), generationId: id.nullable(),
  composer: z.object({ id, title: z.string().min(1).max(160), icon: z.string().min(1).max(64) }).strict(),
  sourceFormat: z.object({ id, version: z.number().int().positive(), readableVersions: z.array(z.number().int().positive()).min(1).max(64) }).strict(),
  records: recordUiSchema.optional(),
}).strict()).max(REMOTE_PLUGIN_CATALOG_LIMITS.entries).refine(items => new Set(items.map(item => item.id)).size === items.length);
export type RemotePluginCatalog = z.infer<typeof remotePluginCatalogSchema>;
