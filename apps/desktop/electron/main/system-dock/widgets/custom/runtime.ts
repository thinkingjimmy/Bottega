/**
 * [INPUT]: Depends on current local acceptance, verified packages, Provider account events, independent Usage scopes, Tasks and a shared visible clock.
 * [OUTPUT]: Provides bounded host readings, independent preview namespaces, zero-demand samples, account/Library/privacy/pause fences and exact consumer/subscription cleanup.
 * [POS]: Custom Widget runtime projection owner; no author code or independent per-summary process runs here.
 */
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import type {DockReading,DockReadingState} from '@bottega/contracts/plugins/dock/data';
import {WIDGET_PACKAGE_BUDGET,type WidgetPackageSource} from '@bottega/contracts/plugins/dock/packages';
import {summaryNodes,DOCK_SUMMARY_LIMITS} from '@bottega/contracts/plugins/dock/summary';
import type {DockWidget} from '../../../../../shared/system-dock/layout';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import type {DockEdge} from '../../../../../shared/system-dock/local-state';
import type {CustomWidgetFace,CustomWidgetDetail} from '../../../../../shared/system-dock/widgets/runtime';
import {summaryDescription} from '../../../../../shared/system-dock/widgets/presentation';
import {dockPluginManifestSchema,type DockPluginManifest} from '../../../apps/gui-build/source/manifest';
import type {WidgetPackageStore} from '../../../plugins/surface-runtime/packages/store';
import type {AcceptedWidget,LocalWidgetScope} from '../../store/custom/model';
import {DockUsage,type LimitsPort,type HistoryPort,type DockSurface} from '../usage';
import type {DockTasksPort} from '../tasks';
import {customDemandId,internalReading,internalWidget} from './data';
import type {DockCustomWidgetsPort,WidgetItem} from './ports';
import type {WidgetDetailSource} from '../detail/ports';
import {widgetDetailKey} from '../detail/scope';
import type {DockDetailPresentation} from '../../../../../shared/system-dock/widgets/native';
import type {DockBaseDataPort} from '../base/model';
import {dockApiFields} from '@bottega/contracts/plugins/dock/api';
import type {DockApiConsumer} from '../api/model';
import type {DockAction} from '@bottega/contracts/plugins/dock/session';
type Clock={now():number;setTimeout(callback:()=>void,ms:number):unknown;clearTimeout(id:unknown):void};
type CachedWidget={manifest:DockPluginManifest;source:WidgetPackageSource;contractDigest:string};
type Ports={scope():LocalWidgetScope;locale():string;masked():boolean;item(id:string):WidgetItem|null;accepted(item:WidgetItem):AcceptedWidget|null;
 availability?(item:WidgetItem):CustomWidgetFace['state'];usageScope?:'runtime'|'authoring-preview';sampleReadings?(dock:DockContribution):Readonly<Record<string,DockReading>>;
 packages:Pick<WidgetPackageStore,'read'>&Partial<Pick<WidgetPackageStore,'archiveRevision'>>;limits:LimitsPort|null;history:HistoryPort|null;tasks?:DockTasksPort;changed():void;clock?:Clock;presentation?(source:WidgetDetailSource):DockDetailPresentation;
 account?(backend:string):string|null;onAccounts?(listener:()=>void):()=>void;base?:DockBaseDataPort;api?:DockApiConsumer;
 actions?(itemId:string):readonly DockAction[];invokeAction?(itemId:string,ref:string):Promise<void>;pruneActions?():void};
