/**
 * [INPUT]: Depends on durable JSON, exact package freezing, the authored generation owner and the current main-owned account/installation scope.
 * [OUTPUT]: Provides verified/repairable local archives, selective entry reads, exact retained-generation lookup, terminal full-source retirement, encrypted source Chat pointer custody, the original resumable delivery queue, exact completion receipts, explicit retry/abandon, receiver custody, same-generation source archive restoration, repair revision signals, account-scoped collection and orphan cleanup and the exact package ledger schema.
 * [POS]: Private source-package custody owner; local application does not depend on Cloud availability or writable source after freezing.
 */
import {createHash} from 'node:crypto';
import {assertWidgetPackageDelivery,type WidgetPackageDelivery} from '@ai-chat/cloud-protocol/widgets/model';
import {join} from 'node:path';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {z} from 'zod';
import {canonicalJson,hashCanonical} from '@bottega/contracts/core/canonical-json';
import {widgetPackageDescriptorSchema,type WidgetPackageDescriptor} from '@bottega/contracts/plugins/dock/packages';
import {DurableJson,durableReplaceBytes} from '../../../persistence/durable-json';
import type {PluginSurfaceRuntime} from '../service';
import {BUDGET,freezePackage,verifyPackage} from './codec';
import {removeWidgetArchives,removeWidgetAccountArchives,widgetArchiveDirectory,ensureWidgetArchiveDirectory} from './retention';
const record=z.object({sourceChatId:z.string().min(1).max(160).optional(),reference:z.string().regex(/^sha256:[a-f0-9]{64}$/),descriptor:widgetPackageDescriptorSchema,bytes:z.number().int().nonnegative().max(BUDGET.packageBytes),operationIds:z.array(z.string().regex(/^[A-Za-z0-9_-]{8,128}$/)).max(256),retired:z.boolean().default(false),delivery:z.enum(['prepared','pending','delivered','abandoned','discarded']),error:z.literal('WIDGET_DELIVERY_FAILED').nullable().default(null),createdAt:z.number().int().nonnegative()}).strict();
export const widgetPackageLedgerSchema=z.object({version:z.literal(1),packages:z.array(record).max(BUDGET.retainedPackages)}).strict();
const schema=widgetPackageLedgerSchema;
type Frozen={reference:string;descriptor:WidgetPackageDescriptor;bytes:Buffer;sourceChat?:{chatId:string}};
type Scope={accountId:string;installationId:string};
export class WidgetPackageStore{
 private readonly file:DurableJson<z.infer<typeof schema>>;
 private tail:Promise<unknown>=Promise.resolve();
 private closed=true;
 private readonly archiveVersions=new Map<string,number>();
 private readonly invalid=new Set<string>();
 private readonly listeners=new Set<()=>void>();
 constructor(private readonly userData:string,private readonly runtime:PluginSurfaceRuntime,private readonly scope:()=>Scope){
  this.file=new DurableJson(join(userData,'dock-widget-packages.json'),schema,()=>({version:1,packages:[]}));
 }
 async initialize(){await this.file.initialize();this.closed=false;const scope=this.scope();
  const completed=this.file.read(state=>state.packages.filter(value=>(value.delivery==='delivered'||value.delivery==='abandoned')&&value.descriptor.source.accountId===scope.accountId&&value.descriptor.source.installationId===scope.installationId).map(value=>({source:value.descriptor.source,operationIds:value.operationIds})));
  for(const entry of completed){this.assertScope(scope);if(!this.runtime.descriptor(entry.source.definitionId))continue;for(const id of entry.operationIds){await this.runtime.releaseGeneration(entry.source.definitionId,id);this.assertScope(scope);}}
 }
 async prepare(definitionId:string,generationId:string):Promise<Frozen>{
  this.assertOpen();const scope=this.scope(),record=this.runtime.descriptor(definitionId),generation=record?.generations.find(value=>value.generationId===generationId&&value.available&&'dock' in value.manifest);
  if(!generation)throw new Error('WIDGET_PACKAGE_GENERATION_MISSING');
  const started=performance.now(),frozen=await freezePackage(this.runtime.artifactRoot(definitionId,generationId),{...scope,definitionId,generationId},generation.digests);
  this.assertScope(scope);if(performance.now()-started>=BUDGET.archiveMs)throw new Error('WIDGET_PACKAGE_ARCHIVE_TIMEOUT');return frozen;
 }
 retainedGeneration(definitionId:string,generationId:string){
  this.assertOpen();const scope=this.scope(),generation=this.runtime.descriptor(definitionId)?.generations.find(value=>value.generationId===generationId&&value.available);
  if(!generation||!('dock'in generation.manifest))throw new Error('WIDGET_PACKAGE_GENERATION_MISSING');
  const source=canonicalJson({...scope,definitionId,generationId}),digests=canonicalJson(generation.digests),contractDigest=`sha256:${hashCanonical({dock:generation.manifest.dock,operations:generation.manifest.operations})}`;
  const matches=this.file.read(state=>state.packages.filter(value=>!value.retired&&canonicalJson(value.descriptor.source)===source&&canonicalJson(value.descriptor.digests)===digests&&value.descriptor.contractDigest===contractDigest).map(value=>({reference:value.reference,descriptor:value.descriptor})));
  if(matches.length!==1)throw new Error('WIDGET_PACKAGE_GENERATION_MISSING');return matches[0]!;
 }
 retain(frozen:Frozen,operationId:string){return this.enqueue(async()=>{
  const scope=this.scope();this.assertScope(frozen.descriptor.source);
  const original=this.file.snapshot().packages.find(value=>value.reference===frozen.reference);
  if(original?.retired)throw new Error('WIDGET_DEFINITION_REVOKED');
  if(original&&canonicalJson(original.descriptor)!==canonicalJson(frozen.descriptor))throw new Error('WIDGET_PACKAGE_IDENTITY_CHANGED');
  if(!original){const entries=this.file.snapshot().packages;if(entries.length>=BUDGET.retainedPackages||entries.reduce((sum,value)=>sum+value.bytes,0)+frozen.bytes.length>BUDGET.retainedBytes)throw new Error('WIDGET_PACKAGE_STORAGE_FULL');}
  if(original?.delivery!=='delivered')await this.runtime.retainGeneration(frozen.descriptor.source.definitionId,frozen.descriptor.source.generationId,operationId,scope);this.assertScope(scope);
  await ensureWidgetArchiveDirectory(this.userData,scope.accountId);
  const path=this.path(frozen.reference),existing=await readArchive(path).catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
  if(existing){verifyPackage(existing,frozen.reference,frozen.descriptor.source);if(!existing.equals(frozen.bytes))throw new Error('WIDGET_PACKAGE_ARCHIVE_CHANGED');}
  else await durableReplaceBytes(path,frozen.bytes);
  this.assertScope(scope);
  await this.file.mutate(state=>{
   const item=state.packages.find(value=>value.reference===frozen.reference);
   if(item){if(item.delivery==='abandoned'||item.delivery==='discarded'){item.delivery='prepared';item.error=null;}if(!item.operationIds.includes(operationId)){if(item.operationIds.length>=256)throw new Error('WIDGET_PACKAGE_OPERATION_CAPACITY');item.operationIds.push(operationId);}}
   else state.packages.push({reference:frozen.reference,descriptor:frozen.descriptor,bytes:frozen.bytes.length,operationIds:[operationId],...(this.runtime.descriptor(frozen.descriptor.source.definitionId)?.ownerChatId?{sourceChatId:this.runtime.descriptor(frozen.descriptor.source.definitionId)!.ownerChatId}:{}),retired:false,delivery:'prepared',error:null,createdAt:Date.now()});
  });
  this.assertScope(scope);this.bumpArchive(frozen.reference);this.changed();return{reference:frozen.reference,delivery:original?.delivery??'prepared'};
 });}
 activateDelivery(reference:string,operationId:string){return this.enqueue(async()=>{
  const descriptor=this.descriptor(reference);if(!descriptor)throw new Error('WIDGET_PACKAGE_NOT_AVAILABLE');this.assertScope(descriptor.source);
  const selected=this.runtime.descriptor(descriptor.source.definitionId);
  if(selected?.activeGenerationId!==descriptor.source.generationId||selected.lastActivation?.operationId!==operationId)throw new Error('WIDGET_PACKAGE_ACTIVATION_REQUIRED');
  await this.file.mutate(state=>{const entry=state.packages.find(value=>value.reference===reference&&value.operationIds.includes(operationId));if(!entry)throw new Error('WIDGET_PACKAGE_OPERATION_MISSING');if(entry.delivery==='prepared')entry.delivery='pending';});this.changed();
 });}
 async read(reference:string){
  this.assertOpen();const scope=this.scope(),entry=this.file.read(state=>state.packages.find(value=>value.reference===reference&&!value.retired&&value.descriptor.source.accountId===scope.accountId));
  if(!entry)throw new Error('WIDGET_PACKAGE_NOT_AVAILABLE');
  const started=performance.now(),value=await this.verified(reference,entry);this.assertScope(scope);if(performance.now()-started>=BUDGET.verifyMs)throw new Error('WIDGET_PACKAGE_VERIFY_TIMEOUT');return value.packet;
 }
 origin(reference:string){const value=this.file.read(state=>state.packages.find(value=>value.reference===reference&&!value.retired&&value.descriptor.source.accountId===this.scope().accountId));return value?.sourceChatId?{chatId:value.sourceChatId}:null;}
 descriptor(reference:string):WidgetPackageDescriptor|null{
  const account=this.scope().accountId;return this.file.read(state=>state.packages.find(value=>value.reference===reference&&!value.retired&&value.descriptor.source.accountId===account)?.descriptor??null);
 }
 install(frozen:Frozen,operationId:string){return this.enqueue(async()=>{
  const scope=this.scope();if(frozen.descriptor.source.accountId!==scope.accountId)throw new Error('WIDGET_PACKAGE_SCOPE_CHANGED');
  const packet=verifyPackage(frozen.bytes,frozen.reference,frozen.descriptor.source);
  if(canonicalJson(packet.descriptor)!==canonicalJson(frozen.descriptor))throw new Error('WIDGET_PACKAGE_ARCHIVE_CHANGED');
  const entries=this.file.snapshot().packages,original=entries.find(value=>value.reference===frozen.reference);if(original?.retired)throw new Error('WIDGET_DEFINITION_REVOKED');
  if(!original&&(entries.length>=BUDGET.retainedPackages||entries.reduce((sum,value)=>sum+value.bytes,0)+frozen.bytes.length>BUDGET.retainedBytes))throw new Error('WIDGET_PACKAGE_STORAGE_FULL');
  await ensureWidgetArchiveDirectory(this.userData,scope.accountId);this.assertScope(scope);
  let bytes:Buffer|null=null;try{bytes=await readArchive(this.path(frozen.reference));}catch(error){if(!(error instanceof Error)||!('code'in error&&error.code==='ENOENT')&&!['WIDGET_PACKAGE_ARCHIVE_CHANGED','WIDGET_PACKAGE_ARCHIVE_INVALID'].includes(error.message))throw error;}
  if(bytes&&!bytes.equals(frozen.bytes)){let valid=true;try{verifyPackage(bytes,frozen.reference,frozen.descriptor.source);}catch{valid=false;}if(valid)throw new Error('WIDGET_PACKAGE_ARCHIVE_CHANGED');bytes=null;await removeWidgetArchives(widgetArchiveDirectory(this.userData,scope.accountId),[frozen.reference]);}
  if(!bytes){await removeWidgetArchives(widgetArchiveDirectory(this.userData,scope.accountId),[frozen.reference]);await durableReplaceBytes(this.path(frozen.reference),frozen.bytes);}this.assertScope(scope);this.invalid.delete(frozen.reference);
  if(!original)await this.file.mutate(state=>{state.packages.push({reference:frozen.reference,descriptor:packet.descriptor,bytes:frozen.bytes.length,operationIds:[operationId],...(frozen.sourceChat?{sourceChatId:frozen.sourceChat.chatId}:{}),retired:false,delivery:'delivered',error:null,createdAt:Date.now()});});
  this.bumpArchive(frozen.reference);this.changed();
 });}
 clearAccount(accountId:string){return this.enqueue(async()=>{
  const references=this.file.read(state=>state.packages.filter(value=>value.descriptor.source.accountId===accountId).map(value=>value.reference));
  await removeWidgetAccountArchives(this.userData,accountId);
  await this.file.mutate(state=>{state.packages=state.packages.filter(value=>value.descriptor.source.accountId!==accountId);});for(const reference of references){this.archiveVersions.delete(reference);this.invalid.delete(reference);}this.changed();
 });}
 cancelPreparation(reference:string,operationId:string,expected?:{definitionId:string;generationId:string}){return this.enqueue(async()=>{
  const scope=this.scope(),entry=this.deliveryRecords().find(value=>value.reference===reference);
  if(!entry){
   if(!expected)throw new Error('WIDGET_PACKAGE_NOT_AVAILABLE');
   const record=this.runtime.descriptor(expected.definitionId),pin=record?.retentionPins.find(value=>value.id===operationId&&value.generationId===expected.generationId&&value.scope?.accountId===scope.accountId&&value.scope.installationId===scope.installationId);
   if(pin&&!(record?.activeGenerationId===expected.generationId&&record.lastActivation?.operationId===operationId))await this.runtime.releaseGeneration(expected.definitionId,operationId);
   this.assertScope(scope);return;
  }
  if(!entry.operationIds.includes(operationId))return;
  const source=entry.descriptor.source,record=this.runtime.descriptor(source.definitionId),activated=record?.activeGenerationId===source.generationId&&record.lastActivation?.operationId===operationId;
  if(expected&&(expected.definitionId!==source.definitionId||expected.generationId!==source.generationId))throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
  if(!activated)await this.runtime.releaseGeneration(source.definitionId,operationId);this.assertScope(scope);
  await this.file.mutate(state=>{const value=state.packages.find(value=>value.reference===reference)!;if(activated){if(value.delivery==='prepared')value.delivery='pending';return;}value.operationIds=value.operationIds.filter(id=>id!==operationId);if(!value.operationIds.length&&value.delivery==='prepared')value.delivery='discarded';});this.changed();
 });}
 retireDefinition(subject:{definitionId:string;sourceInstallationId:string}){return this.enqueue(async()=>{
  const scope=this.scope(),selected=this.file.read(state=>state.packages.filter(value=>value.descriptor.source.accountId===scope.accountId&&value.descriptor.source.definitionId===subject.definitionId&&value.descriptor.source.installationId===subject.sourceInstallationId));
  await this.file.mutate(state=>{this.assertScope(scope);for(const value of state.packages)if(selected.some(entry=>entry.reference===value.reference)){value.retired=true;value.delivery='abandoned';value.error=null;}});this.changed();
  if(subject.sourceInstallationId===scope.installationId&&this.runtime.descriptor(subject.definitionId))for(const entry of selected)for(const id of entry.operationIds){this.assertScope(scope);await this.runtime.releaseGeneration(subject.definitionId,id);}
 });}
 collectionState(){this.assertOpen();const scope=this.scope();const entries=this.file.read(state=>state.packages.map(value=>({reference:value.reference,source:value.descriptor.source,delivery:value.delivery,retired:value.retired})));const heads=[...new Set(entries.filter(value=>value.source.installationId===scope.installationId).map(value=>value.source.definitionId))].map(id=>{const record=this.runtime.descriptor(id);return[id,record?.activeGenerationId??null,record?.previousGenerationId??null];});return{scope,entries,heads};}
 collect(references:readonly string[]){return this.enqueue(async()=>{
  const scope=this.scope(),roots=new Set(references),entries=this.file.read(state=>state.packages.map(value=>({reference:value.reference,source:value.descriptor.source,delivery:value.delivery,retired:value.retired}))),sources=new Map<string,ReturnType<PluginSurfaceRuntime['descriptor']>>();
  for(const entry of entries){if(entry.source.accountId!==scope.accountId||entry.retired)continue;if(entry.delivery==='prepared'||entry.delivery==='pending')roots.add(entry.reference);
   if(entry.source.installationId!==scope.installationId)continue;let source=sources.get(entry.source.definitionId);if(source===undefined){source=this.runtime.descriptor(entry.source.definitionId);sources.set(entry.source.definitionId,source);}if(source&&(source.activeGenerationId===entry.source.generationId||source.previousGenerationId===entry.source.generationId))roots.add(entry.reference);
  }
  const selected=entries.filter(value=>value.source.accountId===scope.accountId&&!roots.has(value.reference)).map(value=>value.reference);if(!selected.length)return[];
  this.assertScope(scope);await removeWidgetArchives(widgetArchiveDirectory(this.userData,scope.accountId),selected);this.assertScope(scope);const removed=new Set(selected);await this.file.mutate(state=>{state.packages=state.packages.filter(value=>!removed.has(value.reference));});for(const reference of removed){this.archiveVersions.delete(reference);this.invalid.delete(reference);}this.changed();return selected;
 });}
 onChanged(listener:()=>void){this.listeners.add(listener);return()=>{this.listeners.delete(listener);};}
 deliveryRecords(){this.assertOpen();const scope=this.scope();return this.file.read(state=>state.packages.filter(entry=>entry.descriptor.source.accountId===scope.accountId&&entry.descriptor.source.installationId===scope.installationId));}
 async readFrozen(reference:string){
  this.assertOpen();const scope=this.scope(),entry=this.file.read(state=>state.packages.find(value=>value.reference===reference&&!value.retired&&value.descriptor.source.accountId===scope.accountId));
  if(!entry)throw new Error('WIDGET_PACKAGE_NOT_AVAILABLE');
  const {bytes}=await this.verified(reference,entry);this.assertScope(scope);
  return{reference,descriptor:structuredClone(entry.descriptor),bytes,...(entry.sourceChatId?{sourceChat:{chatId:entry.sourceChatId}}:{})};
 }
 archiveRevision(reference:string){return this.archiveVersions.get(reference)??0;}
 private bumpArchive(reference:string){this.archiveVersions.set(reference,this.archiveRevision(reference)+1);}
 available(reference:string){return!this.invalid.has(reference)&&Boolean(this.descriptor(reference));}
 private async verified(reference:string,entry:z.infer<typeof record>){
  const scope=this.scope();try{const bytes=await readArchive(this.path(reference));this.assertScope(scope);const packet=verifyPackage(bytes,reference,entry.descriptor.source);if(bytes.length!==entry.bytes||canonicalJson(packet.descriptor)!==canonicalJson(entry.descriptor))throw new Error('WIDGET_PACKAGE_ARCHIVE_CHANGED');this.invalid.delete(reference);return{bytes,packet};}
  catch(error){let failure=error;
   if(!this.closed&&entry.descriptor.source.installationId===scope.installationId&&canonicalJson(this.scope())===canonicalJson(scope)){
    let wrote=false;
    try{
     const current=()=>{this.assertScope(scope);const value=this.file.read(state=>state.packages.find(value=>value.reference===reference));if(!value||value.retired||canonicalJson(value.descriptor)!==canonicalJson(entry.descriptor))throw new Error('WIDGET_PACKAGE_NOT_AVAILABLE');};current();
     const frozen=await this.prepare(entry.descriptor.source.definitionId,entry.descriptor.source.generationId);current();if(frozen.reference!==reference||canonicalJson(frozen.descriptor)!==canonicalJson(entry.descriptor))throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
     await ensureWidgetArchiveDirectory(this.userData,scope.accountId);current();await removeWidgetArchives(widgetArchiveDirectory(this.userData,scope.accountId),[reference]);current();await durableReplaceBytes(join(widgetArchiveDirectory(this.userData,scope.accountId),reference.slice(7)+'.json'),frozen.bytes);wrote=true;current();
     this.invalid.delete(reference);this.bumpArchive(reference);this.changed();return{bytes:frozen.bytes,packet:verifyPackage(frozen.bytes,reference,entry.descriptor.source)};
    }catch(repairError){if(wrote&&(this.closed||canonicalJson(this.scope())!==canonicalJson(scope)||!this.file.read(state=>state.packages.some(value=>value.reference===reference&&!value.retired))))await removeWidgetArchives(widgetArchiveDirectory(this.userData,scope.accountId),[reference]);failure=repairError;}
   }
   if(!this.closed&&canonicalJson(this.scope())===canonicalJson(scope)&&!this.invalid.has(reference)){this.invalid.add(reference);this.changed();}throw failure;
  }
 }
 failDelivery(reference:string,_error:'WIDGET_DELIVERY_FAILED'){return this.deliveryMutation(reference,entry=>{if(entry.delivery==='pending')entry.error='WIDGET_DELIVERY_FAILED';});}
 retryDelivery(reference:string){return this.deliveryMutation(reference,entry=>{if(entry.retired||entry.delivery==='discarded')throw new Error('WIDGET_DELIVERY_NOT_ACTIVE');if(entry.delivery==='pending'||entry.delivery==='abandoned'){entry.delivery='pending';entry.error=null;}});}
 completeDelivery(reference:string,raw:WidgetPackageDelivery){return this.enqueue(async()=>{
  const entry=this.deliveryRecord(reference),source=entry.descriptor.source;
  const receipt=assertWidgetPackageDelivery(raw,{accountId:source.accountId,subject:{definitionId:source.definitionId,sourceInstallationId:source.installationId},reference});
  const frozen=await this.readFrozen(reference);
  if(receipt.generationId!==source.generationId||receipt.contractDigest!==entry.descriptor.contractDigest||receipt.archiveBytes!==entry.bytes||receipt.archiveSha256!==createHash('sha256').update(frozen.bytes).digest('hex'))throw new Error('WIDGET_PACKAGE_SOURCE_CHANGED');
  this.assertScope(source);if(entry.delivery==='abandoned'||entry.delivery==='discarded')throw new Error('WIDGET_DELIVERY_ABANDONED');
  await this.file.mutate(state=>{const value=state.packages.find(value=>value.reference===reference)!;value.delivery='delivered';value.error=null;});
  for(const id of entry.operationIds){this.assertScope(source);await this.runtime.releaseGeneration(source.definitionId,id);}
  this.changed();
 });}
 abandonDelivery(reference:string){return this.enqueue(async()=>{
  const entry=this.deliveryRecord(reference),source=entry.descriptor.source;if(entry.delivery==='prepared')throw new Error('WIDGET_APPLICATION_PENDING');
  await this.file.mutate(state=>{const value=state.packages.find(value=>value.reference===reference)!;value.delivery='abandoned';value.error=null;});
  for(const id of entry.operationIds){this.assertScope(source);await this.runtime.releaseGeneration(source.definitionId,id);}
  this.changed();
 });}
 private deliveryRecord(reference:string){const value=this.deliveryRecords().find(value=>value.reference===reference);if(!value)throw new Error('WIDGET_PACKAGE_NOT_AVAILABLE');return value;}
 private deliveryMutation(reference:string,change:(entry:z.infer<typeof record>)=>void){return this.enqueue(async()=>{const original=this.deliveryRecord(reference);await this.file.mutate(state=>{this.assertScope(original.descriptor.source);change(state.packages.find(value=>value.reference===reference)!);});this.changed();});}
 private changed(){for(const listener of this.listeners)try{listener();}catch(error){console.warn('[widget-packages] observer failed',error);}}
 private path(reference:string){if(!/^sha256:[a-f0-9]{64}$/.test(reference))throw new Error('WIDGET_PACKAGE_REFERENCE_INVALID');return join(widgetArchiveDirectory(this.userData,this.scope().accountId),reference.slice(7)+'.json');}
 private assertOpen(){if(this.closed)throw new Error('WIDGET_PACKAGES_CLOSED');}
 private assertScope(scope:Scope){this.assertOpen();if(canonicalJson(this.scope())!==canonicalJson({accountId:scope.accountId,installationId:scope.installationId}))throw new Error('WIDGET_PACKAGE_SCOPE_CHANGED');}
 private enqueue<T>(run:()=>Promise<T>):Promise<T>{this.assertOpen();const next=this.tail.then(run);this.tail=next.catch(()=>{});return next;}
 async close(){this.closed=true;this.listeners.clear();await this.tail;await this.file.closeAndFlush();}
}
async function readArchive(path:string){
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const before=await file.stat();if(!before.isFile()||before.nlink!==1||(before.mode&0o111)!==0||before.size>BUDGET.packageBytes)throw new Error('WIDGET_PACKAGE_ARCHIVE_INVALID');
  const bytes=Buffer.alloc(before.size+1);let length=0;
  while(length<bytes.length){const read=await file.read(bytes,length,bytes.length-length,null);if(!read.bytesRead)break;length+=read.bytesRead;}
  const after=await file.stat();if(length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw new Error('WIDGET_PACKAGE_ARCHIVE_CHANGED');
  return bytes.subarray(0,length);
 }finally{await file.close();}
}
