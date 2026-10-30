/**
 * [INPUT]: Depends on zod and Dock declaration identifiers.
 * [OUTPUT]: Provides typed non-secret internal/Base/API requirements, declared output fields, structured failures and bounded reads.
 * [POS]: Public Dock capability declaration; no selector is an authorization or an executable query.
 */
import {z} from 'zod';
import {dockIdentifierSchema as id} from './settings';
import {dockApiRequirementSchema,dockApiFields,type DockApiFailure} from './api/index';
export const dockTimeZoneSchema=z.string().min(1).max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Unknown time zone');
export const dockDataRequirementSchema=z.discriminatedUnion('kind',[
  dockApiRequirementSchema,
  z.object({id,kind:z.literal('clock'),timeZone:dockTimeZoneSchema,precision:z.enum(['minute','second']),deadlineSetting:id.optional()}).strict(),
  z.object({id,kind:z.literal('limits'),backendSetting:id,selection:z.object({poolId:z.string().min(1).max(256).nullable(),windowId:z.string().min(1).max(256).nullable()}).strict().optional()}).strict(),
  z.object({id,kind:z.literal('activity'),sourceSetting:id,period:z.literal('today')}).strict(),
  z.object({id,kind:z.literal('tasks')}).strict(),
  z.object({id,kind:z.literal('base'),binding:id,operation:z.enum(['count','sum','group','records','history']),field:id.optional(),
    timeField:id.optional(),timeZone:dockTimeZoneSchema.optional(),bucket:z.enum(['day','week','month']).optional(),missingBuckets:z.enum(['gap','zero-count']).optional(),
    fromSetting:id.optional(),toSetting:id.optional(),reduction:z.enum(['sum','mean']).optional()}).strict(),
]);
export type DockDataRequirement=z.infer<typeof dockDataRequirementSchema>;
export function dockDataFields(source:DockDataRequirement):Readonly<Record<string,'number'|'text'|'boolean'|'date'|'series'>>{
 switch(source.kind){
  case'api':return Object.fromEntries(dockApiFields(source).map(field=>[field.id,field.type]));
  case'clock':return{time:'text',date:'text',now:'date',...(source.deadlineSetting?{remainingDays:'number',remainingHours:'number',remainingSeconds:'number'}as const:{})};
  case'limits':return{remaining:'number',maximum:'number',resetsAt:'date'};
  case'activity':return{tokens:'number',costUsd:'number',unpricedTokens:'number'};
  case'tasks':return{running:'number',waiting:'number',total:'number'};
  case'base':return source.operation==='history'?{series:'series'}:source.operation==='sum'?{count:'number',sum:'number',numericCount:'number'}:source.operation==='group'?{count:'number',groupCount:'number'}:{count:'number'};
 }
}
export const DOCK_BASE_BUDGET=Object.freeze({basePageRows:200,baseRefreshRows:2000,baseRefreshDeadlineMs:500,baseBindingCount:2,baseFieldCount:16,baseGroupCount:64,baseDetailRows:50,baseResultBytes:64*1024});
export const dockReadingStateSchema=z.enum(['ready','loading','no-data','partial','stale','needs-setup','needs-authorization','definition-missing','paused','failed']);
export type DockReadingState=z.infer<typeof dockReadingStateSchema>;
export type DockSeries=Readonly<{from:number;to:number;timeZone:string;points:readonly Readonly<{at:number;value:number|null}>[]}>;
export type DockScalar=string|number|boolean|null;
export type DockRecord=Readonly<{id:string;values:Readonly<Record<string,DockScalar>>}>;
export type DockColumn=Readonly<{id:string;label:string;type:'text'|'number'|'date'|'select'|'checkbox'|'url'}>;
export type DockGroup=Readonly<{key:DockScalar;count:number}>;
export type DockReading=Readonly<{state:DockReadingState;updatedAt:number|null;values:Readonly<Record<string,DockScalar|DockSeries>>;records?:readonly DockRecord[];columns?:readonly DockColumn[];groups?:readonly DockGroup[];failure?:DockApiFailure}>;
