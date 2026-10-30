/**
 * [INPUT]: Depends on strict preview controls, verified held candidates, exact Main-window scope and independent temporary data/native runtimes.
 * [OUTPUT]: Provides DockWidgetPreviews with explicit sample/real preparation, visibility/consent gates, suspension, request replay and complete release.
 * [POS]: Temporary authoring authority; it never writes layout, source activation, accepted mappings, instance grants or delivery state; stable draft configuration belongs to its API owner.
 */
import {randomBytes,createHash} from 'node:crypto';
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import {defaultDockSettings,validateDockSettings} from '@bottega/contracts/plugins/dock/settings';
import {customDockWidgetSchema} from '../../../../../shared/system-dock/widgets/instance';
import {WIDGET_PREVIEW_BUDGET as BUDGET,parseWidgetPreviewControl,widgetPreviewConfigurationSchema,type WidgetPreviewControl,type WidgetPreviewSnapshot,type WidgetPreviewResult,type WidgetPreviewHealth} from '../../../../../shared/system-dock/widgets/preview/contracts';
import {basePermissionFor} from '../../store/custom/base-access';
import type {WidgetPreviewPorts,WidgetPreviewRuntime,WidgetPreviewSession} from './ports';
type Active={session:WidgetPreviewSession;runtime:WidgetPreviewRuntime;revision:number;requested:boolean;visible:boolean;announcement:'action-example'|null;expiresAt:number;cancelExpiry:()=>void;unwatch:()=>void};
type Pending={windowId:number;requestId:string;hash:string;cancelled:boolean;promise:Promise<WidgetPreviewSnapshot>};
export class DockWidgetPreviews{
 private active:Active|null=null;
 private pending:Pending|null=null;
 private readonly requests=new Map<string,{windowId:number;hash:string;expiresAt:number}>();
 private readonly cleaning=new Map<Promise<void>,WidgetPreviewRuntime>();
 private readonly ownedRuntimes=new Set<WidgetPreviewRuntime>();
 private readonly failures:unknown[]=[];
 private closed=false;
 constructor(private readonly ports:WidgetPreviewPorts){}
 async command(windowId:number,raw:unknown):Promise<WidgetPreviewResult>{
  if(this.closed)throw new Error('DOCK_PREVIEW_CLOSED');const input=parseWidgetPreviewControl(raw),window=this.ports.window(windowId);if(!window||window.isDestroyed())throw new Error('DOCK_PREVIEW_WINDOW_UNAVAILABLE');
  if(input.kind==='open')return this.open(windowId,input);
  if(input.kind==='draft')return this.ports.draft(input.previewId,input.chatId,input.targetId);
  if(input.kind==='close'&&input.requestId){const known=this.requests.get(input.requestId);if(!known||known.windowId!==windowId)throw new Error('DOCK_PREVIEW_SCOPE_CHANGED');if(this.pending?.requestId===input.requestId)this.pending.cancelled=true;if(this.active?.session.requestId===input.requestId)await this.stop(this.active,'closed');return null;}
  const active=this.require(windowId,'sessionId'in input?input.sessionId:undefined);
  if(input.kind==='close'){await this.stop(active,'closed');return null;}
  if(input.kind==='present'){active.requested=input.visible;this.reconcile();return this.snapshot(active);}
  if(input.kind==='theme'){active.session.theme=input.theme;this.emit(active);return this.snapshot(active);}
  if(input.kind==='read')return this.snapshot(active);
  if(!active.visible)throw new Error('DOCK_PREVIEW_NOT_VISIBLE');
  if(input.kind==='bounds'){if(active.runtime.snapshot().surface?.key!==input.key)throw new Error('DOCK_PREVIEW_SCOPE_CHANGED');active.runtime.bounds(input.bounds?{itemId:active.session.item.id,key:input.key,bounds:input.bounds}:null);}
  else if(input.kind==='retry')active.runtime.retry(input.key);
  else if(input.kind==='refresh'){
   if(active.session.mode==='real'){await active.runtime.refresh();this.require(windowId,active.session.id);}else active.announcement='action-example';
  }else if(input.kind==='action'){
   if(!active.runtime.snapshot().actions.some(action=>action.ref===input.ref))throw new Error('DOCK_ACTION_UNAVAILABLE');active.announcement='action-example';
  }
  this.emit(active);return this.snapshot(active);
 }
 private async open(windowId:number,input:Extract<WidgetPreviewControl,{kind:'open'}>):Promise<WidgetPreviewSnapshot>{
  const hash=createHash('sha256').update(canonicalJson(input)).digest('hex'),known=this.requests.get(input.requestId);
  if(known){if(known.windowId!==windowId||known.hash!==hash)throw new Error('DOCK_OPERATION_CONFLICT');if(this.pending?.requestId===input.requestId)return this.pending.promise;if(this.active?.session.requestId===input.requestId)return this.snapshot(this.require(windowId,this.active.session.id));throw new Error('DOCK_PREVIEW_CLOSED');}
  if(this.pending||this.active&&this.active.session.windowId!==windowId)throw new Error('DOCK_PREVIEW_CAPACITY');if(this.failures.length)throw new Error('DOCK_PREVIEW_CLEANUP_FAILED');
  const now=this.now();for(const [id,value]of this.requests)if(value.expiresAt<=now)this.requests.delete(id);if(this.requests.size>=BUDGET.recentRequests)throw new Error('DOCK_PREVIEW_CAPACITY');
  this.requests.set(input.requestId,{windowId,hash,expiresAt:now+BUDGET.sessionMs});
  const pending:Pending={windowId,requestId:input.requestId,hash,cancelled:false,promise:Promise.resolve(null as never)};this.pending=pending;
  const task=(async()=>{
   if(this.active)await this.stop(this.active,'closed');
   const prepared=await this.ports.prepare(input.previewId,input.chatId),window=this.ports.window(windowId);
   const current=()=>!this.closed&&!pending.cancelled&&this.ports.current(prepared)&&Boolean(window&&!window.isDestroyed())&&this.now()<Math.min(prepared.expiresAt,now+BUDGET.sessionMs);
   if(!current()||prepared.chatId!==input.chatId||prepared.preview.previewId!==input.previewId)throw new Error('DOCK_PREVIEW_CONFLICT');
   if(input.targetId&&!prepared.preview.instanceIds.includes(input.targetId))throw new Error('DOCK_PREVIEW_SCOPE_CHANGED');
   if(input.mode==='real'&&!input.configuration)throw new Error('DOCK_PREVIEW_CONFIGURATION_REQUIRED');
   const configuration=widgetPreviewConfigurationSchema.parse(input.configuration??{name:prepared.preview.name,size:prepared.preview.dock.sizes[0],settings:defaultDockSettings(prepared.preview.dock.settings),bindings:[],baseConsent:false});
   const widget=customDockWidgetSchema.parse({type:'custom',configVersion:1,size:configuration.size,settings:configuration.settings,bindings:configuration.bindings,definition:{definitionId:prepared.preview.id,sourceInstallationId:prepared.preview.executionInstallationId,generationId:prepared.preview.generationId,packageRef:prepared.preview.packageRef,contractDigest:prepared.preview.contractDigest}});
   if(!prepared.preview.dock.sizes.includes(widget.size)||input.mode==='real'&&validateDockSettings(prepared.preview.dock.settings,widget.settings).length)throw new Error('DOCK_PREVIEW_CONFIGURATION_REQUIRED');
   const id=randomBytes(16).toString('hex'),itemId='preview-'+id,permission=input.mode==='real'?basePermissionFor({itemId,scope:prepared.scope,widget,dock:prepared.preview.dock,prior:null,consent:configuration.baseConsent}):{baseAccess:'unconfirmed' as const,baseGrant:null};
   const session:WidgetPreviewSession={id,requestId:input.requestId,windowId,window:window!,prepared,mode:input.mode,theme:input.theme,apiConsent:configuration.apiConsent,...(input.targetId?{apiTargetId:input.targetId}:{}),item:{id:itemId,kind:'widget',label:configuration.name,widget},accepted:{scope:prepared.scope,itemId,widget,paused:false,revision:1,lastOperationId:null,...permission}};
   const runtime=await this.ports.createRuntime(session,()=>current()&&this.active?.session===session&&this.active.visible,()=>{if(this.active?.session===session){this.reconcile();this.emit(this.active);}});
   this.ownedRuntimes.add(runtime);if(!current()){await this.disposeRuntime(runtime);throw new Error('DOCK_PREVIEW_CONFLICT');}
   const expiresAt=Math.min(prepared.expiresAt,now+BUDGET.sessionMs),expired=()=>{if(this.active===active)void this.stop(active,'expired').catch(error=>console.warn('[system-dock] Preview expiry cleanup failed',error));};
   const cancelExpiry=this.ports.schedule?.(Math.max(1,expiresAt-this.now()),expired)??(()=>{const timer=setTimeout(expired,Math.max(1,expiresAt-this.now()));timer.unref?.();return()=>clearTimeout(timer);})();
   const active:Active={session,runtime,revision:0,requested:false,visible:false,announcement:null,expiresAt,cancelExpiry,unwatch:()=>undefined};this.active=active;active.unwatch=this.ports.watch(window!,()=>this.reconcile());this.emit(active);return this.snapshot(active);
  })().finally(()=>{if(this.pending===pending)this.pending=null;});pending.promise=task;return task;
 }
 private require(windowId:number,id:string|undefined){
  this.reconcile();const active=this.active;if(!active||active.session.id!==id||active.session.windowId!==windowId)throw new Error('DOCK_PREVIEW_SCOPE_CHANGED');return active;
 }
 reconcile(){
  const active=this.active;if(!active||this.closed)return;const {session}=active;
  const reason=session.window.isDestroyed()?'window-closed':this.now()>=active.expiresAt?'expired':!this.ports.current(session.prepared)?'conflict':null;
  if(reason){void this.stop(active,reason).catch(error=>console.warn('[system-dock] Preview cleanup failed',error));return;}
  const visible=active.requested&&session.window.isVisible()&&!session.window.isMinimized()&&!this.ports.masked()&&!this.ports.locked();
  if(visible!==active.visible){active.visible=visible;active.runtime.setVisible(visible);this.emit(active);}
 }
 private snapshot(active:Active,state?:'closed',reason?:WidgetPreviewSnapshot['reason']):WidgetPreviewSnapshot{
  const {session}=active,value:WidgetPreviewSnapshot={sessionId:session.id,revision:active.revision,previewId:session.prepared.preview.previewId,definitionId:session.prepared.preview.id,mode:session.mode,name:session.item.label??session.prepared.preview.name,executionComputer:[...this.ports.computerName().replace(/[\p{Cc}\p{Cf}]/gu,' ')].slice(0,128).join(''),theme:session.theme,state:state??(active.visible?'active':active.requested?'suspended':'prepared'),detail:state!=='closed'&&active.visible?active.runtime.snapshot():null,announcement:active.announcement,...(reason?{reason}:{})};
  if(Buffer.byteLength(JSON.stringify(value))>BUDGET.snapshotBytes)throw new Error('DOCK_PREVIEW_OUTPUT_BUDGET');return value;
 }
 private emit(active:Active){if(this.active!==active)return;active.revision++;try{this.ports.publish(active.session.windowId,this.snapshot(active));}catch(error){console.warn('[system-dock] Preview observer failed',error);}}
 private async stop(active:Active,reason:NonNullable<WidgetPreviewSnapshot['reason']>){
  if(this.active!==active)return;this.active=null;active.cancelExpiry();active.unwatch();active.visible=false;active.runtime.setVisible(false);
  active.revision++;try{this.ports.publish(active.session.windowId,this.snapshot(active,'closed',reason));}catch(error){console.warn('[system-dock] Preview observer failed',error);}
  await this.disposeRuntime(active.runtime);
 }
 private async disposeRuntime(runtime:WidgetPreviewRuntime){
  const task=Promise.resolve().then(()=>runtime.close()).then(()=>{this.ownedRuntimes.delete(runtime);}).catch(error=>{this.failures.push(error);throw error;}).finally(()=>{this.cleaning.delete(task);});this.cleaning.set(task,runtime);await task;
 }
 health():WidgetPreviewHealth{
  const runtimes=this.ownedRuntimes,detail={views:0,sessions:0,timers:0,requests:0},base={consumers:0,flights:0,timers:0};
  for(const runtime of runtimes){const value=runtime.health();for(const key of Object.keys(detail) as(keyof typeof detail)[])detail[key]+=value.detail[key];for(const key of Object.keys(base) as(keyof typeof base)[])base[key]+=value.base?.[key]??0;}
  return{sessions:Number(this.active!==null),pending:Number(this.pending!==null),timers:Number(this.active!==null),cleanups:this.cleaning.size,failures:this.failures.length,detail,base};
 }
 private now(){return this.ports.now?.()??Date.now();}
 async close(){if(!this.closed){this.closed=true;if(this.pending)this.pending.cancelled=true;const active=this.active;if(active)await this.stop(active,'closed').catch(()=>{});await this.pending?.promise.catch(()=>{});await Promise.allSettled([...this.cleaning.keys()]);this.requests.clear();}if(this.failures.length)throw new AggregateError(this.failures,'DOCK_PREVIEW_CLEANUP_FAILED');}
}
