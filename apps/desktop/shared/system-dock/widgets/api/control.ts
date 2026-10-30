/**
 * [INPUT]: Depends on typed non-secret settings and structured API failure metadata.
 * [OUTPUT]: Provides trusted Main-window API connection controls and secret-free configuration reviews.
 * [POS]: Host configuration bridge; neither author RPCs nor portable layout expose this capability.
 */
import {z} from 'zod';
import type {DockApiFailure} from '@bottega/contracts/plugins/dock/api';
import {dockInstanceSettingsSchema} from '../instance';
const reference=z.string().regex(/^[a-f0-9]{32}$/),operation=z.string().regex(/^[A-Za-z0-9_-]{8,128}$/),id=z.string().regex(/^[a-z][a-zA-Z0-9_-]{0,63}$/);
const context={previewId:reference,targetId:z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).optional(),settings:dockInstanceSettingsSchema};
export const widgetApiControlSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('review'),...context}).strict(),
 z.object({kind:z.literal('configure'),...context,operationId:operation,consent:z.array(id).max(8),credentials:z.record(id,z.string().min(1).max(8192)).refine(value=>Object.keys(value).length<=8).optional()}).strict(),
 z.object({kind:z.literal('revoke'),...context,requestId:id.optional()}).strict(),
 z.object({kind:z.literal('clear'),...context,slotId:id}).strict(),
 z.object({kind:z.literal('copy'),...context,operationId:operation,selectionId:reference,slotId:id}).strict(),
 z.object({kind:z.literal('test'),...context,requestId:id}).strict(),
]);
export type WidgetApiControl=z.infer<typeof widgetApiControlSchema>;
export type WidgetApiReview=Readonly<{requests:readonly Readonly<{id:string;purpose:string;method:'GET'|'HEAD'|'POST';origin:string;path:string;parameters:Readonly<Record<string,string|number|boolean>>;authorized:boolean;configured:boolean;slot:string|null;authentication:'none'|'api-key'|'bearer';failure?:DockApiFailure}>[];copyChoices:readonly Readonly<{id:string;label:string;slotId:string}>[]}>;
