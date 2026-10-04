/**
 * [INPUT]: Zod and source size/digest identities.
 * [OUTPUT]: Strict bounded chunk transaction schemas with no caller-selected Chat identity.
 * [POS]: Surface messages remain below the 1 MiB RPC limit; host publication is atomic.
 */
import { z } from 'zod';
import { PLUGIN_CHUNK_BYTES, PLUGIN_IMAGE_BYTES, pluginDigestSchema, pluginSourceMetadataSchema } from './source';
const transactionId = z.string().uuid();
const image = z.object({ name: z.string().min(1).max(240).regex(/^[^/\\]+\.png$/i).refine(value => !value.includes("\0")), byteLength: z.number().int().min(8).max(PLUGIN_IMAGE_BYTES), sha256: pluginDigestSchema }).strict();
export const pluginTransferBeginSchema = z.object({
  kind: z.enum(['attachment', 'checkpoint', 'compute']).default('attachment'),
  source: pluginSourceMetadataSchema, image: image.optional(), replaceAttachmentId: z.string().min(1).max(160).optional(),
}).strict().superRefine((value, context) => {
  if (value.kind === 'attachment' ? !value.image : value.image !== undefined || value.replaceAttachmentId !== undefined)
    context.addIssue({ code: 'custom', message: 'Invalid transfer parts' });
});
export const pluginTransferChunkSchema = z.object({ transactionId, part: z.enum(['image', 'source']), offset: z.number().int().nonnegative(),
  bytes: z.string().min(4).max(Math.ceil(PLUGIN_CHUNK_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/).refine(value => value.length % 4 === 0),
}).strict();
export const pluginTransferEndSchema = z.object({ transactionId }).strict();
export const pluginSourceReadSchema = z.object({ sourceId: z.string().uuid(), offset: z.number().int().nonnegative(), length: z.number().int().positive().max(PLUGIN_CHUNK_BYTES) }).strict();
export type PluginTransferBegin = z.infer<typeof pluginTransferBeginSchema>;
export type PluginTransferChunk = z.infer<typeof pluginTransferChunkSchema>;
export type PluginTransferResult = { attachmentId: string } | { sourceId: string };
