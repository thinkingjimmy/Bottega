/**
 * [INPUT]: Depends on finite API declarations, confirmed non-secret settings and bounded transport responses.
 * [OUTPUT]: Provides safe request construction, typed JSON/HEAD projections and known-secret echo masking.
 * [POS]: Declarative API adapter; no remote HTML, selector expression or JavaScript is executed.
 */
import {DOCK_API_BUDGET as B,type DockApiRequirement,type DockApiValue,type DockApiPath} from '@bottega/contracts/plugins/dock/api';
import type {DockReading,DockScalar,DockSeries} from '@bottega/contracts/plugins/dock/data';
import type {DockSettings} from '@bottega/contracts/plugins/dock/settings';
import {apiDestination} from './address';
import type {ApiWireRequest,ApiWireResponse} from './transport';

const fail=(code:string):never=>{throw new Error('DOCK_API_'+code);};
const reserved=/^(?:authorization|proxy-authorization|cookie|set-cookie|host|connection|transfer-encoding|content-length|content-type|accept-encoding|origin|referer|sec-.+)$/i;
const knownAuthHeader=/^(?:x-api-key|x-auth-token|x-access-token|api-key|apikey)$/i;
const secretName=/^(?:api[-_]?key|access[-_]?token|auth(?:orization)?|token|password|secret|key)$/i;
export const apiSlotIds=(query:DockApiRequirement)=>query.authentication.kind==='none'?[]:[query.authentication.slot];
function scalar(value:unknown):string|number|boolean{
 if(typeof value==='string'&&value.length<=1024||typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')return value;
 return fail('PARAMETER_INVALID');
}
function resolve(value:DockApiValue,settings:DockSettings){
 if('literal'in value)return scalar(value.literal);
 if(!Object.hasOwn(settings,value.setting))return fail('PARAMETER_REQUIRED');return scalar(settings[value.setting]);
}
function pairs(values:Readonly<Record<string,DockApiValue>>|undefined,settings:DockSettings){return Object.fromEntries(Object.entries(values??{}).map(([key,value])=>[key,resolve(value,settings)]));}
export function apiParameters(query:DockApiRequirement,settings:DockSettings){
 return Object.fromEntries(([['path',query.request.pathParameters],['query',query.request.query],['body',query.request.body],['header',query.request.headers]]as const).flatMap(([location,values])=>Object.entries(pairs(values,settings)).map(([name,value])=>[location+'.'+name,value])));
}
export function apiScope(query:DockApiRequirement,settings:DockSettings,libraryId:string|null){
 const wire=buildApiRequest(query,settings,null);return{id:query.id,purpose:query.purpose,request:query.request,authentication:query.authentication,libraryId,url:wire.url.href,method:wire.method,headers:wire.headers,body:wire.body??null};
}
export function buildApiRequest(query:DockApiRequirement,settings:DockSettings,credential:string|null,redirect?:URL):ApiWireRequest{
 const {request,authentication}=query;
 if(request.method==='HEAD'&&query.response.kind!=='head'||request.method!=='HEAD'&&query.response.kind!=='json'||request.method==='POST'&&request.semantics!=='read-only-query'||request.method!=='POST'&&request.body)fail('DECLARATION_INVALID');
 const parameters=pairs(request.pathParameters,settings),used=new Set<string>();
 const path=request.path.replace(/\{([A-Za-z][A-Za-z0-9_.-]{0,79})\}/g,(_match,id:string)=>{
  if(!Object.hasOwn(parameters,id))return fail('PARAMETER_REQUIRED');used.add(id);const value=String(parameters[id]);if(value==='.'||value==='..'||/[\\/\r\n\0]/.test(value))return fail('PARAMETER_INVALID');return encodeURIComponent(value);
 });
 if(/[{}]/.test(path)||Object.keys(parameters).some(id=>!used.has(id)))fail('PARAMETER_INVALID');
 const declared=apiDestination(request.origin+path),url=redirect?apiDestination(redirect.href):declared;
 const queryValues=pairs(request.query,settings),bodyValues=pairs(request.body,settings),headers:Record<string,string>={};
 for(const [key,value]of Object.entries(queryValues)){if(secretName.test(key))fail('AUTHENTICATION_SLOT_REQUIRED');url.searchParams.set(key,String(value));}
 for(const key of Object.keys(bodyValues))if(secretName.test(key))fail('AUTHENTICATION_SLOT_REQUIRED');
 for(const [name,value]of Object.entries(pairs(request.headers,settings))){
  if(reserved.test(name)||knownAuthHeader.test(name)||secretName.test(name)||/[\r\n\0]/.test(String(value))||/^(?:Bearer|Basic)\s/i.test(String(value)))fail('HEADER_FORBIDDEN');headers[name.toLowerCase()]=String(value);
 }
 if(credential!==null&&url.origin===declared.origin){
  if(/[\r\n\0]/.test(credential))fail('CREDENTIAL_INVALID');
  if(authentication.kind==='bearer')headers.authorization='Bearer '+credential;
  if(authentication.kind==='api-key'){
   const value=(authentication.prefix??'')+credential;
   if(/[\r\n\0]/.test(value))fail('CREDENTIAL_INVALID');
   if(authentication.location==='query')url.searchParams.set(authentication.name,value);
   else{if(reserved.test(authentication.name)&&authentication.name.toLowerCase()!=='authorization')fail('HEADER_FORBIDDEN');headers[authentication.name.toLowerCase()]=value;}
  }
 }
 return{url,method:request.method,headers,...(request.method==='POST'?{body:JSON.stringify(bodyValues)}:{})};
}
export function apiRedirect(query:DockApiRequirement,current:URL,location:string):URL{
 if(query.request.method==='POST')return fail('REDIRECT_FORBIDDEN');let target:URL;
 try{target=apiDestination(new URL(location,current).href);}catch{return fail('REDIRECT_FORBIDDEN');}
 const approved=query.request.redirects?.some(template=>template.origin===target.origin&&template.path===target.pathname);
 if(!approved)return fail('REDIRECT_FORBIDDEN');
 // A Location query can contain an echoed credential. Rebuild only declared non-secret query values.
 target.search='';return target;
}
function select(value:unknown,path:DockApiPath):unknown{
 let selected=value;
 for(const part of path){if(selected===null||typeof selected!=='object'||!Object.hasOwn(selected,part))return undefined;selected=(selected as Record<string|number,unknown>)[part];}return selected;
}
function time(value:unknown,format:'iso8601'|'unix-seconds'|'unix-ms'|undefined){
 if(format==='unix-seconds'||format==='unix-ms'){if(typeof value!=='number'||!Number.isFinite(value))return fail('MAPPING_INVALID');const result=value*(format==='unix-seconds'?1000:1);if(!Number.isFinite(result)||Math.abs(result)>8640000000000000)return fail('MAPPING_INVALID');return result;}
 if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/.test(value))return fail('MAPPING_INVALID');const result=Date.parse(value);return Number.isFinite(result)?result:fail('MAPPING_INVALID');
}
type JsonResponse=Extract<DockApiRequirement['response'],{kind:'json'}>;
type JsonField=JsonResponse['fields'][number];
function field(value:unknown,definition:JsonField):DockScalar{
 if(value===null)return null;
 if(definition.lookup){if((typeof value!=='number'&&typeof value!=='string')||!Object.hasOwn(definition.lookup,String(value)))return fail('MAPPING_INVALID');return definition.lookup[String(value)]!;}
 if(definition.type==='date')return time(value,definition.timeFormat);
 if(definition.type==='number')return typeof value==='number'&&Number.isFinite(value)?value:fail('MAPPING_INVALID');
 if(definition.type==='boolean')return typeof value==='boolean'?value:fail('MAPPING_INVALID');
 return typeof value==='string'&&value.length<=2048?value:fail('MAPPING_INVALID');
}
function checkDepth(text:string){
 let depth=0,quoted=false,escaped=false;
 for(const character of text){if(quoted){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character==='"')quoted=false;continue;}if(character==='"')quoted=true;else if(character==='{'||character==='['){if(++depth>B.apiJsonDepth)fail('JSON_DEPTH_BUDGET');}else if(character==='}'||character===']')depth--;}
}
export function projectApiResponse(query:DockApiRequirement,response:ApiWireResponse,now:number,secrets:readonly string[]=[]):DockReading{
 const empty:DockReading={state:'no-data',updatedAt:now,values:{}};
 if(query.response.kind==='head'){
  const values:Record<string,DockScalar>={};
  for(const name of query.response.fields){
   if(name==='status'){values[name]=response.status;continue;}
   const raw=response.headers[name];if(raw===undefined){values[name]=null;continue;}if(raw.length>1024)fail('HEADER_BUDGET');
   if(name==='etag'){const tag=raw.startsWith('W/')?raw.slice(2):raw;if(tag.length<2||!tag.startsWith('"')||!tag.endsWith('"')||[...tag.slice(1,-1)].some(char=>char.charCodeAt(0)<=32||char.charCodeAt(0)===127||char==='"'))fail('MAPPING_INVALID');values[name]=raw;}
   else if(name==='lastModified'){const parsed=Date.parse(raw);if(!Number.isFinite(parsed))fail('MAPPING_INVALID');values[name]=parsed;}
   else{if(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw)))fail('MAPPING_INVALID');values[name]=Number(raw);}
  }
  return{state:'ready',updatedAt:now,values:maskSecrets(values,secrets)};
 }
 if(response.status===204||response.body.length===0)return empty;
 let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(response.body);}catch{return fail('JSON_INVALID');}checkDepth(text);let document:unknown;
 try{document=JSON.parse(text);}catch{return fail('JSON_INVALID');}
 if(document===null||Array.isArray(document)&&document.length===0)return empty;
 const mapping=query.response,values:Record<string,DockScalar|DockSeries>={};
 for(const definition of mapping.fields)values[definition.id]=field(select(document,definition.path),definition);
 const reading:{state:DockReading['state'];updatedAt:number;values:Record<string,DockScalar|DockSeries>;records?:DockReading['records'];columns?:DockReading['columns']}={state:'ready',updatedAt:now,values};
 if(mapping.records){
  const rows=select(document,mapping.records.path);if(!Array.isArray(rows))return fail('MAPPING_INVALID');if(rows.length>B.records)return fail('PROJECTION_BUDGET');
  const recordMap=mapping.records;reading.records=rows.map((row,index)=>{const id=recordMap.idPath?select(row,recordMap.idPath):String(index);if(typeof id!=='string'&&typeof id!=='number')return fail('MAPPING_INVALID');return{id:String(id).slice(0,128),values:Object.fromEntries(recordMap.columns.map(column=>[column.id,field(select(row,column.path),column)]))};});
  if(new Set(reading.records.map(row=>row.id)).size!==rows.length)fail('MAPPING_INVALID');
  reading.columns=recordMap.columns.map(column=>({id:column.id,label:column.label,type:column.type==='boolean'?'checkbox':column.type}));
  if(!rows.length&&!mapping.fields.length&&!mapping.series)return empty;
 }
 if(mapping.series){
  const series=mapping.series,times=select(document,series.timePath),numbers=select(document,series.valuePath);
  if(!Array.isArray(times)||!Array.isArray(numbers)||times.length!==numbers.length||times.length>B.points)fail('MAPPING_INVALID');
  const points=(times as unknown[]).map((at,index)=>{const value=(numbers as unknown[])[index];if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)))return fail('MAPPING_INVALID');return{at:time(at,series.timeFormat),value:value as number|null};}).sort((left,right)=>left.at-right.at);
  if(new Set(points.map(point=>point.at)).size!==points.length)fail('MAPPING_INVALID');
  if(points.length){values[series.id]={from:points[0]!.at,to:points.at(-1)!.at+1,timeZone:series.timeZone,points};}else values[series.id]=null;
 }
 if(Buffer.byteLength(JSON.stringify(reading))>64*1024)fail('PROJECTION_BUDGET');
 const result={...reading,values:maskSecrets(reading.values,secrets),...(reading.records?{records:reading.records.map(record=>({id:maskSecrets(record.id,secrets).slice(0,128),values:maskSecrets(record.values,secrets)}))}:{})};
 if(Buffer.byteLength(JSON.stringify(result))>64*1024)fail('PROJECTION_BUDGET');return result;
}
export function maskSecrets<T>(value:T,secrets:readonly string[]):T{
 const active=secrets.filter(Boolean);if(!active.length)return value;
 return JSON.parse(JSON.stringify(value,(_key,item:unknown)=>{if(typeof item!=='string')return item;let text=item;for(const secret of active)for(const encoded of new Set([secret,encodeURIComponent(secret)]))text=text.split(encoded).join('[redacted]');return text.slice(0,2048);}))as T;
}
