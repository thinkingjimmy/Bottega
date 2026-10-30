/**
 * [INPUT]: Depends on portable custom instances, Dock declarations, narrow quick-entry identities and trusted operation/name schemas.
 * [OUTPUT]: Provides fixed Dock-to-Settings entries, host instance forms, explicit local mutations and stable results.
 * [POS]: Main-window management boundary; callers cannot choose a package, generation or data grant.
 */
import {z} from 'zod';
import {dockContributionSchema} from '@bottega/contracts/plugins/dock/manifest';
import {widgetNameSchema} from '@bottega/contracts/plugins/dock/settings';
import {customDockWidgetSchema} from './instance';
import {widgetInstanceIdSchema} from './entry';
export {dockWidgetEntrySchema,widgetInstanceIdSchema} from './entry';
export type {DockWidgetEntry} from './entry';
const operationId=z.string().regex(/^[A-Za-z0-9_-]{8,128}$/);
export const savedWidgetQuerySchema=z.object({definitionId:z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/),sourceInstallationId:z.string().regex(/^[A-Za-z0-9_.-]{1,128}$/).optional()}).strict();
export const widgetInstanceQuerySchema=z.object({itemId:widgetInstanceIdSchema}).strict();
export const widgetInstancePauseSchema=z.object({operationId,itemId:widgetInstanceIdSchema,paused:z.boolean(),expectedRevision:z.number().int().nonnegative()}).strict();
export const widgetBaseRevokeSchema=z.object({operationId,itemId:widgetInstanceIdSchema,expectedRevision:z.number().int().nonnegative()}).strict();
export const widgetInstanceRemoveSchema=z.object({operationId,itemId:widgetInstanceIdSchema,expectedLayoutRevision:z.number().int().nonnegative()}).strict();
export const widgetInstanceFormSchema=z.object({previewId:z.string().regex(/^[a-f0-9]{32}$/),itemId:widgetInstanceIdSchema.nullable(),name:widgetNameSchema,widget:customDockWidgetSchema,
 dock:dockContributionSchema,layoutRevision:z.number().int().nonnegative(),mappingRevision:z.number().int().nonnegative().nullable(),baseAuthorized:z.boolean().default(false)}).strict();
export const widgetInstanceReceiptSchema=z.object({operationId,itemId:widgetInstanceIdSchema,status:z.enum(['applied','pending','conflict'])}).strict();
export type WidgetInstanceForm=z.infer<typeof widgetInstanceFormSchema>;
export type WidgetInstanceReceipt=z.infer<typeof widgetInstanceReceiptSchema>;
