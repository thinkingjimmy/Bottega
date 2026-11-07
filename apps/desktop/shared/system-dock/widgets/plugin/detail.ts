/**
 * [INPUT]: Bounded API field declarations and reading states.
 * [OUTPUT]: Optional scalar native detail for unified Widget summary results.
 * [POS]: Shared host-rendered detail contract; plugin data never supplies executable UI.
 */
import {z} from 'zod';
import {dockApiResponseSchema} from '@bottega/contracts/plugins/dock/api';
import {dockReadingStateSchema,dockTimeZoneSchema} from '@bottega/contracts/plugins/dock/data';
export const pluginWidgetDetailSchema=z.object({id:z.string().min(1).max(64),kind:z.literal('api'),label:z.string().max(160),
 reading:z.object({state:dockReadingStateSchema,updatedAt:z.number().finite().nullable(),values:z.record(z.string().max(64),z.union([z.string().max(1024),z.number().finite(),z.boolean(),z.null()])).refine(value=>Object.keys(value).length<=32)}).strict(),
 fields:dockApiResponseSchema.options[0].shape.fields,
 attribution:z.object({label:z.string().max(160),url:z.string().url().refine(value=>value.startsWith('https://'))}).strict().optional(),timeZone:dockTimeZoneSchema.optional(),
}).strict();
export type PluginWidgetDetail= z.infer<typeof pluginWidgetDetailSchema>;
