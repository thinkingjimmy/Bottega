/**
 * [INPUT]: Depends on verified package custody, the shared accepted-runtime mutation queue, serialized layout edits and strict host forms.
 * [OUTPUT]: Provides receipt-backed official/personal configuration, independent Base consent/revocation, local pause/removal/account cleanup, exact accepted mappings and the strict instance ledger schema and original-operation API credential/grant hooks.
 * [POS]: Instance management coordinator; it never builds source, selects a source generation or copies credentials/grants.
 */
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {z} from 'zod';
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import {allocateWidgetName,validateDockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import {applyDockWidgetSchema,type WidgetApplyInput} from '../../../../../shared/system-dock/widgets/authoring';
import {widgetInstanceFormSchema,widgetInstancePauseSchema,widgetInstanceRemoveSchema,widgetInstanceReceiptSchema,widgetBaseRevokeSchema,type WidgetInstanceForm,type WidgetInstanceReceipt} from '../../../../../shared/system-dock/widgets/management';
import {customDockWidgetSchema,type CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import {addItem,removeItem} from '../../../../../shared/system-dock/placement';
import {dockWidgetItemSchema} from '../../../../../shared/system-dock/layout';
import {dockPluginManifestSchema} from '../../../apps/gui-build/source/manifest';
import type {WidgetPackageStore} from '../../../plugins/surface-runtime/packages/store';
import {DurableJson} from '../../../persistence/durable-json';
import type {DockConfigStore} from '../config-store';
import type {DockWidgetApplications,WidgetMappingMutation} from './applications';
import {officialWidgetFormSchema,officialWidgetQuerySchema,submitOfficialWidgetSchema,type OfficialWidgetForm,type OfficialWidget,type SubmitOfficialWidget} from '../../../../../shared/system-dock/widgets/official';
import {officialChoices,officialDefault,validateOfficial,type OfficialWidgetDirectory} from './official';
import {customWidgetItemSchema,localWidgetScopeSchema,type LocalWidgetScope,type WidgetApiHooks} from './model';
import {basePermissionFor,basePermissionSchema} from './base-access';
const intentSchema=z.object({kind:z.enum(['add','configure','pause','remove','revoke-base']),before:dockWidgetItemSchema.nullable(),target:dockWidgetItemSchema.nullable(),
 mappingRevision:z.number().int().nonnegative().nullable(),layoutRevision:z.number().int().nonnegative(),paused:z.boolean().nullable(),permission:basePermissionSchema.nullable().default(null),api:z.object({consent:z.array(z.string().max(64)).max(8),draftOwnerId:z.string().max(160).nullable()}).strict().nullable().default(null)}).strict();
const operationSchema=z.object({operationId:z.string().max(128),scope:localWidgetScopeSchema,request:z.string().max(32*1024),intent:intentSchema.nullable(),
 phase:z.enum(['prepared','completed','conflict']),receipt:widgetInstanceReceiptSchema.nullable()}).strict();
const ledger=z.object({version:z.literal(1),operations:z.array(operationSchema).max(256)}).strict().superRefine((value,context)=>{
 if(new Set(value.operations.map(entry=>entry.operationId)).size!==value.operations.length)context.addIssue({code:'custom',message:'Duplicate instance operation identity'});
 if(value.operations.filter(entry=>entry.phase==='prepared').length>8)context.addIssue({code:'custom',message:'Pending instance operation capacity exceeded'});
});
export const widgetInstanceLedgerSchema=ledger;
type Operation=z.infer<typeof operationSchema>;
type Ports={userData:string;config:DockConfigStore;applications:DockWidgetApplications;packages:WidgetPackageStore;scope():LocalWidgetScope;locale():string;changed():void;
 api?:WidgetApiHooks;configurable?(widget:CustomDockWidget):boolean;saved(id:string,sourceInstallationId?:string):Promise<{widget:CustomDockWidget;dock:DockContribution;name:string}>;stillSaved(widget:CustomDockWidget):boolean;validate(dock:DockContribution,widget:CustomDockWidget):Promise<void>;
 officialDirectory():OfficialWidgetDirectory;officialName(type:OfficialWidget['type']):string};
export class DockWidgetInstances{
 private readonly file:DurableJson<z.infer<typeof ledger>>;
 private readonly forms=new Map<string,{scope:LocalWidgetScope;value:WidgetInstanceForm;expiresAt:number}>();
 private readonly officialForms=new Map<string,{scope:LocalWidgetScope;value:OfficialWidgetForm;before:ReturnType<typeof dockWidgetItemSchema.parse>|null;expiresAt:number}>();
 private closed=true;
 constructor(private readonly ports:Ports){this.file=new DurableJson(join(ports.userData,'dock-widget-instances.json'),ledger,()=>({version:1,operations:[]}));}
 async initialize(){await this.file.initialize();this.closed=false;}
 async preview(itemId:string):Promise<WidgetInstanceForm>{
  const scope=this.liveScope(),item=this.item(itemId),mapping=this.ports.applications.accepted(item);if(!mapping&&!this.ports.configurable?.(item.widget))throw new Error('DOCK_WIDGET_NOT_ACCEPTED');
  if(mapping&&canonicalJson(item.widget.definition)!==canonicalJson(mapping.widget.definition)&&!this.ports.configurable?.(item.widget))throw new Error('DOCK_INSTANCE_CONFLICT');
  const selected=customDockWidgetSchema.parse(item.widget),packet=await this.ports.packages.read(selected.definition.packageRef);this.assertScope(scope);
  const entry=packet.files.find(file=>file.path==='runtime/plugin.json');if(!entry)throw new Error('WIDGET_PACKAGE_MANIFEST_MISSING');
  const manifest=dockPluginManifestSchema.parse(JSON.parse(Buffer.from(entry.content,'base64').toString('utf8')));
  if(packet.descriptor.source.accountId!==scope.accountId||packet.descriptor.source.installationId!==selected.definition.sourceInstallationId||packet.descriptor.source.definitionId!==selected.definition.definitionId||packet.descriptor.source.generationId!==selected.definition.generationId||packet.descriptor.contractDigest!==selected.definition.contractDigest)throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
  if(canonicalJson(this.item(itemId))!==canonicalJson(item)||(this.ports.applications.accepted(item)?.revision??null)!==(mapping?.revision??null))throw new Error('DOCK_INSTANCE_CONFLICT');
  let baseAuthorized=false;try{baseAuthorized=basePermissionFor({itemId,scope,widget:selected,dock:manifest.dock,prior:mapping,consent:false}).baseAccess==='approved';}catch{/* The host must confirm a missing or changed Base range. */}
  return this.remember(scope,{previewId:this.id(),itemId,name:item.label??manifest.name,widget:selected,dock:manifest.dock,layoutRevision:this.ports.config.snapshot().localRevision,mappingRevision:mapping?.revision??null,baseAuthorized});
 }
 async previewSaved(id:string,sourceInstallationId?:string):Promise<WidgetInstanceForm>{
  const scope=this.liveScope(),saved=await this.ports.saved(id,sourceInstallationId);this.assertScope(scope);if(!this.ports.stillSaved(saved.widget))throw new Error('DOCK_INSTANCE_CONFLICT');
  return this.remember(scope,{previewId:this.id(),itemId:null,name:saved.name,widget:saved.widget,dock:saved.dock,layoutRevision:this.ports.config.snapshot().localRevision,mappingRevision:null,baseAuthorized:false});
 }
 previewOfficial(raw:ReturnType<typeof officialWidgetQuerySchema.parse>):OfficialWidgetForm{
  const input=officialWidgetQuerySchema.parse(raw),scope=this.liveScope(),before='itemId'in input?dockWidgetItemSchema.parse(this.ports.config.layout().items.find(item=>item.id===input.itemId)):null;
  if(before?.widget.type==='custom')throw new Error('DOCK_OFFICIAL_WIDGET_REQUIRED');const directory=this.ports.officialDirectory();
  const widget=before?before.widget:officialDefault('definitionId'in input?input.definitionId:'builtin.tasks',directory);
  const value=officialWidgetFormSchema.parse({previewId:this.id(),itemId:before?.id??null,name:before?.label??this.ports.officialName(widget.type),widget,layoutRevision:this.ports.config.snapshot().localRevision,...officialChoices(directory)});
  for(const [id,entry]of this.officialForms)if(entry.expiresAt<=Date.now())this.officialForms.delete(id);while(this.officialForms.size>=16)this.officialForms.delete(this.officialForms.keys().next().value!);
  this.officialForms.set(value.previewId,{scope,value,before,expiresAt:Date.now()+600_000});return value;
 }
 submitOfficial(raw:SubmitOfficialWidget){const input=submitOfficialWidgetSchema.parse(raw);return this.mutate(input.operationId,input,async scope=>{
  const entry=this.officialForms.get(input.previewId);if(!entry||entry.expiresAt<=Date.now()||canonicalJson(entry.scope)!==canonicalJson(scope))throw new Error('DOCK_PREVIEW_EXPIRED');
  if(input.widget.type!==entry.value.widget.type||this.ports.config.snapshot().localRevision!==entry.value.layoutRevision||entry.before&&canonicalJson(this.ports.config.layout().items.find(item=>item.id===entry.before!.id)??null)!==canonicalJson(entry.before))throw new Error('DOCK_INSTANCE_CONFLICT');
  validateOfficial(input.widget,this.ports.officialDirectory());
  const name=entry.before?input.name:allocateWidgetName(input.name,this.ports.config.layout().items.flatMap(item=>item.kind==='widget'?[item.label??'']:[]),this.ports.locale());
  return{kind:entry.before?'configure':'add',before:entry.before,target:{id:entry.before?.id??this.id(),kind:'widget',label:name,widget:input.widget},mappingRevision:null,layoutRevision:entry.value.layoutRevision,paused:null,permission:null,api:null};
 });}
 submit(raw:WidgetApplyInput){const input=applyDockWidgetSchema.parse(raw);return this.mutate(input.operationId,input,async scope=>{
  const entry=this.forms.get(input.previewId);if(!entry||entry.expiresAt<=Date.now()||canonicalJson(entry.scope)!==canonicalJson(scope))throw new Error('DOCK_PREVIEW_EXPIRED');
  const form=entry.value,before=form.itemId?this.item(form.itemId):null,mapping=before?this.ports.applications.accepted(before):null;
  if(this.ports.config.snapshot().localRevision!==form.layoutRevision||before&&(mapping?.revision??null)!==form.mappingRevision)throw new Error('DOCK_INSTANCE_CONFLICT');
  if(!before&&!this.ports.stillSaved(form.widget))throw new Error('DOCK_INSTANCE_CONFLICT');
  const widget=customDockWidgetSchema.parse({...form.widget,size:input.size,settings:input.settings,bindings:input.bindings});
  if(this.ports.configurable&&!this.ports.configurable(widget))throw new Error('DOCK_WIDGET_NOT_ACCEPTED');
  if(!form.dock.sizes.includes(widget.size)||validateDockSettings(form.dock.settings,widget.settings).length)throw new Error('DOCK_WIDGET_RECONFIGURE_REQUIRED');
  await this.ports.validate(form.dock,widget);this.assertScope(scope);
  const name=before?(input.name??before.label):allocateWidgetName(input.name??form.name,this.ports.config.layout().items.flatMap(item=>item.kind==='widget'?[item.label??'']:[]),this.ports.locale());
  const itemId=before?.id??this.id(),permission=basePermissionFor({itemId,scope,widget,dock:form.dock,prior:mapping,consent:input.baseConsent});
  return{kind:before?'configure':'add',before,target:{id:itemId,kind:'widget',label:name,widget},mappingRevision:form.mappingRevision,layoutRevision:form.layoutRevision,paused:null,permission,api:{consent:input.apiConsent??[],draftOwnerId:'configuration-'+input.previewId}};
 });}
 pause(raw:z.infer<typeof widgetInstancePauseSchema>){const input=widgetInstancePauseSchema.parse(raw);return this.mutate(input.operationId,input,async()=>{
  const before=this.item(input.itemId),mapping=this.ports.applications.accepted(before);if(!mapping||mapping.revision!==input.expectedRevision)throw new Error('DOCK_INSTANCE_CONFLICT');
  return{kind:'pause',before,target:before,mappingRevision:mapping.revision,layoutRevision:this.ports.config.snapshot().localRevision,paused:input.paused,permission:null,api:null};
 });}
 revokeBase(raw:z.infer<typeof widgetBaseRevokeSchema>){const input=widgetBaseRevokeSchema.parse(raw);return this.mutate(input.operationId,input,async()=>{
  const before=this.item(input.itemId),mapping=this.ports.applications.accepted(before);if(!mapping||mapping.revision!==input.expectedRevision||!mapping.baseGrant)throw new Error('DOCK_INSTANCE_CONFLICT');
  return{kind:'revoke-base',before,target:before,mappingRevision:mapping.revision,layoutRevision:this.ports.config.snapshot().localRevision,paused:null,permission:{baseAccess:'revoked',baseGrant:mapping.baseGrant},api:null};
 });}
 remove(raw:z.infer<typeof widgetInstanceRemoveSchema>){const input=widgetInstanceRemoveSchema.parse(raw);return this.mutate(input.operationId,input,async()=>{
  const before=dockWidgetItemSchema.parse(this.ports.config.layout().items.find(value=>value.id===input.itemId));if(this.ports.config.snapshot().localRevision!==input.expectedLayoutRevision)throw new Error('DOCK_INSTANCE_CONFLICT');
  return{kind:'remove',before,target:null,mappingRevision:null,layoutRevision:input.expectedLayoutRevision,paused:null,permission:null,api:null};
 });}
 recover(){return this.ports.applications.localMutation(async owner=>{for(const entry of this.file.snapshot().operations)if(canonicalJson(entry.scope)===canonicalJson(this.liveScope())){if(entry.phase==='prepared')await this.finish(entry,owner);else if(entry.phase==='completed'&&entry.receipt)await this.ports.api?.ack(entry.scope,entry.operationId,[entry.receipt.itemId]);}});}
 private mutate(id:string,input:unknown,prepare:(scope:LocalWidgetScope)=>Promise<z.infer<typeof intentSchema>>):Promise<WidgetInstanceReceipt>{
  this.liveScope();return this.ports.applications.localMutation(async owner=>{
   const scope=this.liveScope(),request=canonicalJson(input),prior=this.file.snapshot().operations.find(value=>value.operationId===id);
   if(prior){if(prior.request!==request||canonicalJson(prior.scope)!==canonicalJson(scope))throw new Error('DOCK_OPERATION_CONFLICT');return prior.phase==='prepared'?this.finish(prior,owner):prior.receipt!;}
   const intent=await prepare(scope);this.assertScope(scope);const itemId=intent.before?.id??intent.target!.id;
   if(this.file.snapshot().operations.some(value=>value.phase==='prepared'&&(value.intent?.before?.id??value.intent?.target?.id)===itemId))throw new Error('DOCK_INSTANCE_PENDING');
   const entry:Operation={operationId:id,scope,request,intent,phase:'prepared',receipt:null};
   await this.file.mutate(state=>{if(state.operations.length>=256||state.operations.filter(value=>value.phase==='prepared').length>=8)throw new Error('DOCK_WIDGET_OPERATION_CAPACITY');state.operations.push(entry);});return this.finish(entry,owner);
  });
 }
 private async finish(entry:Operation,owner:WidgetMappingMutation):Promise<WidgetInstanceReceipt>{
  const intent=entry.intent;if(!intent)throw new Error('DOCK_INSTANCE_OPERATION_INVALID');const itemId=intent.before?.id??intent.target!.id,receipt=(status:WidgetInstanceReceipt['status'])=>({operationId:entry.operationId,itemId,status});
  try{
   this.assertScope(entry.scope);const mapping=intent.before?this.ports.applications.accepted(intent.before):null;
   if(mapping?.lastOperationId==='instance:'+entry.operationId)return this.complete(entry,receipt('applied'));
   if(intent.kind==='configure'&&intent.before?.widget.type==='custom'&&(mapping?.revision??null)!==intent.mappingRevision)throw new Error('DOCK_INSTANCE_CONFLICT');
   if(intent.kind==='pause'){
    if(!mapping||mapping.revision!==intent.mappingRevision||canonicalJson(this.item(itemId))!==canonicalJson(intent.before))throw new Error('DOCK_INSTANCE_CONFLICT');
    await owner.put({...mapping,paused:intent.paused!,revision:mapping.revision+1,lastOperationId:'instance:'+entry.operationId});return this.complete(entry,receipt('applied'));
   }
   if(intent.kind==='revoke-base'){
    if(!mapping||mapping.revision!==intent.mappingRevision||!intent.permission||canonicalJson(this.item(itemId))!==canonicalJson(intent.before))throw new Error('DOCK_INSTANCE_CONFLICT');
    await owner.put({...mapping,...intent.permission,revision:mapping.revision+1,lastOperationId:'instance:'+entry.operationId});return this.complete(entry,receipt('applied'));
   }
   if(intent.kind==='add'&&intent.target?.widget.type==='custom'&&!this.ports.stillSaved(intent.target.widget))throw new Error('DOCK_INSTANCE_CONFLICT');
   if(intent.target&&intent.target.widget.type!=='custom')validateOfficial(intent.target.widget,this.ports.officialDirectory());
   if(intent.target?.widget.type==='custom'&&intent.api)await this.ports.api?.prepare({operationId:entry.operationId,scope:entry.scope,target:customWidgetItemSchema.parse(intent.target),consent:intent.api.consent,draftOwnerId:intent.api.draftOwnerId});
   const config=this.ports.config.snapshot(),actual=config.layout.items.find(item=>item.id===itemId)??null,alreadyWritten=canonicalJson(actual)===canonicalJson(intent.target)&&(intent.kind==='remove'||config.localRevision===intent.layoutRevision+1);
   if(!alreadyWritten){
    await this.ports.config.edit(layout=>{
     this.assertScope(entry.scope);if(intent.target&&intent.target.widget.type!=='custom')validateOfficial(intent.target.widget,this.ports.officialDirectory());
     const current=layout.items.find(item=>item.id===itemId)??null;if(canonicalJson(current)!==canonicalJson(intent.before))throw new Error('DOCK_INSTANCE_CONFLICT');
     if(intent.kind==='add'){const {id,...draft}=intent.target!,added=addItem(layout,draft,{mint:()=>id});if('failure'in added)throw new Error('DOCK_WIDGET_ADD_FAILED');return added.layout;}
     if(intent.kind==='remove'){const removed=removeItem(layout,itemId);if('failure'in removed)throw new Error('DOCK_INSTANCE_CONFLICT');return removed.layout;}
     return{...layout,items:layout.items.map(item=>item.id===itemId?intent.target!:item)};
    },intent.layoutRevision);
   }
   this.assertScope(entry.scope);
   if(intent.kind==='remove')await owner.remove({scope:entry.scope,itemId});
   if(intent.target?.widget.type==='custom'){
    if(intent.api)await this.ports.api?.commit({operationId:entry.operationId,scope:entry.scope,target:customWidgetItemSchema.parse(intent.target),consent:intent.api.consent,draftOwnerId:intent.api.draftOwnerId});this.assertScope(entry.scope);
    const current=intent.before?this.ports.applications.accepted(intent.before):null;
    if(intent.before&&(current?.revision??null)!==intent.mappingRevision)throw new Error('DOCK_INSTANCE_CONFLICT');
    await owner.put({scope:entry.scope,itemId,widget:intent.target.widget,paused:current?.paused??false,revision:(current?.revision??0)+1,lastOperationId:'instance:'+entry.operationId,...(intent.permission??{baseAccess:'unconfirmed' as const,baseGrant:null})});
   }
   return this.complete(entry,receipt('applied'));
  }catch(error){
   const status=error instanceof Error&&/CONFLICT|REVISION_CHANGED/.test(error.message)?'conflict':'pending',result=receipt(status);
   await this.file.mutate(state=>{const value=state.operations.find(value=>value.operationId===entry.operationId)!;value.receipt=result;if(status==='conflict'){value.phase='conflict';value.intent=null;}});this.changed();return result;
  }
 }
 private async complete(entry:Operation,receipt:WidgetInstanceReceipt){await this.file.mutate(state=>{const current=state.operations.find(value=>value.operationId===entry.operationId)!;current.phase='completed';current.receipt=receipt;current.intent=null;});this.changed();await this.ports.api?.ack(entry.scope,entry.operationId,[receipt.itemId]).catch(error=>console.warn('[system-dock] API receipt retention pending',error));return receipt;}
 formContext(previewId:string){const entry=this.forms.get(previewId);if(!entry)return null;if(entry.expiresAt<=Date.now())throw new Error('DOCK_PREVIEW_EXPIRED');this.assertScope(entry.scope);const form=entry.value;if(this.ports.config.snapshot().localRevision!==form.layoutRevision)throw new Error('DOCK_INSTANCE_CONFLICT');if(form.itemId){const item=this.item(form.itemId);if(canonicalJson(item.widget)!==canonicalJson(form.widget)||(this.ports.applications.accepted(item)?.revision??null)!==form.mappingRevision)throw new Error('DOCK_INSTANCE_CONFLICT');}else if(!this.ports.stillSaved(form.widget))throw new Error('DOCK_INSTANCE_CONFLICT');return{scope:structuredClone(entry.scope),form:structuredClone(form)};}
 private remember(scope:LocalWidgetScope,value:WidgetInstanceForm){for(const [id,form]of this.forms)if(form.expiresAt<=Date.now())this.forms.delete(id);while(this.forms.size>=16)this.forms.delete(this.forms.keys().next().value!);const parsed=widgetInstanceFormSchema.parse(value);this.forms.set(parsed.previewId,{scope,value:parsed,expiresAt:Date.now()+600_000});return parsed;}
 private item(id:string){const item=this.ports.config.layout().items.find(value=>value.id===id);if(item?.kind!=='widget'||item.widget.type!=='custom')throw new Error('DOCK_WIDGET_NOT_FOUND');return customWidgetItemSchema.parse(item);}
 private liveScope(){if(this.closed)throw new Error('DOCK_WIDGET_INSTANCES_CLOSED');return this.ports.scope();}
 private assertScope(scope:LocalWidgetScope){if(canonicalJson(this.liveScope())!==canonicalJson(scope))throw new Error('DOCK_WIDGET_SCOPE_CHANGED');}
 private id(){return randomUUID().replaceAll('-','');}
 private changed(){try{this.ports.changed();}catch(cause){console.warn('[system-dock] Widget instance observer failed',cause);}}
 retainedReferences(){return this.file.read(state=>state.operations.flatMap(value=>value.phase==='prepared'?[value.intent?.before,value.intent?.target].flatMap(item=>item?.widget.type==='custom'?[item.widget.definition.packageRef]:[]):[]));}
 async clearAccount(accountId:string){
  for(const [id,value]of this.forms)if(value.scope.accountId===accountId)this.forms.delete(id);
  for(const [id,value]of this.officialForms)if(value.scope.accountId===accountId)this.officialForms.delete(id);
  await this.ports.applications.localMutation(async()=>{await this.file.mutate(state=>{state.operations=state.operations.filter(value=>value.scope.accountId!==accountId);});});this.changed();
 }
 async close(){this.closed=true;this.forms.clear();this.officialForms.clear();await this.ports.applications.localMutation(async()=>{});await this.file.closeAndFlush();}
}
