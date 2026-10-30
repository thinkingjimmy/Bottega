/**
 * [INPUT]: Depends only on Zod and fixed Widget/instance identity grammars.
 * [OUTPUT]: Provides Widget instance IDs and closed Dock-to-Settings entry schemas/types.
 * [POS]: Narrow auxiliary intent leaf; ordinary Dock startup imports no host configuration or candidate form schema here.
 */
import {z} from 'zod';
export const widgetInstanceIdSchema=z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const dockWidgetEntrySchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('new')}).strict(),z.object({kind:z.literal('add'),definitionId:z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/).optional()}).strict(),
 z.object({kind:z.enum(['configure','edit','fork','versions','pause','remove']),itemId:widgetInstanceIdSchema}).strict(),
]);
export type DockWidgetEntry=z.infer<typeof dockWidgetEntrySchema>;
