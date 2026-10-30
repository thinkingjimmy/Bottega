/**
 * [INPUT]: Depends on existing built-in Widget schemas, provider identities and strict non-secret names.
 * [OUTPUT]: Provides bounded official configuration forms, metadata-only quota choices and explicit host submissions.
 * [POS]: Main-window official instance contract; it grants no plugin, package or data capability.
 */
import {z} from 'zod';
import {widgetNameSchema} from '@bottega/contracts/plugins/dock/settings';
import {agentBackendIdSchema} from '../../platform/agent-schema';
import {USAGE_QUERY_TARGETS} from '../../ipc/settings/usage-ipc';
import {aiLimitsWidgetSchema,aiActivityWidgetSchema,tasksWidgetSchema} from '../layout';
import {widgetInstanceIdSchema} from './management';
export const officialWidgetSchema=z.union([aiLimitsWidgetSchema,aiActivityWidgetSchema,tasksWidgetSchema]);
export type OfficialWidget=z.infer<typeof officialWidgetSchema>;
export const officialWidgetQuerySchema=z.union([
 z.object({itemId:widgetInstanceIdSchema}).strict(),z.object({definitionId:z.enum(['builtin.ai-limits','builtin.ai-activity','builtin.tasks'])}).strict(),
]);
const pool=z.object({id:z.string().min(1).max(256),label:z.string().max(256).nullable(),isGeneral:z.boolean(),windows:z.array(z.object({id:z.string().min(1).max(256),windowDurationMins:z.number().positive().nullable(),calendarPeriod:z.literal('month').optional()}).strict()).max(16)}).strict();
export const officialWidgetFormSchema=z.object({previewId:z.string().regex(/^[a-f0-9]{32}$/),itemId:widgetInstanceIdSchema.nullable(),name:widgetNameSchema,widget:officialWidgetSchema,
 layoutRevision:z.number().int().nonnegative(),configurable:z.array(agentBackendIdSchema).max(16),sources:z.array(z.enum(USAGE_QUERY_TARGETS)).max(16),
 agents:z.array(z.object({backend:agentBackendIdSchema,pools:z.array(pool).max(16)}).strict()).max(16)}).strict();
export const submitOfficialWidgetSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),previewId:z.string().regex(/^[a-f0-9]{32}$/),name:widgetNameSchema,widget:officialWidgetSchema}).strict();
export type OfficialWidgetForm=z.infer<typeof officialWidgetFormSchema>;
export type SubmitOfficialWidget=z.infer<typeof submitOfficialWidgetSchema>;
