/**
 * [INPUT]: Depends on strict local API schemas, atomic DurableJson and the guarded native secureStorage port.
 * [OUTPUT]: Provides ApiStateStore with protected credential slots, local use grants, explicit copies and recoverable owner association.
 * [POS]: Main-only API authority; it never returns plaintext to a renderer or synchronizes credential state.
 */
import {join} from 'node:path';
import {z} from 'zod';
import {DurableJson} from '../../../../persistence/durable-json';
import {secureStorage} from '../../../../security/safe-storage';
import {apiStateSchema,apiOwnerSchema,digest,ownerKey,sameOwner,type ApiOwner,type ApiGrant,type ApiSlot,type ApiState} from './model';

const secretSchema=z.object({owner:z.string(),slotId:z.string(),revision:z.number(),value:z.string().min(1).max(8192)}).strict();
type CipherPort=Pick<typeof secureStorage,'isEncryptionAvailable'|'getSelectedStorageBackend'|'encryptString'|'decryptString'>;
type Approval=Readonly<{owner:ApiOwner;requestId:string;scopeDigest:string;packageRef:string;slotIds:string[];credentialRevision:string}>;
export class ApiStateStore{
 private readonly file:DurableJson<ApiState>;
 constructor(userData:string,private readonly changed:()=>void=()=>{},private readonly cipher:CipherPort=secureStorage){
  this.file=new DurableJson(join(userData,'dock-widget-api.json'),apiStateSchema,()=>({version:1,slots:[],grants:[],associations:[]}));
 }
 initialize(){return this.file.initialize();}
 grant(owner:ApiOwner,requestId:string){return this.file.read(state=>state.grants.find(item=>sameOwner(item.owner,owner)&&item.requestId===requestId)??null);}
 slots(owner:ApiOwner){return this.file.read(state=>state.slots.filter(item=>sameOwner(item.owner,owner)).map(item=>({slotId:item.slotId,revision:item.revision,set:item.cipher!==null})));}
 owners(activeOnly=false){return this.file.read(state=>[...new Map([...state.slots,...state.grants.filter(item=>!activeOnly||!item.revoked)].map(item=>[ownerKey(item.owner),item.owner])).values()]);}
 copyCandidates(target:ApiOwner){return this.file.read(state=>state.slots.filter(item=>item.cipher!==null&&item.owner.accountId===target.accountId&&item.owner.executionInstallationId===target.executionInstallationId).map(item=>({owner:item.owner,slotId:item.slotId,revision:item.revision})));}
 credentialRevision(owner:ApiOwner,slotIds:readonly string[]){return digest(slotIds.map(id=>{const slot=this.slot(owner,id);return[id,slot?.revision??0,Boolean(slot?.cipher)];}));}
 private slot(owner:ApiOwner,slotId:string){return this.file.read(state=>state.slots.find(item=>sameOwner(item.owner,owner)&&item.slotId===slotId)??null);}
 private available(){if(!this.cipher.isEncryptionAvailable()||process.platform==='linux'&&this.cipher.getSelectedStorageBackend()==='basic_text')throw new Error('DOCK_API_SECURE_STORAGE_UNAVAILABLE');}
 private encrypt(owner:ApiOwner,slotId:string,revision:number,value:string){
  this.available();secretSchema.parse({owner:ownerKey(owner),slotId,revision,value});
  if(/[\r\n\0]/.test(value))throw new Error('DOCK_API_CREDENTIAL_INVALID');
  return this.cipher.encryptString(JSON.stringify({owner:ownerKey(owner),slotId,revision,value})).toString('base64');
 }
 private decrypt(slot:ApiSlot){
  if(!slot.cipher)return null;this.available();let stored:z.infer<typeof secretSchema>;
  try{stored=secretSchema.parse(JSON.parse(this.cipher.decryptString(Buffer.from(slot.cipher,'base64'))));}catch{throw new Error('DOCK_API_SECURE_STORAGE_UNAVAILABLE');}
  if(stored.owner!==ownerKey(slot.owner)||stored.slotId!==slot.slotId||stored.revision!==slot.revision)throw new Error('DOCK_API_CREDENTIAL_IDENTITY_CHANGED');return stored.value;
 }
 /** This Main-only method is called only after the broker checks its current grant. */
 material(owner:ApiOwner,slotId:string){const slot=this.slot(owner,slotId);return slot?this.decrypt(slot):null;}
 async setCredential(owner:ApiOwner,slotId:string,value:string|null){
  apiOwnerSchema.parse(owner);if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(slotId))throw new Error('DOCK_API_SLOT_INVALID');
  await this.file.mutate(state=>{
   const prior=state.slots.find(item=>sameOwner(item.owner,owner)&&item.slotId===slotId),revision=(prior?.revision??0)+1;
   if(prior&&this.decrypt(prior)===value)return;
   const next:ApiSlot={owner,slotId,revision,cipher:value===null?null:this.encrypt(owner,slotId,revision,value)};
   if(prior)Object.assign(prior,next);else state.slots.push(next);
   for(const grant of state.grants)if(sameOwner(grant.owner,owner)&&grant.slotIds.includes(slotId)){
    grant.revision++;grant.suspension=null;grant.credentialRevision=digest(grant.slotIds.map(id=>{const slot=state.slots.find(item=>sameOwner(item.owner,owner)&&item.slotId===id);return[id,slot?.revision??0,Boolean(slot?.cipher)];}));
   }
  });this.changed();
 }
 async copyCredential(source:ApiOwner,target:ApiOwner,sourceSlot:string,targetSlot:string){
  if(source.accountId!==target.accountId||source.executionInstallationId!==target.executionInstallationId)throw new Error('DOCK_API_CREDENTIAL_COPY_SCOPE');
  const value=this.material(source,sourceSlot);if(value===null)throw new Error('DOCK_API_CREDENTIAL_REQUIRED');
  await this.setCredential(target,targetSlot,value);
 }
 async approve(input:Approval){
  await this.file.mutate(state=>{
   const prior=state.grants.find(item=>sameOwner(item.owner,input.owner)&&item.requestId===input.requestId);
   const unchanged=prior&&!prior.revoked&&prior.scopeDigest===input.scopeDigest&&prior.credentialRevision===input.credentialRevision;
   if(unchanged&&prior.packageRef===input.packageRef)return;
   const next:ApiGrant={...input,revision:(prior?.revision??0)+1,approvedAt:Date.now(),revoked:false,suspension:unchanged?prior.suspension:null,notBefore:unchanged?prior.notBefore:0};
   if(prior)Object.assign(prior,next);else state.grants.push(next);
  });this.changed();return this.grant(input.owner,input.requestId)!;
 }
 async revoke(owner:ApiOwner,requestId?:string){
  await this.file.mutate(state=>{for(const grant of state.grants)if(sameOwner(grant.owner,owner)&&(!requestId||grant.requestId===requestId)){grant.revoked=true;grant.revision++;}});this.changed();
 }
 async transition(owner:ApiOwner,requestId:string,revision:number,change:Partial<Pick<ApiGrant,'suspension'|'notBefore'|'credentialRevision'>>){
  let applied=false;await this.file.mutate(state=>{const grant=state.grants.find(item=>sameOwner(item.owner,owner)&&item.requestId===requestId);
   if(!grant||grant.revoked||grant.revision!==revision)return;Object.assign(grant,change);applied=true;});return applied;
 }
 private ownerRevision(state:ApiState,owner:ApiOwner){return digest({slots:state.slots.filter(item=>sameOwner(item.owner,owner)),grants:state.grants.filter(item=>sameOwner(item.owner,owner))});}
 async prepareAssociation(input:{operationId:string;draft:ApiOwner;target:ApiOwner;identity:string;approvals:readonly Approval[]}){
  const copy=!sameOwner(input.draft,input.target);
  if(copy&&input.draft.ownerKind!=='authoring-draft'||input.target.ownerKind!=='instance'||input.draft.accountId!==input.target.accountId||input.draft.executionInstallationId!==input.target.executionInstallationId||input.draft.definitionId!==input.target.definitionId)throw new Error('DOCK_API_ASSOCIATION_SCOPE');
  await this.file.mutate(state=>{
   const existing=state.associations.find(item=>item.operationId===input.operationId);
   if(existing){if(existing.phase==='cancelled'||!sameOwner(existing.draft,input.draft)||!sameOwner(existing.target,input.target)||existing.identity!==input.identity)throw new Error('DOCK_API_OPERATION_CONFLICT');return;}
   const selectedSlots=new Set(input.approvals.flatMap(approval=>approval.slotIds));
   const slots=copy?state.slots.filter(item=>sameOwner(item.owner,input.draft)&&selectedSlots.has(item.slotId)).map(slot=>{const value=this.decrypt(slot),revision=(state.slots.find(item=>sameOwner(item.owner,input.target)&&item.slotId===slot.slotId)?.revision??0)+1;return{owner:input.target,slotId:slot.slotId,revision,cipher:value===null?null:this.encrypt(input.target,slot.slotId,revision,value)};}):[];
   const grants=input.approvals.map(approval=>{
    const credentialRevision=copy?digest(approval.slotIds.map(id=>{const slot=slots.find(item=>item.slotId===id)??state.slots.find(item=>sameOwner(item.owner,input.target)&&item.slotId===id);return[id,slot?.revision??0,Boolean(slot?.cipher)];})):approval.credentialRevision;
    const prior=state.grants.find(item=>sameOwner(item.owner,input.draft)&&item.requestId===approval.requestId),target=state.grants.find(item=>sameOwner(item.owner,input.target)&&item.requestId===approval.requestId);
    const sourceSame=prior&&!prior.revoked&&prior.scopeDigest===approval.scopeDigest&&prior.credentialRevision===approval.credentialRevision,targetSame=target&&!target.revoked&&target.scopeDigest===approval.scopeDigest&&target.credentialRevision===credentialRevision;
    return{...approval,owner:input.target,revision:(target?.revision??0)+1,approvedAt:Date.now(),revoked:false,suspension:(sourceSame?prior.suspension:null)??(targetSame?target.suspension:null),notBefore:Math.max(sourceSame?prior.notBefore:0,targetSame?target.notBefore:0),credentialRevision};
   });
   if(state.associations.length>=128){const old=state.associations.findIndex(item=>item.phase==='committed'&&item.acknowledged);if(old<0)throw new Error('DOCK_API_OPERATION_CAPACITY');state.associations.splice(old,1);}
   state.associations.push({operationId:input.operationId,draft:input.draft,target:input.target,identity:input.identity,phase:'prepared',acknowledged:false,draftRevision:this.ownerRevision(state,input.draft),targetRevision:this.ownerRevision(state,input.target),slots,grants});
  });
 }
 async commitAssociation(operationId:string,current:(owner:ApiOwner)=>boolean=()=>true){
  await this.file.mutate(state=>{
   const operation=state.associations.find(item=>item.operationId===operationId);if(!operation)throw new Error('DOCK_API_OPERATION_MISSING');if(!current(operation.target))throw new Error('DOCK_API_SCOPE_CHANGED');if(operation.phase==='committed')return;if(operation.phase==='cancelled')throw new Error('DOCK_API_ASSOCIATION_REVOKED');
   if(operation.targetRevision!==this.ownerRevision(state,operation.target)||operation.draftRevision!==this.ownerRevision(state,operation.draft))throw new Error('DOCK_API_ASSOCIATION_CONFLICT');
   for(const slot of operation.slots){const index=state.slots.findIndex(item=>sameOwner(item.owner,operation.target)&&item.slotId===slot.slotId);if(index<0)state.slots.push(slot);else state.slots[index]=slot;}
   for(const grant of operation.grants){const index=state.grants.findIndex(item=>sameOwner(item.owner,operation.target)&&item.requestId===grant.requestId);if(index<0)state.grants.push(grant);else state.grants[index]=grant;}
   if(!sameOwner(operation.draft,operation.target)&&operation.slots.length){
    const transferred=new Set(operation.slots.map(slot=>slot.slotId));state.slots=state.slots.filter(slot=>!sameOwner(slot.owner,operation.draft)||!transferred.has(slot.slotId));
    for(const grant of state.grants)if(sameOwner(grant.owner,operation.draft)&&grant.slotIds.some(id=>transferred.has(id))){grant.revoked=true;grant.revision++;}
   }
   operation.phase='committed';operation.slots=[];operation.grants=[];
  });this.changed();
 }
 async removeOwner(owner:ApiOwner,keepCredentials=false){
  await this.file.mutate(state=>{
   state.slots=state.slots.filter(item=>keepCredentials||!sameOwner(item.owner,owner));
   for(const grant of state.grants)if(sameOwner(grant.owner,owner)&&!grant.revoked){grant.revoked=true;grant.revision++;}
   for(const operation of state.associations)if(operation.phase==='prepared'&&(sameOwner(operation.draft,owner)||sameOwner(operation.target,owner))){operation.phase='cancelled';operation.slots=[];operation.grants=[];}
  });this.changed();
 }
 async acknowledgeAssociation(operationId:string){await this.file.mutate(state=>{const operation=state.associations.find(item=>item.operationId===operationId);if(operation?.phase==='committed')operation.acknowledged=true;});}
 async clearAccount(accountId:string){await this.file.mutate(state=>{state.slots=state.slots.filter(item=>item.owner.accountId!==accountId);state.grants=state.grants.filter(item=>item.owner.accountId!==accountId);state.associations=state.associations.filter(item=>item.draft.accountId!==accountId&&item.target.accountId!==accountId);});this.changed();}
 close(){return this.file.closeAndFlush();}
}
