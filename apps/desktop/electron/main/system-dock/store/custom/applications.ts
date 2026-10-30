/**
 * [INPUT]: Depends on source preview validation, immutable package custody, serialized layout CAS, operation-bound activation and local accepted-runtime schemas.
 * [OUTPUT]: Provides sealed previews, temporary preview context/configuration, per-instance repairs with obsolete Base slots removed, account-local acceptance, independent grants, recoverable application and layout/account-driven retirement without stale permission revival, plus journal-bound API association and completion acknowledgement.
 * [POS]: Cross-owner Widget application coordinator; the journal records partial progress instead of assuming atomic writes across owners.
 */
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import {allocateWidgetName,defaultDockSettings,validateDockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import {dockWidgetItemSchema,type DockItem,type DockLayout} from '../../../../../shared/system-dock/layout';
import {addItem} from '../../../../../shared/system-dock/placement';
import {applyDockWidgetSchema,widgetPreviewSchema,type WidgetPreview,type WidgetApplyInput,type WidgetApplyReceipt,type WidgetVersionView} from '../../../../../shared/system-dock/widgets/authoring';
import {customDockWidgetSchema,type CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import type {PluginSurfaceRuntime} from '../../../plugins/surface-runtime/service';
import type {DockAuthoringService} from '../../../plugins/authoring/dock/service';
import type {WidgetPackageStore} from '../../../plugins/surface-runtime/packages/store';
import {DurableJson} from '../../../persistence/durable-json';
import type {DockConfigStore} from '../config-store';
import {localWidgetRuntimeSchema,localWidgetScopeSchema,type AcceptedWidget,type CustomWidgetItem,type LocalWidgetScope,type WidgetApplication,type WidgetApiHooks} from './model';
import {widgetInstanceIdSchema} from '../../../../../shared/system-dock/widgets/entry';
import {basePermissionFor,type BasePermission} from './base-access';
import {widgetInstanceFormSchema,type WidgetInstanceForm} from '../../../../../shared/system-dock/widgets/management';
import {stageWidgetUpdateSchema,widgetUpdateReviewSchema,type StageWidgetUpdate,type WidgetUpdateReview} from '../../../../../shared/system-dock/widgets/review';
import {widgetPreviewConfigurationSchema} from '../../../../../shared/system-dock/widgets/preview/contracts';
type ReviewDraft={target:CustomWidgetItem;permission:BasePermission;apiConsent:readonly string[];expectedRevision:number|null};
export type WidgetMappingMutation={put(mapping:AcceptedWidget):Promise<void>;remove(target:Pick<AcceptedWidget,'scope'|'itemId'>&{keepApiCredentials?:boolean}):Promise<void>};
type PreviewEntry={scope:LocalWidgetScope;expiresAt:number;value:WidgetPreview;reviewId:string;drafts:Map<string,ReviewDraft>;requests:Map<string,string>};
type Ports={userData:string;config:DockConfigStore;runtime:PluginSurfaceRuntime;authoring:DockAuthoringService;packages:WidgetPackageStore;scope():LocalWidgetScope;locale():string;changed():void;
 api?:WidgetApiHooks;canApply?(definitionId:string):boolean;validateData?(dock:DockContribution,widget:CustomDockWidget):Promise<void>};
const candidateBindings=(dock:DockContribution,bindings:CustomDockWidget['bindings'])=>{
 const slots=new Set(dock.data.filter(source=>source.kind==='base').map(source=>source.binding));return bindings.filter(binding=>slots.has(binding.slot));
};
export class DockWidgetApplications{
 private readonly file:DurableJson<ReturnType<typeof localWidgetRuntimeSchema.parse>>;
 private readonly previews=new Map<string,PreviewEntry>();
 private mappings:readonly AcceptedWidget[]=[];
 private tail:Promise<unknown>=Promise.resolve();
 private retirement:Promise<void>|null=null;
 private closed=true;
 constructor(private readonly ports:Ports){this.file=new DurableJson(join(ports.userData,'dock-widget-runtime.json'),localWidgetRuntimeSchema,()=>({version:1,mappings:[],operations:[]}));}
 async initialize(){await this.file.initialize();this.closed=false;this.publish();}
 async build(id:string){await this.ports.authoring.build(id);return this.preview(id);}
 async preview(id:string):Promise<WidgetPreview>{
  this.assertDefinition(id);const scope=this.liveScope(),raw=await this.ports.authoring.preview(id),frozen=await this.ports.packages.prepare(id,raw.generationId);this.assertScope(scope);
  const checked=await this.ports.authoring.preview(id);if(checked.generationId!==raw.generationId||checked.sourceFingerprint!==raw.sourceFingerprint)throw new Error('DOCK_PREVIEW_CONFLICT');
  return this.remember(raw,scope,frozen,'candidate');
 }
 versions(id:string):WidgetVersionView[]{
  this.liveScope();if(!this.ports.authoring.definitions().some(definition=>definition.id===id))throw new Error('DOCK_WIDGET_NOT_FOUND');
  const active=this.ports.runtime.descriptor(id)?.activeGenerationId;
  return this.ports.runtime.history(id).filter(generation=>'dock'in generation.manifest).map(generation=>({generationId:generation.generationId,version:generation.manifest.version,createdAt:generation.createdAt,active:generation.generationId===active,available:generation.available}));
 }
 async previewVersion(id:string,generationId:string):Promise<WidgetPreview>{
  this.assertDefinition(id);const scope=this.liveScope();this.versions(id);const active=this.ports.runtime.descriptor(id)?.activeGenerationId;
  const raw=await this.ports.runtime.dockVersion(id,generationId),frozen=await this.ports.packages.prepare(id,generationId);this.assertScope(scope);
  if(this.ports.runtime.descriptor(id)?.activeGenerationId!==active)throw new Error('DOCK_PREVIEW_CONFLICT');
  return this.remember(raw,scope,frozen,'version');
 }
 private remember(raw:Awaited<ReturnType<PluginSurfaceRuntime['dockPreview']>>,scope:LocalWidgetScope,frozen:Awaited<ReturnType<WidgetPackageStore['prepare']>>,kind:'candidate'|'version'){
  const id=raw.id,record=this.ports.runtime.descriptor(id);if(!record)throw new Error('DOCK_WIDGET_NOT_FOUND');
  const instances=this.instances(id),active=record.activeGenerationId;
  const replacement=kind==='candidate'&&active===null?this.ports.authoring.replacement(id):null;
  if(replacement&&canonicalJson(this.ports.config.layout().items.find(item=>item.id===replacement.item.id)??null)!==canonicalJson(replacement.item))throw new Error('DOCK_PREVIEW_CONFLICT');
  const applied=active===raw.generationId&&instances.every(item=>this.accepted(item)?.widget.definition.packageRef===frozen.reference&&item.widget.type==='custom'&&item.widget.definition.packageRef===frozen.reference);
  const value=widgetPreviewSchema.parse({...raw,kind,previewId:randomUUID().replaceAll('-',''),packageRef:frozen.reference,contractDigest:frozen.descriptor.contractDigest,executionInstallationId:scope.installationId,
   mode:applied?'applied':replacement?'replace':kind==='candidate'&&active===null?'add':instances.length?'update':'save',replacement,layoutRevision:this.ports.config.snapshot().localRevision,expectedActiveGenerationId:active,instanceIds:replacement?[replacement.item.id]:instances.map(item=>item.id)});
  for(const [key,entry]of this.previews)if(entry.expiresAt<=Date.now())this.previews.delete(key);
  while(this.previews.size>=16)this.previews.delete(this.previews.keys().next().value!);
  this.previews.set(value.previewId,{scope,expiresAt:Date.now()+10*60_000,value,reviewId:randomUUID().replaceAll('-',''),drafts:new Map(),requests:new Map()});return value;
 }
 previewContext(previewId:string){
  this.liveScope();const entry=this.previews.get(previewId);if(!entry||entry.expiresAt<=Date.now())throw new Error('DOCK_PREVIEW_EXPIRED');this.assertScope(entry.scope);
  const definition=this.ports.authoring.definitions().find(value=>value.id===entry.value.id),record=this.ports.runtime.descriptor(entry.value.id);
  if(!definition||!record||record.activeGenerationId!==entry.value.expectedActiveGenerationId||this.ports.config.snapshot().localRevision!==entry.value.layoutRevision||entry.value.kind==='candidate'&&(record.error||record.candidateGenerationId!==entry.value.generationId))throw new Error('DOCK_PREVIEW_CONFLICT');
  return{preview:structuredClone(entry.value),scope:structuredClone(entry.scope),chatId:definition.chatId,expiresAt:entry.expiresAt};
 }
 previewDraft(previewId:string,chatId:string,targetId?:string){return this.enqueue(async()=>{
  const context=this.previewContext(previewId),preview=context.preview;if(context.chatId!==chatId||targetId&&!preview.instanceIds.includes(targetId))throw new Error('DOCK_PREVIEW_SCOPE_CHANGED');
  const id=targetId??(preview.instanceIds.length===1?preview.instanceIds[0]:null),selected=id?this.ports.config.layout().items.find(value=>value.id===id):null,item=selected?.kind==='widget'?selected:null;
  const prior=item?.widget.type==='custom'?(this.accepted(item)?.widget??item.widget):null,dock=preview.dock;
  return widgetPreviewConfigurationSchema.parse({name:item?.label??preview.name,size:prior&&dock.sizes.includes(prior.size)?prior.size:dock.sizes[0],settings:{...defaultDockSettings(dock.settings),...Object.fromEntries(dock.settings.flatMap(field=>prior&&Object.hasOwn(prior.settings,field.id)?[[field.id,prior.settings[field.id]]]:[]))},bindings:candidateBindings(dock,prior?.bindings??[]),baseConsent:false});
 });}
 updateReview(previewId:string):Promise<WidgetUpdateReview>{return this.enqueue(()=>this.reviewStatus(this.reviewEntry(previewId)));}
 updateForm(previewId:string,itemId:string):Promise<WidgetInstanceForm>{return this.enqueue(async()=>{
  const entry=this.reviewEntry(previewId),item=this.reviewItems(entry).find(item=>item.id===itemId);if(!item)throw new Error('DOCK_WIDGET_NOT_FOUND');
  const prior=this.accepted(item),saved=entry.drafts.get(itemId);
  if(saved&&saved.expectedRevision!==(prior?.revision??null))throw new Error('DOCK_PREVIEW_CONFLICT');
  const dock=entry.value.dock,widget=saved?.target.widget??customDockWidgetSchema.parse({...item.widget,definition:this.definition(entry.value),bindings:candidateBindings(dock,item.widget.bindings),size:dock.sizes.includes(item.widget.size)?item.widget.size:dock.sizes[0],
   settings:{...defaultDockSettings(dock.settings),...Object.fromEntries(dock.settings.flatMap(field=>Object.hasOwn(item.widget.settings,field.id)?[[field.id,item.widget.settings[field.id]]]:[]))}});
  let baseAuthorized=false;try{baseAuthorized=(saved?.permission??basePermissionFor({itemId,scope:entry.scope,widget,dock,prior,consent:false})).baseAccess==='approved';}catch{/* A changed range needs this instance's own confirmation. */}
  return widgetInstanceFormSchema.parse({previewId,itemId,name:item.label??entry.value.name,widget,dock,layoutRevision:entry.value.layoutRevision,mappingRevision:prior?.revision??null,baseAuthorized});
 });}
 stageUpdate(raw:StageWidgetUpdate):Promise<WidgetUpdateReview>{return this.enqueue(async()=>{
  const input=stageWidgetUpdateSchema.parse(raw),entry=this.reviewEntry(input.previewId),request=canonicalJson(input),replayed=entry.requests.get(input.operationId);
  if(Buffer.byteLength(request)>32*1024)throw new Error('DOCK_WIDGET_REVIEW_CAPACITY');
  if(replayed){if(replayed!==request)throw new Error('DOCK_OPERATION_CONFLICT');return this.reviewStatus(entry);}
  if(entry.requests.size>=128)throw new Error('DOCK_WIDGET_REVIEW_CAPACITY');
  const item=this.reviewItems(entry).find(item=>item.id===input.itemId),prior=item?this.accepted(item):null;
  if(!item||(prior?.revision??null)!==input.expectedMappingRevision)throw new Error('DOCK_PREVIEW_CONFLICT');
  const target:CustomWidgetItem={...item,widget:customDockWidgetSchema.parse({...item.widget,definition:this.definition(entry.value),size:input.size,settings:input.settings,bindings:input.bindings})};
  await this.validate(entry.value.dock,target.widget);this.reviewEntry(input.previewId);
  if((this.accepted(item)?.revision??null)!==(prior?.revision??null))throw new Error('DOCK_PREVIEW_CONFLICT');
  const permission=basePermissionFor({itemId:item.id,scope:entry.scope,widget:target.widget,dock:entry.value.dock,prior,consent:input.baseConsent}),drafts=new Map(entry.drafts),requests=new Map(entry.requests);
  drafts.set(item.id,{target,permission,apiConsent:input.apiConsent??[],expectedRevision:prior?.revision??null});requests.set(input.operationId,request);
  if(Buffer.byteLength(canonicalJson({drafts:[...drafts],requests:[...requests]}))>1024*1024)throw new Error('DOCK_WIDGET_REVIEW_CAPACITY');
  entry.drafts=drafts;entry.requests=requests;entry.reviewId=randomUUID().replaceAll('-','');return this.reviewStatus(entry);
 });}
 private reviewEntry(previewId:string){
  const entry=this.previews.get(previewId);if(!entry||entry.expiresAt<=Date.now())throw new Error('DOCK_PREVIEW_EXPIRED');this.assertScope(entry.scope);
  if(entry.value.mode!=='update'||this.ports.config.snapshot().localRevision!==entry.value.layoutRevision||this.ports.runtime.descriptor(entry.value.id)?.activeGenerationId!==entry.value.expectedActiveGenerationId)throw new Error('DOCK_PREVIEW_CONFLICT');
  return entry;
 }
 private reviewItems(entry:PreviewEntry){
  const items=this.instances(entry.value.id).map(item=>dockWidgetItemSchema.parse(item));
  if(canonicalJson(items.map(item=>item.id))!==canonicalJson(entry.value.instanceIds)||items.some(item=>{const prior=this.accepted(item);return item.widget.type!=='custom'||prior!==null&&canonicalJson(prior.widget)!==canonicalJson(item.widget);}))throw new Error('DOCK_PREVIEW_CONFLICT');
  return items as CustomWidgetItem[];
 }
 private async reviewStatus(entry:PreviewEntry):Promise<WidgetUpdateReview>{
  const items=[];for(const item of this.reviewItems(entry)){
   const prior=this.accepted(item),staged=entry.drafts.get(item.id);if(staged&&staged.expectedRevision!==(prior?.revision??null))throw new Error('DOCK_PREVIEW_CONFLICT');
   const widget=staged?.target.widget??{...item.widget,definition:this.definition(entry.value),bindings:candidateBindings(entry.value.dock,item.widget.bindings)};let configurationRequired=false,authorizationRequired=false;
   try{await this.validate(entry.value.dock,widget);}catch{configurationRequired=true;}
   try{authorizationRequired=entry.value.dock.data.some(source=>source.kind==='base')&&(staged?.permission??basePermissionFor({itemId:item.id,scope:entry.scope,widget,dock:entry.value.dock,prior,consent:false})).baseAccess!=='approved';}catch{authorizationRequired=true;}
   if(entry.value.dock.data.some(source=>source.kind==='api'))authorizationRequired=authorizationRequired||!(staged?.apiConsent.length||this.ports.api?.authorized(entry.scope,entry.value.dock,{...item,widget}));
   items.push({itemId:item.id,name:item.label??entry.value.name,configurationRequired,authorizationRequired,reviewed:Boolean(staged)});
  }
  this.reviewEntry(entry.value.previewId);return widgetUpdateReviewSchema.parse({previewId:entry.value.previewId,reviewId:entry.reviewId,complete:items.every(item=>!item.configurationRequired&&!item.authorizationRequired),items});
 }
 apply(raw:WidgetApplyInput){return this.enqueue(async()=>{
  const input=applyDockWidgetSchema.parse(raw),scope=this.liveScope(),request=canonicalJson(input),existing=this.file.snapshot().operations.find(value=>value.input.operationId===input.operationId);
  if(existing){if(canonicalJson(existing.scope)!==canonicalJson(scope)||existing.request!==request)throw new Error('DOCK_OPERATION_CONFLICT');if(existing.phase==='completed'||existing.phase==='conflict')return existing.receipt!;return this.finish(existing);}
  const entry=this.previews.get(input.previewId);if(!entry||entry.expiresAt<=Date.now()||canonicalJson(entry.scope)!==canonicalJson(scope))throw new Error('DOCK_PREVIEW_EXPIRED');
  const preview=entry.value;if(preview.mode==='applied')throw new Error('DOCK_WIDGET_ALREADY_APPLIED');
  if((input.reviewId!==undefined||entry.drafts.size>0)&&input.reviewId!==entry.reviewId)throw new Error('DOCK_PREVIEW_CONFLICT');
  if(this.pendingDefinition(preview.id))throw new Error('DOCK_WIDGET_APPLICATION_PENDING');
  if(!this.ports.authoring.definitions().some(definition=>definition.id===preview.id))throw new Error('DOCK_WIDGET_NOT_FOUND');
  const checked=preview.kind==='candidate'?await this.ports.authoring.preview(preview.id):await this.ports.runtime.dockVersion(preview.id,preview.generationId);this.assertScope(scope);
  if(checked.generationId!==preview.generationId||checked.sourceFingerprint!==preview.sourceFingerprint||this.ports.runtime.descriptor(preview.id)?.activeGenerationId!==preview.expectedActiveGenerationId||this.ports.config.snapshot().localRevision!==preview.layoutRevision)throw new Error('DOCK_PREVIEW_CONFLICT');
  const beforeItems=preview.replacement?[dockWidgetItemSchema.parse(this.ports.config.layout().items.find(item=>item.id===preview.replacement!.item.id))]:this.instances(preview.id).map(item=>dockWidgetItemSchema.parse(item));
  if(preview.replacement&&canonicalJson(beforeItems[0])!==canonicalJson(preview.replacement.item))throw new Error('DOCK_PREVIEW_CONFLICT');
  if(canonicalJson(beforeItems.map(item=>item.id))!==canonicalJson(preview.instanceIds))throw new Error('DOCK_PREVIEW_CONFLICT');
  const targets=this.targets(preview,input,beforeItems,entry.drafts);for(const target of targets)await this.validate(preview.dock,target.widget);this.assertScope(scope);
  const permissions=targets.map(target=>{
   const existing=this.mappings.find(value=>value.itemId===target.id&&canonicalJson(value.scope)===canonicalJson(scope)),before=beforeItems.find(value=>value.id===target.id),prior=before?this.accepted(before):null;
   const staged=entry.drafts.get(target.id);if(staged&&staged.expectedRevision!==(existing?.revision??null))throw new Error('DOCK_PREVIEW_CONFLICT');
   const permission=staged?.permission??basePermissionFor({itemId:target.id,scope,widget:target.widget,dock:preview.dock,prior,consent:(preview.mode==='add'||preview.mode==='replace')&&input.baseConsent});
   return{...permission,itemId:target.id,expectedRevision:existing?.revision??null};
  });
  const operation:WidgetApplication={scope,input,request,phase:'prepared',intent:{preview,beforeItems,targets,permissions,layoutRevisionAfter:null,api:targets.map(target=>({itemId:target.id,consent:[...(entry.drafts.get(target.id)?.apiConsent??((preview.mode==='add'||preview.mode==='replace')?input.apiConsent??[]:[]))],draftOwnerId:this.ports.api?.draftOwnerId(preview,preview.mode==='update'?target.id:undefined)??null}))},receipt:null,error:null};
  await this.file.mutate(state=>{if(state.operations.length>=256||state.operations.filter(value=>value.phase!=='completed'&&value.phase!=='conflict').length>=8)throw new Error('DOCK_WIDGET_OPERATION_CAPACITY');state.operations.push(operation);});
  return this.finish(operation);
 });}
 operation(operationId:string):WidgetApplyReceipt|null{
  const scope=this.liveScope(),entry=this.file.snapshot().operations.find(value=>value.input.operationId===operationId&&canonicalJson(value.scope)===canonicalJson(scope));return entry?.receipt??null;
 }
 accepted(item:Extract<DockItem,{kind:'widget'}>):AcceptedWidget|null{
  if(this.closed||item.widget.type!=='custom')return null;const scope=this.ports.scope(),widget=item.widget;
  const mapping=this.mappings.find(value=>value.itemId===item.id&&canonicalJson(value.scope)===canonicalJson(scope));
  return mapping&&mapping.widget.definition.definitionId===widget.definition.definitionId&&mapping.widget.definition.sourceInstallationId===widget.definition.sourceInstallationId?structuredClone(mapping):null;
 }
 recover(){return this.enqueue(async()=>{const scope=this.liveScope();for(const operation of this.file.snapshot().operations){if(canonicalJson(operation.scope)!==canonicalJson(scope))continue;if(operation.phase==='completed'){await this.ports.api?.ack(scope,operation.input.operationId,operation.receipt?.itemIds??[]);continue;}if(operation.phase==='conflict')continue;await this.finish(operation);}});}
 reconcileLayout():Promise<void>{
  this.liveScope();if(this.retirement)return this.retirement;
  const task=this.enqueue(async()=>{
   const scope=this.liveScope(),key=canonicalJson(scope),items=this.ports.config.layout().items;
   const retained=(mapping:AcceptedWidget)=>{
    if(canonicalJson(mapping.scope)!==key)return true;
    const item=items.find(item=>item.id===mapping.itemId);
    return item?.kind==='widget'&&item.widget.type==='custom'&&item.widget.definition.definitionId===mapping.widget.definition.definitionId&&item.widget.definition.sourceInstallationId===mapping.widget.definition.sourceInstallationId;
   };
   if(this.mappings.every(retained))return;
   for(const mapping of this.mappings.filter(mapping=>!retained(mapping)))await this.ports.api?.retire(mapping);
   await this.file.mutate(state=>{this.assertScope(scope);state.mappings=state.mappings.filter(retained);});this.publish();
  }).finally(()=>{if(this.retirement===task)this.retirement=null;});
  this.retirement=task;return task;
 }
 private async finish(original:WidgetApplication):Promise<WidgetApplyReceipt>{
  let operation=original;const scope=operation.scope,intent=operation.intent;if(!intent)throw new Error('DOCK_WIDGET_OPERATION_INVALID');const preview=intent.preview,id=operation.input.operationId;
  try{
   this.assertScope(scope);this.assertDefinition(preview.id);
   this.assertPermissions(operation);
   if(operation.phase==='prepared'){
    const frozen=await this.ports.packages.prepare(preview.id,preview.generationId);if(frozen.reference!==preview.packageRef)throw new Error('DOCK_PREVIEW_CONFLICT');
    await this.ports.packages.retain(frozen,id);operation=await this.change(id,value=>{value.phase='pinned';});
   }
   this.assertDefinition(preview.id);
   const current=this.ports.runtime.descriptor(preview.id),ownActivation=current?.activeGenerationId===preview.generationId&&current.lastActivation?.operationId===id;
   if(ownActivation&&operation.phase!=='activated')operation=await this.change(id,value=>{value.phase='activated';});
   if(ownActivation)await this.ports.packages.activateDelivery(preview.packageRef,id);
   if(!ownActivation&&current?.activeGenerationId!==preview.expectedActiveGenerationId)throw new Error('DOCK_PREVIEW_CONFLICT');
   if(operation.phase==='activated'&&!ownActivation)throw new Error('DOCK_PREVIEW_CONFLICT');
   for(const target of intent.targets)await this.validate(preview.dock,target.widget);this.assertScope(scope);
   this.assertPermissions(operation);
   for(const target of intent.targets){const grant=intent.api.find(value=>value.itemId===target.id);if(grant)await this.ports.api?.prepare({operationId:id,scope,target,consent:grant.consent,draftOwnerId:grant.draftOwnerId});}
   const layout=this.ports.config.layout(),alreadyWritten=intent.targets.length>0&&intent.targets.every(target=>canonicalJson(layout.items.find(item=>item.id===target.id)??null)===canonicalJson(target));
   if(!(operation.phase==='activated'&&alreadyWritten)){
    const committed=await this.ports.config.edit(current=>this.applyLayout(current,intent),preview.layoutRevision,async()=>{
     this.assertScope(scope);this.assertDefinition(preview.id);
     if(operation.phase!=='activated'){
      await this.ports.runtime.activate(preview.id,preview.generationId,{expectedActiveGenerationId:preview.expectedActiveGenerationId,...(preview.kind==='candidate'?{expectedSourceFingerprint:preview.sourceFingerprint}:{}),operationId:id});
      operation=await this.change(id,value=>{value.phase='activated';});
      await this.ports.packages.activateDelivery(preview.packageRef,id);this.assertDefinition(preview.id);
     }
    });
    operation=await this.change(id,value=>{value.intent!.layoutRevisionAfter=committed.localRevision;});
   }
   this.assertScope(scope);const latest=this.ports.config.layout();
   if(intent.targets.some(target=>canonicalJson(latest.items.find(item=>item.id===target.id)??null)!==canonicalJson(target)))throw new Error('DOCK_PREVIEW_CONFLICT');
   const selected=this.ports.runtime.descriptor(preview.id);if(selected?.activeGenerationId!==preview.generationId||selected.lastActivation?.operationId!==id)throw new Error('DOCK_PREVIEW_CONFLICT');
   for(const target of intent.targets){const grant=intent.api.find(value=>value.itemId===target.id);if(grant)await this.ports.api?.commit({operationId:id,scope,target,consent:grant.consent,draftOwnerId:grant.draftOwnerId});}this.assertPermissions(operation);
   const receipt:WidgetApplyReceipt={operationId:id,status:intent.targets.length?'applied':'saved',definitionId:preview.id,activeGenerationId:preview.generationId,packageRef:preview.packageRef,itemIds:intent.targets.map(item=>item.id)};
   for(const target of intent.targets){const prior=this.mappings.find(value=>value.itemId===target.id&&canonicalJson(value.scope)===canonicalJson(scope));if(prior&&(prior.widget.definition.definitionId!==target.widget.definition.definitionId||prior.widget.definition.sourceInstallationId!==target.widget.definition.sourceInstallationId))await this.ports.api?.retire(prior);}
   await this.file.mutate(state=>{
    this.assertScope(scope);this.assertDefinition(preview.id);
    for(const target of intent.targets){const prior=state.mappings.find(value=>value.itemId===target.id&&canonicalJson(value.scope)===canonicalJson(scope));
     const permission=intent.permissions.find(value=>value.itemId===target.id);if(!permission)throw new Error('DOCK_WIDGET_PERMISSION_MISSING');
     const mapping:AcceptedWidget={scope,itemId:target.id,widget:target.widget,paused:prior?.paused??false,revision:(prior?.revision??0)+1,lastOperationId:'source:'+id,baseAccess:permission.baseAccess,baseGrant:permission.baseGrant};
     if(prior)Object.assign(prior,mapping);else state.mappings.push(mapping);
    }
    const current=state.operations.find(value=>value.input.operationId===id)!;current.phase='completed';current.receipt=receipt;current.intent=null;current.error=null;
   });
   this.publish();await this.ports.api?.ack(scope,id,receipt.itemIds).catch(error=>console.warn('[system-dock] API receipt retention pending',error));return receipt;
  }catch(error){
   const active=this.ports.runtime.descriptor(preview.id)?.activeGenerationId??null,conflict=error instanceof Error&&/CONFLICT|REVISION_CHANGED|Active plugin generation changed/.test(error.message);
   const receipt:WidgetApplyReceipt={operationId:id,status:conflict?'conflict':'saved-not-added',definitionId:preview.id,activeGenerationId:active,packageRef:preview.packageRef,itemIds:[]};
   if(operation.phase==='activated'||conflict){await this.change(id,value=>{value.receipt=receipt;value.error=conflict?'DOCK_PREVIEW_CONFLICT':'DOCK_WIDGET_COMMIT_PENDING';if(conflict){value.phase='conflict';value.intent=null;}});this.publish();return receipt;}
   throw error;
  }
 }
 private definition(preview:WidgetPreview){return{sourceInstallationId:preview.executionInstallationId,definitionId:preview.id,generationId:preview.generationId,packageRef:preview.packageRef,contractDigest:preview.contractDigest};}
 private targets(preview:WidgetPreview,input:WidgetApplyInput,before:readonly Extract<DockItem,{kind:'widget'}>[],drafts:ReadonlyMap<string,ReviewDraft>):CustomWidgetItem[]{
  const definition=this.definition(preview);
  if(preview.mode==='save')return[];
  if(preview.mode==='replace'){
   const original=before[0];if(!original||!preview.replacement)throw new Error('DOCK_PREVIEW_CONFLICT');
   return[{id:original.id,kind:'widget',label:original.label??preview.replacement.name,widget:customDockWidgetSchema.parse({type:'custom',configVersion:1,definition,size:input.size,settings:input.settings,bindings:candidateBindings(preview.dock,input.bindings)})}];
  }
  if(preview.mode==='add'){
   const name=allocateWidgetName(input.name??preview.name,this.ports.config.layout().items.flatMap(item=>item.kind==='widget'?[item.label??'']:[]),this.ports.locale());
   return[{id:randomUUID().replaceAll('-',''),kind:'widget',label:name,widget:customDockWidgetSchema.parse({type:'custom',configVersion:1,definition,size:input.size,settings:input.settings,bindings:input.bindings})}];
  }
  return before.map(item=>{if(item.widget.type!=='custom')throw new Error('DOCK_PREVIEW_CONFLICT');return drafts.get(item.id)?.target??{...item,label:item.label??preview.name,widget:{...item.widget,definition,bindings:candidateBindings(preview.dock,item.widget.bindings)}};});
 }
 private applyLayout(layout:DockLayout,intent:NonNullable<WidgetApplication['intent']>):DockLayout{
  for(const item of intent.beforeItems)if(canonicalJson(layout.items.find(value=>value.id===item.id)??null)!==canonicalJson(item))throw new Error('DOCK_PREVIEW_CONFLICT');
  let next=layout;
  for(const target of intent.targets){
   if(intent.beforeItems.some(item=>item.id===target.id))next={...next,items:next.items.map(item=>item.id===target.id?target:item)};
   else{if(next.items.some(item=>item.id===target.id))throw new Error('DOCK_PREVIEW_CONFLICT');const {id,...draft}=target,result=addItem(next,draft,{mint:()=>id});if('failure' in result)throw new Error('DOCK_WIDGET_ADD_FAILED');next=result.layout;}
  }
  return next;
 }
 private async validate(dock:DockContribution,widget:CustomDockWidget){
  if(!dock.sizes.includes(widget.size)||validateDockSettings(dock.settings,widget.settings).length)throw new Error('DOCK_WIDGET_RECONFIGURE_REQUIRED');
  if(dock.data.some(source=>source.kind==='base')&&!this.ports.validateData)throw new Error('DOCK_BASE_CONFIGURATION_REQUIRED');
  await this.ports.validateData?.(dock,widget);
 }
 private assertPermissions(operation:WidgetApplication){
  for(const expected of operation.intent?.permissions??[]){const actual=this.mappings.find(value=>value.itemId===expected.itemId&&canonicalJson(value.scope)===canonicalJson(operation.scope));if((actual?.revision??null)!==expected.expectedRevision)throw new Error('DOCK_PREVIEW_CONFLICT');}
 }
 /** Main-only instance mutations share the version application queue and durable mapping owner. */
 localMutation<T>(run:(owner:WidgetMappingMutation)=>Promise<T>):Promise<T>{
  return this.enqueue(()=>run({put:async mapping=>{
   this.assertScope(mapping.scope);const prior=this.mappings.find(value=>value.itemId===mapping.itemId&&canonicalJson(value.scope)===canonicalJson(mapping.scope));if(prior&&(prior.widget.definition.definitionId!==mapping.widget.definition.definitionId||prior.widget.definition.sourceInstallationId!==mapping.widget.definition.sourceInstallationId))await this.ports.api?.retire(prior);this.assertScope(mapping.scope);await this.file.mutate(state=>{const index=state.mappings.findIndex(value=>value.itemId===mapping.itemId&&canonicalJson(value.scope)===canonicalJson(mapping.scope));if(index<0)state.mappings.push(mapping);else state.mappings[index]=mapping;});this.publish();
  },remove:async target=>{
   const scope=localWidgetScopeSchema.parse(target.scope),itemId=widgetInstanceIdSchema.parse(target.itemId),key=canonicalJson(scope);this.assertScope(scope);
   const mapping=this.mappings.find(value=>value.itemId===itemId&&canonicalJson(value.scope)===key);if(!mapping)return;
   await this.ports.api?.retire(mapping,target.keepApiCredentials);
   await this.file.mutate(state=>{this.assertScope(scope);state.mappings=state.mappings.filter(value=>value.itemId!==itemId||canonicalJson(value.scope)!==key);});this.publish();
  }}));
 }
 pendingDefinition(id:string){return this.file.snapshot().operations.some(value=>value.phase!=='completed'&&value.phase!=='conflict'&&value.intent?.preview.id===id);}
 private instances(id:string){const installation=this.ports.scope().installationId;return this.ports.config.layout().items.filter((item):item is Extract<DockItem,{kind:'widget'}>=>item.kind==='widget'&&item.widget.type==='custom'&&item.widget.definition.definitionId===id&&item.widget.definition.sourceInstallationId===installation);}
 private async change(id:string,change:(value:WidgetApplication)=>void){return this.file.mutate(state=>{const value=state.operations.find(item=>item.input.operationId===id);if(!value)throw new Error('DOCK_WIDGET_OPERATION_MISSING');change(value);return structuredClone(value);});}
 private publish(){this.mappings=this.file.snapshot().mappings;try{this.ports.changed();}catch(cause){console.warn('[system-dock] Widget observer failed',cause);}}
 private liveScope(){if(this.closed)throw new Error('DOCK_WIDGET_APPLICATIONS_CLOSED');return this.ports.scope();}
 private assertScope(scope:LocalWidgetScope){if(canonicalJson(this.liveScope())!==canonicalJson(scope))throw new Error('DOCK_WIDGET_SCOPE_CHANGED');}
 private enqueue<T>(run:()=>Promise<T>):Promise<T>{this.liveScope();const next=this.tail.then(run);this.tail=next.catch(()=>{});return next;}
 hasAcceptedPackage(reference:string){return this.ports.config.layout().items.some(item=>item.kind==='widget'&&item.widget.type==='custom'&&this.accepted(item)?.widget.definition.packageRef===reference);}
 retirePendingDefinition(definitionId:string){this.invalidateDefinitionPreviews(definitionId);return this.enqueue(async()=>{
  const scope=this.liveScope(),operations=this.file.read(state=>state.operations.filter(value=>canonicalJson(value.scope)===canonicalJson(scope)&&value.phase!=='completed'&&(value.intent?.preview.id??value.receipt?.definitionId)===definitionId));
  for(const operation of operations){const reference=operation.intent?.preview.packageRef??operation.receipt?.packageRef;if(!reference)continue;const receipt:WidgetApplyReceipt={operationId:operation.input.operationId,status:'conflict',definitionId,activeGenerationId:this.ports.runtime.descriptor(definitionId)?.activeGenerationId??null,packageRef:reference,itemIds:[]};
   await this.change(operation.input.operationId,value=>{value.phase='conflict';value.receipt=receipt;value.error='DOCK_WIDGET_UNINSTALL_PENDING';});
   await this.ports.packages.cancelPreparation(reference,operation.input.operationId,operation.intent?{definitionId,generationId:operation.intent.preview.generationId}:undefined);this.assertScope(scope);
   await this.change(operation.input.operationId,value=>{value.intent=null;});
  }this.publish();
 });}
 private assertDefinition(id:string){if(this.ports.canApply&&!this.ports.canApply(id))throw new Error('DOCK_WIDGET_AUTHORITY_CONFLICT');}
 invalidateDefinitionPreviews(definitionId:string){for(const [id,value]of this.previews)if(value.value.id===definitionId)this.previews.delete(id);this.ports.changed();}
 retainedReferences(){return [...new Set([...this.mappings.map(value=>value.widget.definition.packageRef),...this.file.read(state=>state.operations.flatMap(value=>value.intent?[value.intent.preview.packageRef]:[]))])];}
 clearAccount(accountId:string){
  this.mappings=this.mappings.filter(value=>value.scope.accountId!==accountId);
  for(const [id,value]of this.previews)if(value.scope.accountId===accountId)this.previews.delete(id);
  return this.enqueue(async()=>{await this.file.mutate(state=>{state.mappings=state.mappings.filter(value=>value.scope.accountId!==accountId);state.operations=state.operations.filter(value=>value.scope.accountId!==accountId);});this.publish();});
 }
 async close(){this.closed=true;this.previews.clear();await this.tail;await this.file.closeAndFlush();}
}
