/**
 * [INPUT]: Depends on verified packages, Main-held Widget forms, accepted mappings and the shared API broker.
 * [OUTPUT]: Provides host connection resolution and original-journal API association hooks without exposing owner selectors.
 * [POS]: Custom Widget API composition; source drafts, instance settings and authoring sessions keep separate owners.
 */
import {createHash} from 'node:crypto';
import {canonicalJson} from '@bottega/contracts/core/canonical-json';
import {validateDockSettings,type DockSettings} from '@bottega/contracts/plugins/dock/settings';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import {widgetApiControlSchema,type WidgetApiReview} from '../../../../../shared/system-dock/widgets/api/control';
import {customDockWidgetSchema,type CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import type {WidgetPreview} from '../../../../../shared/system-dock/widgets/authoring';
import type {DockWidgetApplications} from '../../store/custom/applications';
import type {DockWidgetInstances} from '../../store/custom/instances';
import type {AcceptedWidget,CustomWidgetItem,LocalWidgetScope,WidgetApiHooks,WidgetApiPlan} from '../../store/custom/model';
import {dockPluginManifestSchema} from '../../../apps/gui-build/source/manifest';
import {verifyPackage} from '../../../plugins/surface-runtime/packages/codec';
import type {WidgetPackageStore} from '../../../plugins/surface-runtime/packages/store';
import type {DockApiData} from '../api/owner';
import {instanceApiOwner,type ApiOwner} from '../api/model';
import type {WidgetDetailSource} from '../detail/ports';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0,32);
export const widgetApiDraftId=(scope:LocalWidgetScope,definitionId:string,chatId:string,targetId?:string)=>'source-'+hash([scope,definitionId,chatId,targetId??null]);
export function widgetApiDraftOwner(scope:LocalWidgetScope,definitionId:string,ownerId:string):ApiOwner{return{accountId:scope.accountId,executionInstallationId:scope.installationId,definitionId,ownerKind:'authoring-draft',ownerId};}
type Ports={broker:DockApiData;packages:WidgetPackageStore;applications:DockWidgetApplications;instances:DockWidgetInstances;scope():LocalWidgetScope;source(itemId:string):WidgetDetailSource|null;changed():void};
export class WidgetApiConnections implements WidgetApiHooks{
 constructor(private readonly ports:Ports){}
 draftOwnerId(preview:WidgetPreview,targetId?:string){const context=this.ports.applications.previewContext(preview.previewId);return widgetApiDraftId(context.scope,preview.id,context.chatId,targetId);}
 private operationId(plan:WidgetApiPlan){return hash([plan.scope,plan.operationId,plan.target.id]);}
 private assertScope(scope:LocalWidgetScope){if(canonicalJson(scope)!==canonicalJson(this.ports.scope()))throw new Error('DOCK_WIDGET_SCOPE_CHANGED');}
 async source(scope:LocalWidgetScope,item:CustomWidgetItem,accepted?:AcceptedWidget,prepared?:Awaited<ReturnType<WidgetPackageStore['read']>>):Promise<WidgetDetailSource>{
  this.assertScope(scope);const packet=prepared??await this.ports.packages.read(item.widget.definition.packageRef);this.assertScope(scope);const file=packet.files.find(value=>value.path==='runtime/plugin.json');if(!file)throw new Error('WIDGET_PACKAGE_MANIFEST_MISSING');
  const manifest=dockPluginManifestSchema.parse(JSON.parse(Buffer.from(file.content,'base64').toString('utf8'))),definition=item.widget.definition;
  if(packet.descriptor.source.accountId!==scope.accountId||packet.descriptor.source.installationId!==definition.sourceInstallationId||packet.descriptor.source.definitionId!==definition.definitionId||packet.descriptor.source.generationId!==definition.generationId||packet.descriptor.contractDigest!==definition.contractDigest)throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
  return{item,manifest,accepted:accepted??{scope,itemId:item.id,widget:item.widget,paused:false,revision:1,lastOperationId:null,baseAccess:'unconfirmed',baseGrant:null},dataIdentity:''};
 }
 async prepare(plan:WidgetApiPlan){
  const source=await this.source(plan.scope,plan.target);if(!source.manifest.dock.data.some(query=>query.kind==='api'))return;
  const owner=instanceApiOwner(source),prior=this.ports.applications.accepted(plan.target),draft=plan.draftOwnerId?widgetApiDraftOwner(plan.scope,plan.target.widget.definition.definitionId,plan.draftOwnerId):owner;
  await this.ports.broker.prepareAssociation({operationId:this.operationId(plan),draftOwner:draft,targetOwner:owner,source,requestIds:[...new Set([...plan.consent,...(prior?this.ports.broker.rebindable(source,owner):[])])]});
 }
 async commit(plan:WidgetApiPlan){const source=await this.source(plan.scope,plan.target);if(source.manifest.dock.data.some(query=>query.kind==='api'))await this.ports.broker.commitAssociation(this.operationId(plan));}
 ack(scope:LocalWidgetScope,operationId:string,itemIds:readonly string[]){return Promise.all(itemIds.map(itemId=>this.ports.broker.acknowledgeAssociation(hash([scope,operationId,itemId])))).then(()=>{});}
 retire(mapping:AcceptedWidget,keepCredentials=false){return this.ports.broker.removeOwner({accountId:mapping.scope.accountId,executionInstallationId:mapping.scope.installationId,definitionId:mapping.widget.definition.definitionId,ownerKind:'instance',ownerId:mapping.itemId},keepCredentials);}
 authorized(scope:LocalWidgetScope,dock:DockContribution,target:CustomWidgetItem){
  const prior=this.ports.applications.accepted(target),current=this.ports.source(target.id);if(!prior||!current)return false;
  const candidate={...current,item:target,accepted:{...prior,scope,widget:target.widget},manifest:{...current.manifest,dock}};
  return this.ports.broker.rebindable(candidate).length===dock.data.filter(query=>query.kind==='api').length;
 }
 private async resolve(previewId:string,settings:DockSettings,targetId?:string){
  const form=this.ports.instances.formContext(previewId);
  let scope:LocalWidgetScope,widget:CustomDockWidget,itemId:string,ownerId:string,instance=false,name='Widget',packet:Awaited<ReturnType<WidgetPackageStore['read']>>|undefined;
  if(form){name=form.form.name;scope=form.scope;widget=customDockWidgetSchema.parse({...form.form.widget,settings});itemId=form.form.itemId??'configuration-'+previewId;ownerId='configuration-'+previewId;instance=Boolean(form.form.itemId);}
  else{
   const context=this.ports.applications.previewContext(previewId),preview=context.preview;name=(targetId?this.ports.source(targetId)?.item.label:undefined)??preview.name;
   if(targetId&&!preview.instanceIds.includes(targetId))throw new Error('DOCK_API_OWNER_SCOPE');
   const frozen=await this.ports.packages.prepare(preview.id,preview.generationId);this.assertScope(context.scope);this.ports.applications.previewContext(previewId);
   if(frozen.reference!==preview.packageRef||frozen.descriptor.contractDigest!==preview.contractDigest)throw new Error('DOCK_PREVIEW_CONFLICT');
   packet=verifyPackage(frozen.bytes,frozen.reference,{accountId:context.scope.accountId,installationId:preview.executionInstallationId,definitionId:preview.id,generationId:preview.generationId});
   scope=context.scope;itemId=targetId??'draft-'+hash([scope,preview.id,context.chatId]);ownerId=widgetApiDraftId(scope,preview.id,context.chatId,targetId);
   widget=customDockWidgetSchema.parse({type:'custom',configVersion:1,size:preview.dock.sizes[0],settings,bindings:[],definition:{sourceInstallationId:preview.executionInstallationId,definitionId:preview.id,generationId:preview.generationId,packageRef:preview.packageRef,contractDigest:preview.contractDigest}});
  }
  const source=await this.source(scope,{id:itemId,kind:'widget',label:name,widget},undefined,packet);this.assertScope(scope);
  if(validateDockSettings(source.manifest.dock.settings,settings).length)throw new Error('DOCK_WIDGET_RECONFIGURE_REQUIRED');
  if(form)this.ports.instances.formContext(previewId);else this.ports.applications.previewContext(previewId);
  const owner=widgetApiDraftOwner(scope,widget.definition.definitionId,ownerId),credentialOwner=form?.form.itemId?instanceApiOwner(source):targetId?{...owner,ownerKind:'instance' as const,ownerId:targetId}:owner;
  return{source,owner,credentialOwner,liveOwner:instance?credentialOwner:null};
 }
 async control(raw:unknown):Promise<WidgetApiReview>{
  const input=widgetApiControlSchema.parse(raw),{source,owner,credentialOwner,liveOwner}=await this.resolve(input.previewId,input.settings,input.targetId);await this.ports.broker.initialize();
  this.assertScope(source.accepted.scope);
  const review=()=>{const value=this.ports.broker.review(source,owner,credentialOwner),rebindable=this.ports.broker.rebindable(source,credentialOwner);return{...value,requests:value.requests.map(request=>({...request,authorized:request.authorized||rebindable.includes(request.id)}))};};
  let result:WidgetApiReview;
  switch(input.kind){
   case'review':return review();
   case'configure':result=await this.ports.broker.configure(source,{operationId:input.operationId,consent:[...new Set([...input.consent,...this.ports.broker.rebindable(source,credentialOwner)])],credentials:input.credentials},owner,credentialOwner);break;
   case'revoke':await this.ports.broker.revoke(owner,input.requestId);if(liveOwner)await this.ports.broker.revoke(liveOwner,input.requestId);result=review();break;
   case'clear':if(liveOwner)await this.ports.broker.configure(source,{operationId:hash([Date.now(),Math.random()]),consent:[],clearSlots:[input.slotId]},liveOwner);result=await this.ports.broker.configure(source,{operationId:hash([Date.now(),Math.random()]),consent:[],clearSlots:[input.slotId]},owner,credentialOwner);break;
   case'copy':result=await this.ports.broker.copySavedCredential(source,input.selectionId,input.slotId,input.operationId,owner);break;
   case'test':result=await this.ports.broker.test(source,input.requestId,owner,credentialOwner);break;
  }
  this.assertScope(source.accepted.scope);this.ports.changed();return result;
 }
}
