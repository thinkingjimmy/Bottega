/**
 * [INPUT]: Depends on portable custom instance schemas and strict preview/application contracts.
 * [OUTPUT]: Provides bounded account/Library-scoped runtime mappings, exact local Base permission receipts and mapping-revision-fenced application journals with local API association intents and completion acknowledgements.
 * [POS]: Local-only Widget truth; synchronized desired references never directly select a running package.
 */
import {z} from 'zod';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import type {WidgetPreview} from '../../../../../shared/system-dock/widgets/authoring';
import {customDockWidgetSchema} from '../../../../../shared/system-dock/widgets/instance';
import {applyDockWidgetSchema,widgetPreviewSchema,widgetApplyReceiptSchema} from '../../../../../shared/system-dock/widgets/authoring';
import {widgetNameSchema} from '@bottega/contracts/plugins/dock/settings';
import {dockWidgetItemSchema} from '../../../../../shared/system-dock/layout';
import {baseAccessSchema,baseGrantSchema,basePermissionSchema} from './base-access';
const itemId=z.string().regex(/^[A-Za-z0-9_-]{8,64}$/);
export const localWidgetScopeSchema=z.object({accountId:z.string().min(1).max(256),installationId:z.string().min(1).max(128),libraryId:z.string().min(1).max(256).nullable()}).strict();
export const acceptedWidgetSchema=z.object({scope:localWidgetScopeSchema,itemId,widget:customDockWidgetSchema,paused:z.boolean(),revision:z.number().int().nonnegative(),lastOperationId:z.string().max(256).nullable().default(null),baseAccess:baseAccessSchema.default('unconfirmed'),baseGrant:baseGrantSchema.nullable().default(null)}).strict().refine(value=>(value.baseAccess==='unconfirmed')===(value.baseGrant===null),'Base permission receipt is required');
export const customWidgetItemSchema=z.object({id:itemId,kind:z.literal('widget'),label:widgetNameSchema,widget:customDockWidgetSchema}).strict();
const permission=basePermissionSchema.and(z.object({itemId,expectedRevision:z.number().int().nonnegative().nullable()}));
export const widgetApiIntentSchema=z.object({itemId,consent:z.array(z.string().max(64)).max(8),draftOwnerId:z.string().max(160).nullable()}).strict();
export type WidgetApiIntent=z.infer<typeof widgetApiIntentSchema>;
export type WidgetApiPlan=Readonly<{operationId:string;scope:LocalWidgetScope;target:CustomWidgetItem;consent:readonly string[];draftOwnerId:string|null}>;
export type WidgetApiHooks=Readonly<{draftOwnerId(preview:WidgetPreview,targetId?:string):string;prepare(plan:WidgetApiPlan):Promise<void>;commit(plan:WidgetApiPlan):Promise<void>;retire(mapping:AcceptedWidget,keepCredentials?:boolean):Promise<void>;ack(scope:LocalWidgetScope,operationId:string,itemIds:readonly string[]):Promise<void>;authorized(scope:LocalWidgetScope,dock:DockContribution,target:CustomWidgetItem):boolean}>;
const intent=z.object({preview:widgetPreviewSchema,beforeItems:z.array(dockWidgetItemSchema).max(100),targets:z.array(customWidgetItemSchema).max(100),permissions:z.array(permission).max(100),layoutRevisionAfter:z.number().int().nonnegative().nullable(),api:z.array(widgetApiIntentSchema).max(100).default([])}).strict();
export const widgetApplicationSchema=z.object({scope:localWidgetScopeSchema,input:applyDockWidgetSchema,request:z.string().max(32*1024),phase:z.enum(['prepared','pinned','activated','completed','conflict']),intent:intent.nullable(),receipt:widgetApplyReceiptSchema.nullable(),error:z.string().max(120).nullable()}).strict();
export const localWidgetRuntimeSchema=z.object({version:z.literal(1),mappings:z.array(acceptedWidgetSchema).max(100),operations:z.array(widgetApplicationSchema).max(256)}).strict().superRefine((value,context)=>{
 if(new Set(value.mappings.map(mapping=>JSON.stringify([mapping.scope.accountId,mapping.scope.installationId,mapping.scope.libraryId,mapping.itemId]))).size!==value.mappings.length)context.addIssue({code:'custom',message:'Duplicate local Widget mapping'});
 if(value.operations.filter(operation=>operation.phase!=='completed'&&operation.phase!=='conflict').length>8)context.addIssue({code:'custom',message:'Unresolved Widget operation capacity exceeded'});
 if(new Set(value.operations.map(operation=>operation.input.operationId)).size!==value.operations.length)context.addIssue({code:'custom',message:'Duplicate Widget operation identity'});
});
export type LocalWidgetScope=z.infer<typeof localWidgetScopeSchema>;
export type AcceptedWidget=z.infer<typeof acceptedWidgetSchema>;
export type WidgetApplication=z.infer<typeof widgetApplicationSchema>;
export type CustomWidgetItem=z.infer<typeof customWidgetItemSchema>;
