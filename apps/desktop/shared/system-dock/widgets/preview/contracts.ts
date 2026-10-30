/**
 * [INPUT]: Depends on strict Dock identities, portable non-secret settings/bindings and host detail DTOs.
 * [OUTPUT]: Provides bounded temporary authoring-preview controls, configuration, snapshots and lifecycle health.
 * [POS]: Trusted Main-window preview contract; author/native RPCs cannot call this control bridge.
 */
import {z} from 'zod';
import {widgetNameSchema} from '@bottega/contracts/plugins/dock/settings';
import {dockSizeSchema} from '@bottega/contracts/plugins/dock/summary';
import {dockBaseBindingSchema,dockInstanceSettingsSchema} from '../instance';
import {widgetInstanceIdSchema} from '../entry';
import type {CustomWidgetDetail} from '../runtime';
import type {WidgetRuntimeHealth} from '../native';
export const WIDGET_PREVIEW_BUDGET=Object.freeze({requestBytes:32768,snapshotBytes:131072,sessionMs:600000,recentRequests:128});
const reference=z.string().regex(/^[a-f0-9]{32}$/),operation=z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),chat=z.string().min(1).max(160),theme=z.enum(['light','dark']);
export const widgetPreviewConfigurationSchema=z.object({name:widgetNameSchema,size:dockSizeSchema,settings:dockInstanceSettingsSchema,bindings:z.array(dockBaseBindingSchema).max(2),baseConsent:z.boolean().default(false),apiConsent:z.array(z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,63}$/)).max(8).default([])}).strict();
export type WidgetPreviewConfiguration=z.infer<typeof widgetPreviewConfigurationSchema>;
const bounds=z.object({x:z.number().finite().min(0).max(32768),y:z.number().finite().min(0).max(32768),width:z.number().finite().positive().max(32768),height:z.number().finite().positive().max(32768)}).strict();
export const widgetPreviewControlSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('draft'),previewId:reference,chatId:chat,targetId:widgetInstanceIdSchema.optional()}).strict(),
 z.object({kind:z.literal('open'),requestId:operation,previewId:reference,chatId:chat,targetId:widgetInstanceIdSchema.optional(),mode:z.enum(['sample','real']),theme,configuration:widgetPreviewConfigurationSchema.optional()}).strict(),
 z.object({kind:z.literal('read'),sessionId:reference}).strict(),
 z.object({kind:z.literal('present'),sessionId:reference,visible:z.boolean()}).strict(),
 z.object({kind:z.literal('theme'),sessionId:reference,theme}).strict(),
 z.object({kind:z.literal('bounds'),sessionId:reference,key:z.string().regex(/^[a-f0-9]{64}$/),bounds:bounds.nullable()}).strict(),
 z.object({kind:z.literal('retry'),sessionId:reference,key:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
 z.object({kind:z.literal('refresh'),sessionId:reference}).strict(),
 z.object({kind:z.literal('action'),sessionId:reference,ref:reference}).strict(),
 z.object({kind:z.literal('close'),sessionId:reference.optional(),requestId:operation.optional()}).strict().refine(value=>Boolean(value.sessionId)!==Boolean(value.requestId),'Choose one preview identity'),
]);
export type WidgetPreviewControl=z.infer<typeof widgetPreviewControlSchema>;
export type WidgetPreviewSnapshot=Readonly<{sessionId:string;revision:number;previewId:string;definitionId:string;mode:'sample'|'real';name:string;executionComputer:string;theme:'light'|'dark';state:'prepared'|'active'|'suspended'|'closed';detail:CustomWidgetDetail|null;announcement:'action-example'|null;reason?:'closed'|'conflict'|'expired'|'window-closed'}>;
export type WidgetPreviewResult=WidgetPreviewSnapshot|WidgetPreviewConfiguration|null;
export type WidgetPreviewHealth=Readonly<{sessions:number;pending:number;timers:number;cleanups:number;failures:number;detail:WidgetRuntimeHealth['detail'];base:NonNullable<WidgetRuntimeHealth['base']>}>;
export function parseWidgetPreviewControl(value:unknown):WidgetPreviewControl{
 const serialized=JSON.stringify(value);if(typeof serialized!=='string'||new TextEncoder().encode(serialized).byteLength>WIDGET_PREVIEW_BUDGET.requestBytes)throw new Error('DOCK_PREVIEW_REQUEST_BUDGET');return widgetPreviewControlSchema.parse(value);
}
