/**
 * [INPUT]: Depends on strict Zod validation and the portable Base owner-key vocabulary.
 * [OUTPUT]: Provides bounded host-only Base/field directory requests and readonly choices without row data or permission.
 * [POS]: Main-window Widget configuration metadata; author surfaces cannot access this directory.
 */
import {z} from 'zod';
import {BASE_OWNER_KEY_PATTERN} from '@bottega/contracts/core/owner-key';
export const widgetBaseDirectoryRequestSchema=z.object({query:z.string().max(80).optional()}).strict();
const entity=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const widgetBaseDirectorySchema=z.object({choices:z.array(z.object({ownerKey:z.string().regex(BASE_OWNER_KEY_PATTERN),ownerInstanceId:entity,name:z.string().min(1).max(200),fields:z.array(z.object({id:entity,name:z.string().min(1).max(200),type:z.enum(['text','number','date','select','checkbox','url'])}).strict()).max(64)}).strict()).max(100),truncated:z.boolean()}).strict();
export type WidgetBaseDirectory=z.infer<typeof widgetBaseDirectorySchema>;
export type WidgetBaseDirectoryRequest=z.infer<typeof widgetBaseDirectoryRequestSchema>;
