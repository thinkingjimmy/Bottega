/**
 * [INPUT]: Depends on strict identity schemas and public Widget name validation.
 * [OUTPUT]: Provides trusted source-Chat requests, authoring targets and management snapshots without filesystem paths.
 * [POS]: Main-window Dock authoring contract; auxiliary Dock surfaces only send fixed intents.
 */
import {z} from 'zod';
import {widgetNameSchema} from '@bottega/contracts/plugins/dock/settings';
import {dockContributionSchema} from '@bottega/contracts/plugins/dock/manifest';
import {dockSizeSchema} from '@bottega/contracts/plugins/dock/summary';
import {dockInstanceSettingsSchema,dockBaseBindingSchema} from './instance';
import {dockWidgetItemSchema} from '../layout';
export const newDockWidgetSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),name:widgetNameSchema.optional()}).strict();
export const editDockWidgetSchema=z.object({definitionId:z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/)}).strict();
export const forkDockWidgetSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),itemId:z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)}).strict();
export const applyDockWidgetSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),previewId:z.string().regex(/^[a-f0-9]{32}$/),settings:dockInstanceSettingsSchema,bindings:z.array(dockBaseBindingSchema).max(2),size:dockSizeSchema,name:widgetNameSchema.optional(),baseConsent:z.boolean().default(false),apiConsent:z.array(z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,63}$/)).max(8).default([]),reviewId:z.string().regex(/^[a-f0-9]{32}$/).optional()}).strict();
export const widgetOperationQuerySchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)}).strict();
export type WidgetAuthoringTarget=Readonly<{id:string;chatId:string;projectId:string}>;
export type WidgetDefinitionView=Readonly<{id:string;sourceInstallationId?:string;name:string;description:string;chatId:string;activeGenerationId:string|null;candidateGenerationId:string|null;instanceCount:number;error:string|null}>;
export type WidgetManagementSnapshot=Readonly<{layoutRevision:number;accountDefinitions?:readonly import('./install/types').WidgetAccountDefinition[];retirements?:readonly (import('./install/lifecycle').WidgetRetirementResult&{name:string})[];installedDefinitions?:readonly import('./install/types').WidgetInstalledDefinition[];deliveries?:readonly import('./install/types').WidgetDeliveryView[];installationProgress?:import('./install/types').WidgetInstallProgress|null;definitions:readonly WidgetDefinitionView[];instances:readonly Readonly<{id:string;definitionId:string;name:string;paused?:boolean;mappingRevision?:number;sourceInstallationId?:string;installation?:'install'|'update'|'needs-setup'|'ready'|'source-review'|'preparing'|'repair'}>[]}>;
const generation=z.string().regex(/^plugin-[a-f0-9-]{36}$/),digest=z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const previewWidgetVersionSchema=editDockWidgetSchema.extend({generationId:generation});
export type WidgetVersionView=Readonly<{generationId:string;version:string;createdAt:number;active:boolean;available:boolean}>;
export const widgetPreviewSchema=z.object({id:z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/),kind:z.enum(['candidate','version']).default('candidate'),generationId:generation,sourceFingerprint:z.string().regex(/^[a-f0-9]{64}$/),name:widgetNameSchema,dock:dockContributionSchema,
 previewId:z.string().regex(/^[a-f0-9]{32}$/),packageRef:digest,contractDigest:digest,executionInstallationId:z.string().min(1).max(128),mode:z.enum(['add','update','save','applied','replace']),replacement:z.object({item:dockWidgetItemSchema,name:widgetNameSchema}).strict().nullable().default(null),layoutRevision:z.number().int().nonnegative(),
 expectedActiveGenerationId:generation.nullable(),instanceIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)).max(100)}).strict();
export type WidgetPreview=Readonly<z.infer<typeof widgetPreviewSchema>>;
export type WidgetApplyInput=z.input<typeof applyDockWidgetSchema>;
export const widgetApplyReceiptSchema=z.object({operationId:z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),status:z.enum(['applied','saved','saved-not-added','conflict']),definitionId:z.string().regex(/^[a-z][a-z0-9.-]{0,119}$/),
 activeGenerationId:generation.nullable(),packageRef:digest,itemIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{8,64}$/)).max(100)}).strict();
export type WidgetApplyReceipt=Readonly<z.infer<typeof widgetApplyReceiptSchema>>;
