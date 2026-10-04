/**
 * [INPUT]: Zod and bounded source identity metadata.
 * [OUTPUT]: Opaque PluginSource envelopes and format compatibility contracts.
 * [POS]: Plugin sources survive unknown formats without entering model submission DTOs.
 */
import { z } from 'zod';
export const PLUGIN_SOURCE_BYTES = 16 * 1024 * 1024;
export const PLUGIN_IMAGE_BYTES = 8 * 1024 * 1024;
export const PLUGIN_CHUNK_BYTES = 256 * 1024;
export const pluginDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const identity = z.string().min(1).max(160);
export const pluginSourceMetadataSchema = z.object({
  pluginId: identity, generationId: identity,
  format: z.object({ id: identity, version: z.number().int().positive() }).strict(),
  byteLength: z.number().int().min(1).max(PLUGIN_SOURCE_BYTES), sha256: pluginDigestSchema,
}).strict();
export const pluginSourceSchema = pluginSourceMetadataSchema.extend({ encoding: z.literal('base64'),
  bytes: z.string().max(Math.ceil(PLUGIN_SOURCE_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/).refine(value => value.length % 4 === 0),
}).strict();
export type PluginSourceMetadata = z.infer<typeof pluginSourceMetadataSchema>;
export type PluginSource = z.infer<typeof pluginSourceSchema>;
export type PluginSourceReader = Readonly<{ pluginId: string; format: { id: string; readableVersions: readonly number[] } }>;
export function pluginSourceEditable(source: PluginSourceMetadata, reader: PluginSourceReader): boolean {
  return source.pluginId === reader.pluginId && source.format.id === reader.format.id && reader.format.readableVersions.includes(source.format.version);
}
