/**
 * [INPUT]: Depends on zod, typed non-secret setting identifiers and finite API budgets.
 * [OUTPUT]: Provides generic HTTPS request declarations, JSON/HEAD mapping and host-visible field metadata.
 * [POS]: Declarative capability contract; requests execute only after separate Main-owned local consent.
 */
import {z} from 'zod';
import {dockIdentifierSchema as id} from '../settings';
import {DOCK_API_BUDGET as B} from './limits';
export {DOCK_API_BUDGET} from './limits';
const scalar=z.union([z.string().max(1024),z.number().finite(),z.boolean()]);
export const dockApiValueSchema=z.union([z.object({literal:scalar}).strict(),z.object({setting:id}).strict()]);
export type DockApiValue=z.infer<typeof dockApiValueSchema>;
const key=z.string().regex(/^[A-Za-z][A-Za-z0-9_.-]{0,79}$/);
const values=z.record(key,dockApiValueSchema).refine(value=>Object.keys(value).length<=B.fields,'Too many request fields');
const origin=z.string().max(512).refine(value=>{try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&url.pathname==='/'&&!url.search&&!url.hash;}catch{return false;}},'An HTTPS origin is required').transform(value=>new URL(value).origin);
const path=z.string().min(1).max(1024).refine(value=>value.startsWith('/')&&!value.startsWith('//')&&!/[\\?#\r\n]/.test(value),'A bounded absolute path is required');
export const dockApiPathSchema=z.array(z.union([z.string().min(1).max(120).refine(value=>!['__proto__','prototype','constructor'].includes(value)),z.number().int().min(0).max(4096)])).max(16);
export type DockApiPath=z.infer<typeof dockApiPathSchema>;
const field=z.object({id,label:z.string().min(1).max(120),type:z.enum(['number','text','boolean','date']),path:dockApiPathSchema,
 unit:z.string().max(16).optional(),timeFormat:z.enum(['iso8601','unix-seconds','unix-ms']).optional(),
 lookup:z.record(z.string().max(64),z.string().max(160)).refine(value=>Object.keys(value).length<=64).optional()}).strict();
export const dockApiResponseSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('json'),fields:z.array(field).max(B.fields),
  records:z.object({path:dockApiPathSchema,idPath:dockApiPathSchema.optional(),columns:z.array(field).min(1).max(B.fields)}).strict().optional(),
  series:z.object({id,label:z.string().min(1).max(120),timePath:dockApiPathSchema,valuePath:dockApiPathSchema,timeFormat:z.enum(['iso8601','unix-seconds','unix-ms']),timeZone:z.string().min(1).max(80)}).strict().optional(),
 }).strict(),
 z.object({kind:z.literal('head'),fields:z.array(z.enum(['status','etag','lastModified','contentLength'])).min(1).max(4)}).strict(),
]);
export type DockApiResponse=z.infer<typeof dockApiResponseSchema>;
export const dockApiRequirementSchema=z.object({
 id,kind:z.literal('api'),purpose:z.string().min(1).max(200),
 request:z.object({method:z.enum(['GET','HEAD','POST']),origin,path,pathParameters:values.optional(),query:values.default({}),headers:values.optional(),body:values.optional(),
  redirects:z.array(z.object({origin,path}).strict()).max(B.apiRedirectCount).optional(),
  semantics:z.literal('read-only-query').optional(),
 }).strict(),
 authentication:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('none')}).strict(),
  z.object({kind:z.literal('api-key'),slot:id,location:z.enum(['header','query']),name:key,prefix:z.string().max(80).optional()}).strict(),
  z.object({kind:z.literal('bearer'),slot:id}).strict(),
 ]).default({kind:'none'}),
 response:dockApiResponseSchema,refreshIntervalMs:z.number().int().min(B.apiMinimumIntervalMs).max(86400000).default(900000),
 attribution:z.object({label:z.string().min(1).max(160),url:z.string().url().max(512).refine(value=>value.startsWith('https://'))}).strict().optional(),
});
export type DockApiRequirement=z.infer<typeof dockApiRequirementSchema>;
export type DockApiField=Readonly<{id:string;label:string;type:'number'|'text'|'boolean'|'date'|'series';unit?:string}>;
export function dockApiFields(source:DockApiRequirement):readonly DockApiField[]{
 if(source.response.kind==='head')return source.response.fields.map(id=>({id,label:{status:'HTTP status',etag:'ETag',lastModified:'Last modified',contentLength:'Content length'}[id],type:id==='etag'?'text':id==='lastModified'?'date':'number'}));
 return[...source.response.fields,...(source.response.series?[{id:source.response.series.id,label:source.response.series.label,type:'series' as const}]:[])].map(({id,label,type,...rest})=>({id,label,type,...('unit'in rest&&rest.unit?{unit:rest.unit}:{})}));
}
export type DockApiFailure=Readonly<{code:'network'|'timeout'|'proxy-required'|'http'|'mapping'|'budget'|'authorization'|'unknown-result';status?:number;retryAt?:number;sent?:boolean}>;