export class DockCustomWidgets implements DockCustomWidgetsPort{
 private readonly usage:DockUsage;
 private readonly surfaces=new Map<DockSurface,readonly{itemId:string;widget:DockWidget}[]>();
 private readonly cache=new Map<string,CachedWidget>();
 private readonly pending=new Set<string>();
 private readonly failures=new Set<string>();
 private readonly failedArchives=new Map<string,number>();
 private readonly references=new Set<string>();
 private readonly wanted=new Map<string,AcceptedWidget>();
 private readonly clock:Clock;
 private timer:unknown=null;
 private timerInterval=0;
 private scopeKey='';private signature='';private epoch=0;private cacheRevision=0;private closed=false;
 private accounts=new Map<string,string|null>();
 private readonly stopAccounts:(()=>void)|null;
 private readonly demandSurfaces:{bar:'dock-custom-bar'|'dock-preview-bar';panel:'dock-custom-panel'|'dock-preview-panel'};
 constructor(private readonly ports:Ports){
  this.clock=ports.clock??{now:Date.now,setTimeout:(callback,ms)=>setTimeout(callback,ms),clearTimeout:id=>clearTimeout(id as ReturnType<typeof setTimeout>)};
  this.demandSurfaces=ports.usageScope==='authoring-preview'?{bar:'dock-preview-bar',panel:'dock-preview-panel'}:{bar:'dock-custom-bar',panel:'dock-custom-panel'};
  this.usage=new DockUsage(ports.sampleReadings?null:ports.limits,ports.sampleReadings?null:ports.history,()=>{if(!this.closed)ports.changed();},()=>this.clock.now());
  this.accounts=this.accountSnapshot();
  this.stopAccounts=ports.sampleReadings?null:ports.onAccounts?.(()=>{
   if(this.closed)return;const next=this.accountSnapshot(),changed=[...new Set([...this.accounts.keys(),...next.keys()])].filter(id=>this.accounts.get(id)!==next.get(id));this.accounts=next;
   if(!changed.length)return;for(const id of ports.history?.sources()??[])if(changed.includes(id))this.usage.resetHistory(id);
   ports.changed();
  })??null;
 }
 setVisible(surface:DockSurface,widgets:readonly{itemId:string;widget:DockWidget}[]){if(this.closed)return;this.surfaces.set(surface,widgets.filter(value=>value.widget.type==='custom'));this.reconcile();}
 async validate(dock:DockContribution,widget:CustomDockWidget){
  if(dock.data.some(source=>source.kind==='api')){if(!this.ports.api)throw new Error('DOCK_API_UNAVAILABLE');await this.ports.api.validate(dock,widget);}
  if(dock.data.some(source=>source.kind==='base')||widget.bindings.length){if(!this.ports.base)throw new Error('DOCK_BASE_CONFIGURATION_REQUIRED');await this.ports.base.validate(dock,widget);}
  for(const source of dock.data)if((source.kind==='limits'||source.kind==='activity')&&!internalWidget(source,widget,this.ports))throw new Error('DOCK_WIDGET_SOURCE_CONFIGURATION_REQUIRED');
 }
 reconcile(){
  if(this.closed)return;this.checkScope();for(const reference of this.failures)if((this.ports.packages.archiveRevision?.(reference)??0)!==(this.failedArchives.get(reference)??0)){this.failures.delete(reference);this.failedArchives.delete(reference);}this.wanted.clear();this.references.clear();
  const groups:unknown[]=[];
  for(const surface of ['dock-bar','dock-panel'] as const){
   const demands:Array<{itemId:string;widget:DockWidget}>=[],bases:WidgetDetailSource[]=[],apis:WidgetDetailSource[]=[];
   for(const entry of this.surfaces.get(surface)??[]){
    const item=this.ports.item(entry.itemId),accepted=item&&this.current(item);if(!accepted||accepted.paused||this.ports.masked())continue;
    groups.push([surface,item!.id,accepted.revision,accepted.widget.definition.packageRef]);
    this.references.add(accepted.widget.definition.packageRef);
    if(!this.cache.has(accepted.widget.definition.packageRef)){this.load(accepted.widget.definition.packageRef);continue;}
    const manifest=this.manifestFor(accepted);if(!manifest)continue;
    if(surface==='dock-panel'&&manifest.dock.detail.kind==='surface'&&this.ports.presentation?.(this.describe(item!,accepted,manifest)).state==='failed')continue;
    this.wanted.set(item!.id,accepted);
    if(this.ports.sampleReadings)continue;
    if(manifest.dock.data.some(source=>source.kind==='api'))apis.push(this.describe(item!,accepted,manifest));
    if(manifest.dock.data.some(source=>source.kind==='base'))bases.push(this.describe(item!,accepted,manifest));
    if(manifest.dock.refresh.mode==='manual')continue;
    for(const source of manifest.dock.data){const widget=internalWidget(source,accepted.widget,this.ports);if(widget)demands.push({itemId:customDemandId(item!.id,source.id),widget});}
   }
   this.usage.setVisible(surface==='dock-bar'?this.demandSurfaces.bar:this.demandSurfaces.panel,demands);
   if(!this.ports.sampleReadings){this.ports.base?.setVisible(surface,bases);this.ports.api?.setVisible(surface,apis);}
  }
  for(const reference of this.failures)if(!this.references.has(reference)){this.failures.delete(reference);this.failedArchives.delete(reference);}
  this.ports.pruneActions?.();this.arm();const signature=canonicalJson([this.scopeKey,this.ports.masked(),this.cacheRevision,groups]);
  if(signature!==this.signature){this.signature=signature;this.ports.changed();}
 }
 face(item:WidgetItem,edge:DockEdge):CustomWidgetFace{
  this.checkScope();const accepted=this.current(item),size=accepted?.widget.size??(item.widget.type==='custom'?item.widget.size:'small');
  const empty=(state:CustomWidgetFace['state']):CustomWidgetFace=>({type:'custom',size,state,summary:null,description:null,readings:{}});
  if(!accepted)return empty(this.ports.availability?.(item)??'definition-missing');if(accepted.paused)return empty('paused');if(this.ports.masked())return empty('ready');
  const reference=accepted.widget.definition.packageRef,manifest=this.manifestFor(accepted);if(!manifest)return empty(this.failures.has(reference)||this.cache.has(reference)?'failed':'loading');
  if(!this.wanted.has(item.id))return empty('loading');const summary=manifest.dock.summaries[accepted.widget.size]?.[edge];if(!summary)return empty('needs-setup');
  const all=this.readings(accepted,manifest.dock),readings:Record<string,DockReading>={};
  for(const node of summaryNodes(summary)){
   const binding='text' in node&&node.text.kind==='binding'?node.text:'source' in node?node:null;if(!binding)continue;const reading=all[binding.source];if(!reading)continue;
   const fields=['field' in binding?binding.field:'','maximumField' in binding?binding.maximumField:''].filter(Boolean) as string[];
   const existing=readings[binding.source];readings[binding.source]={state:reading.state,updatedAt:reading.updatedAt,values:{...existing?.values,...Object.fromEntries(fields.map(field=>[field,reading.values[field]??null]))}};
  }
  const states=Object.values(all).map(reading=>reading.state),state:DockReadingState=states.every(value=>value==='ready')?'ready':states.every(value=>value===states[0])?states[0]!:'partial';
  const face:CustomWidgetFace={type:'custom',size,state,summary,...(item.widget.type==='custom'&&canonicalJson(item.widget)!==canonicalJson(accepted.widget)?{updateAvailable:true}:{}),description:summaryDescription(summary,readings,this.ports.locale()),readings};return Buffer.byteLength(JSON.stringify(face))<=DOCK_SUMMARY_LIMITS.bytes?face:empty('failed');
 }
 detail(item:WidgetItem,edge:DockEdge):CustomWidgetDetail|null{
  const face=this.face(item,edge),accepted=this.current(item);if(!accepted)return{itemId:item.id,name:item.label??'',face,data:[],updatedAt:null,surface:null,actions:[]};
  const manifest=this.manifestFor(accepted),readings=manifest&&this.wanted.has(item.id)&&!this.ports.masked()&&!accepted.paused?this.readings(accepted,manifest.dock):{};
  const data=manifest?.dock.data.flatMap(source=>readings[source.id]?[{id:source.id,kind:source.kind,reading:readings[source.id]!,...(source.kind==='clock'?{timeZone:source.timeZone,
   ...(source.deadlineSetting&&typeof accepted.widget.settings[source.deadlineSetting]==='string'?{deadline:String(accepted.widget.settings[source.deadlineSetting])}:{})}:source.kind==='api'?{label:source.purpose,fields:dockApiFields(source),attribution:source.attribution}:source.kind==='base'?{operation:source.operation,timeZone:source.timeZone??accepted.widget.bindings.find(binding=>binding.slot===source.binding)?.filter.find(filter=>filter.op==='on-day')?.timeZone}:{})}]:[])??[],times=data.flatMap(value=>value.reading.updatedAt===null?[]:[value.reading.updatedAt]);
  const source=manifest?this.describe(item,accepted,manifest):null,surface=source&&manifest!.dock.detail.kind==='surface'&&!accepted.paused&&!this.ports.masked()?(this.ports.presentation?.(source)??{key:widgetDetailKey(source),state:'failed' as const}):null;
  return{itemId:item.id,name:item.label??manifest?.name??'',face,data,updatedAt:times.length?Math.min(...times):null,surface,actions:surface?[]:this.ports.actions?.(item.id)??[]};
 }
 async invokeAction(itemId:string,ref:string){if(!this.ports.invokeAction)throw new Error('DOCK_ACTION_UNAVAILABLE');try{await this.ports.invokeAction(itemId,ref);}finally{this.ports.changed();}}
 source(itemId:string):WidgetDetailSource|null{
  this.checkScope();const item=this.ports.item(itemId),accepted=item&&this.current(item);if(!item||!accepted||accepted.paused||this.ports.masked())return null;const manifest=this.manifestFor(accepted);return manifest?this.describe(item,accepted,manifest):null;
 }
 read(itemId:string,sources?:readonly string[]):Readonly<Record<string,DockReading>>{
  const source=this.source(itemId);if(!source||!this.wanted.has(itemId))throw new Error('DOCK_DATA_UNAVAILABLE');
  const ids=sources??source.manifest.dock.data.map(value=>value.id);if(new Set(ids).size!==ids.length||ids.some(id=>!source.manifest.dock.data.some(value=>value.id===id)))throw new Error('DOCK_DATA_UNDECLARED');
  const readings=this.readings(source.accepted,source.manifest.dock);return Object.fromEntries(ids.map(id=>[id,readings[id]!]));
 }
 async refresh(itemId:string){
  if(this.ports.sampleReadings){if(!this.closed)this.ports.changed();return;}
  this.checkScope();const item=this.ports.item(itemId),accepted=item&&this.current(item);if(!item||!accepted||accepted.paused||this.ports.masked()||!this.wanted.has(itemId))throw new Error('DOCK_WIDGET_NOT_VISIBLE');
  const reference=accepted.widget.definition.packageRef;this.failures.delete(reference);if(!this.cache.has(reference)){await this.load(reference);return;}
  const manifest=this.manifestFor(accepted);if(!manifest)throw new Error('WIDGET_PACKAGE_IDENTITY_CHANGED');
  if(manifest.dock.data.some(source=>source.kind==='api'))await this.ports.api?.refresh(itemId);
  if(manifest.dock.data.some(source=>source.kind==='base'))await this.ports.base?.refresh(itemId);
  for(const source of manifest.dock.data){const widget=internalWidget(source,accepted.widget,this.ports);if(widget)await this.usage.refresh(widget);}
  if(!this.closed)this.ports.changed();
 }
 private accountSnapshot(){return new Map<string,string|null>(this.ports.sampleReadings?[]:[...new Set([...(this.ports.limits?.snapshot().agents.map(value=>value.backend)??[]),...(this.ports.history?.sources()??[])])].map(id=>[id,this.ports.account?.(id)??null]));}
 private describe(item:WidgetItem,accepted:AcceptedWidget,manifest:DockPluginManifest):WidgetDetailSource{
  const sources=this.ports.sampleReadings?[]:manifest.dock.data.flatMap(source=>{
   const selected=source.kind==='limits'?accepted.widget.settings[source.backendSetting]:source.kind==='activity'?accepted.widget.settings[source.sourceSetting]:null;
   const backends=source.kind==='activity'&&selected==='all'?this.ports.history?.sources()??[]:typeof selected==='string'?[selected]:[];
   return backends.map(id=>[source.id,id,this.ports.account?.(id)??null]);
  });const source={item,accepted,manifest,dataIdentity:canonicalJson(sources)};return{...source,dataIdentity:this.ports.sampleReadings?'sample':canonicalJson([sources,this.ports.base?.identity(source)??null,this.ports.api?.identity(source)??null])};
 }
 private current(item:WidgetItem){
  const accepted=this.ports.accepted(item);return accepted&&accepted.itemId===item.id&&canonicalJson(accepted.scope)===canonicalJson(this.ports.scope())?accepted:null;
 }
 private manifestFor(accepted:AcceptedWidget){
  const definition=accepted.widget.definition,cached=this.cache.get(definition.packageRef);if(!cached)return null;const source=cached.source;
  return source.accountId===accepted.scope.accountId&&source.installationId===definition.sourceInstallationId&&source.definitionId===definition.definitionId&&source.generationId===definition.generationId&&cached.contractDigest===definition.contractDigest?cached.manifest:null;
 }
 private readings(accepted:AcceptedWidget,dock:DockContribution){return this.ports.sampleReadings?.(dock)??Object.fromEntries(dock.data.map(source=>[source.id,source.kind==='api'?(this.ports.api?.reading(accepted.itemId,source.id)??{state:'needs-authorization' as const,updatedAt:null,values:{}}):source.kind==='base'?(this.ports.base?.reading(accepted.itemId,source.id)??{state:'needs-setup' as const,updatedAt:null,values:{}}):internalReading(source,accepted.widget,{...this.ports,usage:this.usage,now:this.clock.now(),locale:this.ports.locale()})]));}
 private checkScope(){
  const next=canonicalJson(this.ports.scope());if(next===this.scopeKey)return;this.scopeKey=next;this.epoch++;this.cache.clear();this.pending.clear();this.failures.clear();this.failedArchives.clear();this.references.clear();this.wanted.clear();this.cacheRevision++;
  if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;this.timerInterval=0;
  this.ports.api?.setVisible('dock-bar',[]);this.ports.api?.setVisible('dock-panel',[]);
  this.usage.setVisible(this.demandSurfaces.bar,[]);this.usage.setVisible(this.demandSurfaces.panel,[]);this.usage.resetHistory();
 }
 private load(reference:string):Promise<void>{
  if(this.closed||this.pending.has(reference)||this.failures.has(reference))return Promise.resolve();const epoch=this.epoch,archiveRevision=this.ports.packages.archiveRevision?.(reference)??0;this.pending.add(reference);
  return this.ports.packages.read(reference).then(packet=>{
   if(this.closed||epoch!==this.epoch||!this.references.has(reference))return;
   const raw=packet.files.find(file=>file.path==='runtime/plugin.json');if(!raw)throw new Error('WIDGET_PACKAGE_MANIFEST_MISSING');
   const manifest=dockPluginManifestSchema.parse(JSON.parse(Buffer.from(raw.content,'base64').toString('utf8')));
   if(packet.descriptor.source.accountId!==this.ports.scope().accountId||packet.descriptor.source.definitionId!==manifest.id)throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
   if(this.cache.size>=WIDGET_PACKAGE_BUDGET.retainedPackages)for(const key of this.cache.keys())if(!this.references.has(key)){this.cache.delete(key);if(this.cache.size<WIDGET_PACKAGE_BUDGET.retainedPackages)break;}
   if(this.cache.size>=WIDGET_PACKAGE_BUDGET.retainedPackages)throw new Error('WIDGET_PACKAGE_CACHE_CAPACITY');this.cache.set(reference,{manifest,source:packet.descriptor.source,contractDigest:packet.descriptor.contractDigest});this.cacheRevision++;
  }).catch(()=>{if(!this.closed&&epoch===this.epoch&&this.references.has(reference)){this.failures.add(reference);this.failedArchives.set(reference,archiveRevision);this.cacheRevision++;}}).finally(()=>{if(!this.closed&&epoch===this.epoch){this.pending.delete(reference);this.reconcile();}});
 }
 private arm(){
  const clocks=this.ports.sampleReadings?[]:[...this.wanted.values()].flatMap(value=>this.manifestFor(value)?.dock.data.filter(source=>source.kind==='clock')??[]);
  if(!clocks.length){if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;this.timerInterval=0;return;}
  const interval=clocks.some(source=>source.kind==='clock'&&source.precision==='second')?1000:60000;
  if(this.timer!==null&&this.timerInterval===interval)return;if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timerInterval=interval;
  this.timer=this.clock.setTimeout(()=>{this.timer=null;this.timerInterval=0;if(this.closed)return;this.checkScope();this.ports.changed();this.arm();},interval-this.clock.now()%interval);
 }
 async close(){this.closed=true;this.stopAccounts?.();this.accounts.clear();if(this.timer!==null)this.clock.clearTimeout(this.timer);this.timer=null;if(!this.ports.sampleReadings){this.ports.base?.setVisible('dock-bar',[]);this.ports.base?.setVisible('dock-panel',[]);this.ports.api?.setVisible('dock-bar',[]);this.ports.api?.setVisible('dock-panel',[]);}this.usage.close();this.wanted.clear();this.references.clear();this.surfaces.clear();this.cache.clear();this.failures.clear();this.failedArchives.clear();this.pending.clear();}
}
