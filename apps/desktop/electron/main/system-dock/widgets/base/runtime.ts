/**
 * [INPUT]: Depends on current accepted sources/permissions, canonical Base ownership, event invalidation and the bounded readonly reader.
 * [OUTPUT]: Provides independent surface demand, shared per-instance refreshes, metadata-only host validation, exact revocation and close.
 * [POS]: Lazy Main Base Widget data owner; no prewarm read, author query, new Base or background polling is admitted.
 */
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import type {DockReading} from '@bottega/contracts/plugins/dock/data';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import {widgetBaseDirectorySchema,type WidgetBaseDirectoryRequest} from '../../../../../shared/system-dock/widgets/base/access';
import {basePermissionFor} from '../../store/custom/base-access';
import type {WidgetDetailSource} from '../detail/ports';
import {widgetDetailKey} from '../detail/scope';
import type {DockSurface} from '../usage';
import type {DockBaseDataPort,DockBaseDataPorts,DockBasePlan} from './model';
import {createDockBaseReader} from './owner';
import {readDockBases,validateDockBasePlan,validateDockBaseColumns} from './reader';
type Entry={source:WidgetDetailSource;key:string;readings:Record<string,DockReading>;controller:AbortController|null;flight:Promise<void>|null;dirty:boolean;manualAt:number};
const empty=(state:DockReading['state']):DockReading=>({state,updatedAt:null,values:{}});
const plan=(source:WidgetDetailSource):DockBasePlan=>({bindings:source.accepted.widget.bindings,queries:source.manifest.dock.data.filter(value=>value.kind==='base'),settings:source.accepted.widget.settings});
export class DockBaseData implements DockBaseDataPort{
 private readonly surfaces=new Map<DockSurface,readonly WidgetDetailSource[]>();
 private readonly entries=new Map<string,Entry>();
 private readonly flights=new Set<Promise<void>>();
 private readonly authorityEpochs=new Map<string,number>();
 private timer:ReturnType<typeof setTimeout>|null=null;
 private stopEvents:(()=>void)|null=null;
 private closed=false;
 constructor(private readonly ports:DockBaseDataPorts){}
 setVisible(surface:DockSurface,sources:readonly WidgetDetailSource[]){
  if(this.closed)return;this.surfaces.set(surface,sources.filter(source=>plan(source).queries.length));
  const wanted=new Map([...new Set([...this.surfaces.values()].flat().map(source=>source.item.id))].flatMap(id=>{const current=this.ports.source(id);return current&&plan(current).queries.length?[[id,current]as const]:[];}));
  for(const [id,entry]of this.entries){const source=wanted.get(id);if(!source||widgetDetailKey(source)!==entry.key){entry.controller?.abort();this.entries.delete(id);}}
  for(const [id,source]of wanted){
   const current=this.ports.source(id);if(!current||widgetDetailKey(current)!==widgetDetailKey(source))continue;
   if(!this.entries.has(id)){const entry:Entry={source:current,key:widgetDetailKey(current),readings:{},controller:null,flight:null,dirty:true,manualAt:0};this.entries.set(id,entry);if(this.permitted(current))void this.start(entry);}
  }
  const watching=[...this.entries.values()].some(entry=>this.permitted(entry.source));
  if(watching&&!this.stopEvents)this.stopEvents=this.ports.bases.onBaseEvent(event=>{
   if(this.closed)return;const keys='ownerKey'in event?[event.ownerKey]:event.type==='base-moved'?[event.from.ownerKey,event.to.ownerKey]:[];
   const authority=event.type!=='base-changed'||Boolean(event.meta);
   for(const key of keys)if(authority&&[...this.entries.values()].some(entry=>entry.source.accepted.widget.bindings.some(binding=>binding.ownerKey===key)))this.authorityEpochs.set(key,(this.authorityEpochs.get(key)??0)+1);
   for(const entry of this.entries.values())if((authority||entry.source.manifest.dock.refresh.mode!=='manual')&&entry.source.accepted.widget.bindings.some(binding=>keys.includes(binding.ownerKey))){
    entry.dirty=true;entry.readings={};entry.controller?.abort();
   }
   this.arm();this.ports.changed();
  });
  if(!watching){this.stopEvents?.();this.stopEvents=null;}
  if(!this.entries.size){this.authorityEpochs.clear();if(this.timer){clearTimeout(this.timer);this.timer=null;}}
 }
 reading(itemId:string,sourceId:string):DockReading{
  const source=this.ports.source(itemId);if(!source||!plan(source).queries.some(value=>value.id===sourceId))return empty('needs-setup');
  if(!this.permitted(source))return empty('needs-authorization');
  if(!this.configured(source))return empty('needs-setup');
  const entry=this.entries.get(itemId);return entry&&entry.key===widgetDetailKey(source)?entry.readings[sourceId]??empty('loading'):empty('loading');
 }
 identity(source:WidgetDetailSource){return canonicalJson(source.accepted.widget.bindings.map(binding=>{
  const snapshot=this.ports.bases.store.peek(binding.ownerKey,binding.ownerInstanceId);
  return[binding.slot,snapshot?.meta.ownerInstanceId??null,this.authorityEpochs.get(binding.ownerKey)??0,Object.values(binding.fields).map(id=>{const field=snapshot?.meta.columns.find(value=>value.id===id);return[id,field?.type??null];})];
 }));}
 async validate(dock:DockContribution,widget:CustomDockWidget){
  const selected:DockBasePlan={bindings:widget.bindings,queries:dock.data.filter(value=>value.kind==='base'),settings:widget.settings};validateDockBasePlan(selected);
  if(selected.bindings.some(binding=>!selected.queries.some(query=>query.binding===binding.slot)))throw new Error('DOCK_BASE_BINDING_NOT_DECLARED');
  for(const binding of selected.bindings){
   const snapshot=this.ports.bases.store.peek(binding.ownerKey,binding.ownerInstanceId);if(!snapshot)throw new Error('DOCK_BASE_OWNER_CHANGED');
   validateDockBaseColumns(binding,selected.queries.filter(query=>query.binding===binding.slot),{ownerInstanceId:snapshot.meta.ownerInstanceId,revision:snapshot.meta.revision,columns:snapshot.meta.columns,rows:[],hasMore:false});
  }
 }
 async directory(input:WidgetBaseDirectoryRequest){
  if(this.closed)throw new Error('DOCK_BASE_UNAVAILABLE');const query=(input.query??'').normalize('NFC').trim().toLocaleLowerCase(),supported=new Set(['text','number','date','select','checkbox','url']);
  const candidates=this.ports.bases.store.listAll().filter(value=>value.snapshot.meta.name.normalize('NFC').toLocaleLowerCase().includes(query)).sort((a,b)=>a.snapshot.meta.name.localeCompare(b.snapshot.meta.name));
  return widgetBaseDirectorySchema.parse({choices:candidates.slice(0,100).map(({ownerKey,snapshot})=>({ownerKey,ownerInstanceId:snapshot.meta.ownerInstanceId,name:snapshot.meta.name,fields:snapshot.meta.columns.filter(column=>supported.has(column.type)).map(column=>({id:column.id,name:column.name,type:column.type}))})),truncated:candidates.length>100});
 }
 async refresh(itemId:string){
  const entry=this.entries.get(itemId);if(!entry||!this.current(entry))throw new Error('DOCK_BASE_AUTHORIZATION_REQUIRED');
  if(entry.flight&&!entry.dirty)return entry.flight;if(entry.flight)await entry.flight;
  if(!this.current(entry))throw new Error('DOCK_BASE_AUTHORIZATION_REQUIRED');
  if(Date.now()-entry.manualAt<1000)return;entry.manualAt=Date.now();return this.start(entry);
 }
 health(){return{consumers:[...this.surfaces.values()].reduce((sum,values)=>sum+values.length,0),flights:this.flights.size,timers:Number(this.timer!==null)};}
 private permitted(source:WidgetDetailSource){
  try{return basePermissionFor({itemId:source.item.id,scope:source.accepted.scope,widget:source.accepted.widget,dock:source.manifest.dock,prior:source.accepted,consent:false}).baseAccess==='approved';}catch{return false;}
 }
 private configured(source:WidgetDetailSource){
  try{const selected=plan(source);for(const binding of selected.bindings){const snapshot=this.ports.bases.store.peek(binding.ownerKey,binding.ownerInstanceId);if(!snapshot)return false;validateDockBaseColumns(binding,selected.queries.filter(query=>query.binding===binding.slot),{ownerInstanceId:snapshot.meta.ownerInstanceId,revision:snapshot.meta.revision,columns:snapshot.meta.columns,rows:[],hasMore:false});}return true;}catch{return false;}
 }
 private current(entry:Entry){const source=this.ports.source(entry.source.item.id);return!this.closed&&this.entries.get(entry.source.item.id)===entry&&source!==null&&widgetDetailKey(source)===entry.key&&this.permitted(source)&&this.configured(source);}
 private start(entry:Entry):Promise<void>{
  if(entry.flight)return entry.flight;if(!this.current(entry))return Promise.resolve();entry.dirty=false;entry.controller=new AbortController();const controller=entry.controller,selected=plan(entry.source);
  const read=createDockBaseReader({get:key=>this.ports.bases.get(key),peek:key=>this.ports.bases.store.peek(key)},binding=>this.current(entry)&&selected.bindings.some(allowed=>canonicalJson(allowed)===canonicalJson(binding)),()=>this.current(entry));
  const flight=readDockBases(selected,read,{signal:controller.signal}).then(result=>{
   if(this.current(entry)&&!controller.signal.aborted)entry.readings={...result.readings};
  }).catch(error=>{
   if(!this.current(entry)||controller.signal.aborted)return;const code=error instanceof Error?error.message:'';
   if(code==='DOCK_BASE_SNAPSHOT_CHANGED'){entry.dirty=true;return;}
   const state:DockReading['state']=/FIELD|OWNER|RANGE|BINDING|DATE/.test(code)?'needs-setup':code.includes('DEADLINE')?'partial':'failed';
   entry.readings=Object.fromEntries(selected.queries.map(query=>[query.id,empty(state)]));
  }).finally(()=>{
   this.flights.delete(flight);if(entry.flight===flight){entry.flight=null;entry.controller=null;}
   if(!this.closed){this.arm();this.ports.changed();}
  });
  entry.flight=flight;this.flights.add(flight);return flight;
 }
 private arm(){
  if(this.closed||this.timer||![...this.entries.values()].some(entry=>entry.dirty&&!entry.flight&&this.current(entry)))return;
  this.timer=setTimeout(()=>{this.timer=null;if(this.closed)return;for(const entry of this.entries.values())if(entry.dirty&&!entry.flight&&this.current(entry))void this.start(entry);},50);this.timer.unref?.();
 }
 async close(){if(this.closed)return;this.closed=true;if(this.timer)clearTimeout(this.timer);this.timer=null;this.stopEvents?.();this.stopEvents=null;for(const entry of this.entries.values())entry.controller?.abort();this.entries.clear();this.surfaces.clear();this.authorityEpochs.clear();await Promise.allSettled([...this.flights]);}
}
