/**
 * [INPUT]: Depends on trusted Widget sources, local API state, bounded HTTPS transport, typed projection and one shared scheduler.
 * [OUTPUT]: Provides DockApiData, isolated visible consumers, host connection controls and journal-bound credential association.
 * [POS]: Main-owned generic API broker; source/package arrival and portable settings never grant network access.
 */
import {randomBytes} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {DOCK_API_BUDGET as B,dockApiRequirementSchema,type DockApiRequirement,type DockApiFailure} from '@bottega/contracts/plugins/dock/api';
import type {DockContribution} from '@bottega/contracts/plugins/dock/manifest';
import type {CustomDockWidget} from '../../../../../shared/system-dock/widgets/instance';
import type {WidgetDetailSource} from '../detail/ports';
import {apiRequirements,instanceApiOwner,type ApiOwner,type ApiAssociation,type ApiConnectionReview,type ApiConfiguration,type ApiConsumerPorts,type ApiHealth,type ApiReading,type DockApiConsumer} from './model';
import {ApiStateStore} from './state/store';
import {digest,ownerKey,sameOwner,type ApiGrant} from './state/model';
import {ApiScheduler} from './scheduler';
import {apiParameters,apiScope,apiSlotIds,buildApiRequest,apiRedirect,projectApiResponse} from './projection';
import {directApiRequest,ApiTransportError,type ApiTransport,type ApiRefreshBudget} from './transport';

type Plan={source:WidgetDetailSource;query:DockApiRequirement;owner:ApiOwner;credentialOwner:ApiOwner;grant:ApiGrant|null;scopeDigest:string;credentialRevision:string;identity:string;configured:boolean;permitted:boolean};
type Entry={plan:Plan;key:string;reading:ApiReading;controller:AbortController|null;flight:Promise<void>|null;nextAt:number;manualAt:number;fence:number;references:Set<ApiConsumer>};
type CopyChoice={source:ApiOwner;target:ApiOwner;slotId:string;revision:number;expiresAt:number};
const empty=(state:ApiReading['state'],failure?:DockApiFailure):ApiReading=>({state,updatedAt:null,values:{},...(failure?{failure}:{})});
const initialReading=(plan:Plan):ApiReading=>!plan.permitted?empty('needs-authorization'):!plan.configured?empty('needs-setup'):plan.grant?.suspension==='auth'?empty('needs-authorization',{code:'authorization'}):plan.grant?.suspension==='post'?empty('failed',{code:'unknown-result',sent:true}):empty('loading');
const safeFailure=(error:unknown,sent:boolean):DockApiFailure=>{
 const code=error instanceof Error?error.message:'';
 return{code:/PROXY_(?:AUTHENTICATION_)?REQUIRED/.test(code)?'proxy-required':/BUDGET|CAPACITY/.test(code)?'budget':/DEADLINE|TIMEOUT/.test(code)?'timeout':/MAPPING|JSON|ENCODING|INCOMPLETE/.test(code)?'mapping':/AUTHORIZATION|CREDENTIAL|GRANT/.test(code)?'authorization':'network',sent,...(error instanceof ApiTransportError&&error.status?{status:error.status}:{})};
};
export class DockApiData implements DockApiConsumer{
 private readonly state:ApiStateStore;
 private readonly scheduler=new ApiScheduler();
 private readonly consumers=new Set<ApiConsumer>();
 private readonly entries=new Map<string,Entry>();
 private readonly fences=new Map<string,number>();
 private readonly copyChoices=new Map<string,CopyChoice>();
 private readonly labels=new Map<string,string>();
 private readonly automaticBudgets=new Map<string,ApiRefreshBudget>();
 private readonly primary:ApiConsumer;
 private ready:Promise<void>|null=null;
 private closed=false;
 private timer:ReturnType<typeof setTimeout>|null=null;
 private readonly configurationRequests=new Map<string,string>();
 private readonly accountEpochs=new Map<string,number>();
 constructor(private readonly ports:ApiConsumerPorts&{userData:string;transport?:ApiTransport;active?():boolean;scope?():{accountId:string;installationId:string;libraryId?:string|null}}){
  this.state=new ApiStateStore(ports.userData,()=>this.changed());this.primary=this.createConsumer(ports)as ApiConsumer;
 }
 initialize(){if(!this.ready)this.ready=this.state.initialize().then(()=>{});return this.ready;}
 createConsumer(ports:ApiConsumerPorts):DockApiConsumer{
  if(this.closed)throw new Error('DOCK_API_CLOSED');const consumer=new ApiConsumer(this,ports);this.consumers.add(consumer);return consumer;
 }
 async validate(dock:DockContribution,widget:CustomDockWidget){
  const queries=dock.data.filter(value=>value.kind==='api');if(queries.length>B.apiDeclarationCount)throw new Error('DOCK_API_DECLARATION_BUDGET');
  for(const raw of queries){const query=dockApiRequirementSchema.parse(raw);buildApiRequest(query,widget.settings,null);}
 }
 setVisible(surface:string,sources:readonly WidgetDetailSource[]){this.primary.setVisible(surface,sources);}
 reading(itemId:string,requestId:string){return this.primary.reading(itemId,requestId);}
 refresh(itemId:string){return this.primary.refresh(itemId);}
 identity(source:WidgetDetailSource){return this.primary.identity(source);}
 rebindable(source:WidgetDetailSource,owner:ApiOwner=instanceApiOwner(source)):string[]{
  return apiRequirements(source).flatMap(query=>{
   const plan=this.plan(source,query,owner),grant=plan.grant;
   return grant&&!grant.revoked&&grant.scopeDigest===plan.scopeDigest&&grant.credentialRevision===plan.credentialRevision?[query.id]:[];
  });
 }
 private checkedOwner(source:WidgetDetailSource,owner:ApiOwner){
  if(!this.currentScope(source))throw new Error('DOCK_API_SCOPE_CHANGED');
  if(owner.accountId!==source.accepted.scope.accountId||owner.executionInstallationId!==source.accepted.scope.installationId||owner.definitionId!==source.accepted.widget.definition.definitionId)throw new Error('DOCK_API_OWNER_SCOPE');return owner;
 }
 currentScope(source:WidgetDetailSource){try{const scope=this.ports.scope?.();return!this.closed&&(!scope||scope.accountId===source.accepted.scope.accountId&&scope.installationId===source.accepted.scope.installationId&&(!('libraryId'in scope)||scope.libraryId===source.accepted.scope.libraryId));}catch{return false;}}
 canRead(){try{return!this.closed&&(!this.ports.active||this.ports.active()===true);}catch{return false;}}
 private ownerInScope(owner:ApiOwner){try{const scope=this.ports.scope?.();return!this.closed&&(!scope||scope.accountId===owner.accountId&&scope.installationId===owner.executionInstallationId);}catch{return false;}}
 private hostGuard(source:WidgetDetailSource,owner:ApiOwner){const epoch=this.accountEpochs.get(owner.accountId)??0;return()=>{this.checkedOwner(source,owner);if((this.accountEpochs.get(owner.accountId)??0)!==epoch)throw new Error('DOCK_API_SCOPE_CHANGED');};}
 plan(source:WidgetDetailSource,query:DockApiRequirement,owner:ApiOwner,fallbackOwner:ApiOwner=owner):Plan{
  this.checkedOwner(source,owner);this.checkedOwner(source,fallbackOwner);
  const ownSlots=this.state.slots(owner),authentication=query.authentication,credentialOwner=authentication.kind==='none'||ownSlots.some(slot=>slot.slotId===authentication.slot)?owner:fallbackOwner;
  const scopeDigest=digest(apiScope(query,source.accepted.widget.settings,source.accepted.scope.libraryId)),grant=this.state.grant(owner,query.id),slotIds=apiSlotIds(query);
  const credentialRevision=this.state.credentialRevision(credentialOwner,slotIds),configured=slotIds.every(id=>this.state.slots(credentialOwner).some(slot=>slot.slotId===id&&slot.set));
  const original=sameOwner(owner,credentialOwner)?null:this.state.grant(credentialOwner,query.id);
  const borrowed=sameOwner(owner,credentialOwner)||Boolean(original&&!original.revoked&&original.scopeDigest===scopeDigest&&original.credentialRevision===credentialRevision);
  const permitted=Boolean(grant&&!grant.revoked&&grant.scopeDigest===scopeDigest&&grant.packageRef===source.accepted.widget.definition.packageRef&&grant.credentialRevision===credentialRevision&&borrowed);
  return{source,query,owner,credentialOwner,grant,scopeDigest,credentialRevision,configured:configured&&borrowed,permitted,
   identity:digest({owner,credentialOwner,scope:source.accepted.scope,definition:source.accepted.widget.definition,request:query,scopeDigest,settings:source.accepted.widget.settings,mappingRevision:source.accepted.revision,grantRevision:grant?.revision??0,credentialRevision})};
 }
 review(source:WidgetDetailSource,owner:ApiOwner=instanceApiOwner(source),credentialOwner:ApiOwner=owner):ApiConnectionReview{
  this.checkedOwner(source,owner);this.labels.set(ownerKey(owner),source.item.label??source.manifest.name);
  const now=Date.now();for(const [id,choice]of this.copyChoices)if(choice.expiresAt<=now)this.copyChoices.delete(id);
  const choices:ApiConnectionReview['copyChoices'][number][]=[];
  for(const candidate of this.state.copyCandidates(owner)){
   if(sameOwner(candidate.owner,owner))continue;
   let existing=[...this.copyChoices].find(([,choice])=>sameOwner(choice.source,candidate.owner)&&sameOwner(choice.target,owner)&&choice.slotId===candidate.slotId&&choice.revision===candidate.revision);
   if(!existing&&this.copyChoices.size<256){const id=randomBytes(16).toString('hex'),choice:CopyChoice={source:candidate.owner,target:owner,slotId:candidate.slotId,revision:candidate.revision,expiresAt:now+10*60000};this.copyChoices.set(id,choice);existing=[id,choice];}
   if(existing)choices.push({id:existing[0],label:this.labels.get(ownerKey(candidate.owner))??candidate.owner.definitionId,slotId:candidate.slotId});
  }
  return{requests:apiRequirements(source).map(query=>{
   const plan=this.plan(source,query,owner,credentialOwner),wire=buildApiRequest(query,source.accepted.widget.settings,null),entry=this.entries.get(plan.identity);
   return{id:query.id,purpose:query.purpose,method:query.request.method,origin:wire.url.origin,path:wire.url.pathname,parameters:apiParameters(query,source.accepted.widget.settings),authorized:plan.permitted,configured:plan.configured,slot:query.authentication.kind==='none'?null:query.authentication.slot,authentication:query.authentication.kind,...(entry?.reading.failure?{failure:entry.reading.failure}:{})};
  }),copyChoices:choices};
 }
 async configure(source:WidgetDetailSource,input:ApiConfiguration,owner:ApiOwner=instanceApiOwner(source),credentialOwner:ApiOwner=owner){
  await this.initialize();this.assertOpen();this.checkedOwner(source,owner);this.checkedOwner(source,credentialOwner);const guard=this.hostGuard(source,owner);
  const request=digest({source:source.accepted.widget,owner,credentialOwner,input}),prior=this.configurationRequests.get(input.operationId);
  if(prior&&prior!==request)throw new Error('DOCK_API_OPERATION_CONFLICT');if(!prior&&this.configurationRequests.size>=256)this.configurationRequests.delete(this.configurationRequests.keys().next().value!);this.configurationRequests.set(input.operationId,request);
  const queries=apiRequirements(source),slots=new Set(queries.flatMap(apiSlotIds));
  if(new Set(input.consent).size!==input.consent.length||input.consent.some(id=>!queries.some(query=>query.id===id)))throw new Error('DOCK_API_DECLARATION_INVALID');
  for(const id of [...Object.keys(input.credentials??{}),...input.clearSlots??[]])if(!slots.has(id))throw new Error('DOCK_API_SLOT_UNDECLARED');
  for(const query of queries)buildApiRequest(query,source.accepted.widget.settings,null);
  this.invalidate(owner);
  for(const [slot,value]of Object.entries(input.credentials??{})){guard();await this.state.setCredential(owner,slot,value);guard();}
  for(const slot of input.clearSlots??[]){guard();await this.state.setCredential(owner,slot,null);guard();}
  for(const query of queries.filter(query=>input.consent.includes(query.id))){
   const plan=this.plan(source,query,owner,credentialOwner);
   guard();await this.state.approve({owner,requestId:query.id,scopeDigest:plan.scopeDigest,packageRef:source.accepted.widget.definition.packageRef,slotIds:apiSlotIds(query),credentialRevision:plan.credentialRevision});guard();
  }
  this.changed();return this.review(source,owner,credentialOwner);
 }
 async test(source:WidgetDetailSource,requestId:string,owner:ApiOwner=instanceApiOwner(source),credentialOwner:ApiOwner=owner){
  await this.initialize();this.checkedOwner(source,owner);const epoch=this.accountEpochs.get(owner.accountId)??0,query=apiRequirements(source).find(value=>value.id===requestId);if(!query)throw new Error('DOCK_API_DECLARATION_UNDECLARED');
  const consumer=this.createConsumer({source:id=>id===source.item.id?source:null,owner:()=>owner,credentialOwner:()=>credentialOwner,current:()=>this.currentScope(source)&&(this.accountEpochs.get(owner.accountId)??0)===epoch,changed:()=>{}})as ApiConsumer;
  try{consumer.presentOnce(source);await consumer.refreshQuery(source,query);return this.review(source,owner,credentialOwner);}finally{await consumer.close();}
 }
 async copySavedCredential(source:WidgetDetailSource,selectionId:string,targetSlotId:string,operationId:string,owner:ApiOwner=instanceApiOwner(source)){
  await this.initialize();this.checkedOwner(source,owner);const guard=this.hostGuard(source,owner),request=digest({selectionId,targetSlotId,owner}),operation='copy:'+operationId,previous=this.configurationRequests.get(operation);
  if(previous){if(previous!==request)throw new Error('DOCK_API_OPERATION_CONFLICT');return this.review(source,owner);}
  const choice=this.copyChoices.get(selectionId),slot=this.state.slots(choice?.source??owner).find(item=>item.slotId===choice?.slotId);
  if(!choice||choice.expiresAt<=Date.now()||!sameOwner(choice.target,owner)||slot?.revision!==choice.revision||!slot.set||!apiRequirements(source).some(query=>apiSlotIds(query).includes(targetSlotId)))throw new Error('DOCK_API_CREDENTIAL_COPY_SCOPE');
  this.invalidate(owner);guard();await this.state.copyCredential(choice.source,owner,choice.slotId,targetSlotId);guard();this.copyChoices.delete(selectionId);if(this.configurationRequests.size>=256)this.configurationRequests.delete(this.configurationRequests.keys().next().value!);this.configurationRequests.set(operation,request);this.changed();
  return this.review(source,owner);
 }
 async prepareAssociation(input:ApiAssociation){
  await this.initialize();this.checkedOwner(input.source,input.draftOwner);this.checkedOwner(input.source,input.targetOwner);
  const selected=apiRequirements(input.source).filter(query=>input.requestIds.includes(query.id));
  if(selected.length!==input.requestIds.length)throw new Error('DOCK_API_DECLARATION_UNDECLARED');
  const approvals=selected.map(query=>{const plan=this.plan(input.source,query,input.draftOwner,input.targetOwner);return{owner:input.targetOwner,requestId:query.id,scopeDigest:plan.scopeDigest,packageRef:input.source.accepted.widget.definition.packageRef,slotIds:apiSlotIds(query),credentialRevision:plan.credentialRevision};});
  await this.state.prepareAssociation({operationId:input.operationId,draft:input.draftOwner,target:input.targetOwner,identity:digest({definition:input.source.accepted.widget.definition,settings:input.source.accepted.widget.settings,requestIds:input.requestIds}),approvals});
 }
 async commitAssociation(operationId:string){await this.initialize();await this.state.commitAssociation(operationId,owner=>this.ownerInScope(owner));this.changed();}
 async acknowledgeAssociation(operationId:string){await this.initialize();await this.state.acknowledgeAssociation(operationId);}
 async revoke(owner:ApiOwner,requestId?:string){await this.initialize();this.invalidate(owner,requestId);await this.state.revoke(owner,requestId);this.changed();}
 async removeOwner(owner:ApiOwner,keepCredentials=false){await this.initialize();this.invalidate(owner);await this.state.removeOwner(owner,keepCredentials);this.changed();}
 discardDraft(owner:ApiOwner){if(owner.ownerKind!=='authoring-draft')return Promise.reject(new Error('DOCK_API_OWNER_SCOPE'));return this.removeOwner(owner);}
 async clearAccount(accountId:string){this.accountEpochs.set(accountId,(this.accountEpochs.get(accountId)??0)+1);await this.initialize();for(const entry of this.entries.values())if(entry.plan.owner.accountId===accountId)this.invalidate(entry.plan.owner);await this.state.clearAccount(accountId);for(const [id,choice]of this.copyChoices)if(choice.source.accountId===accountId)this.copyChoices.delete(id);this.changed();}
 async pruneInstances(scope:{accountId:string;installationId:string},retainedItemIds:readonly string[]){await this.initialize();const retained=new Set(retainedItemIds);for(const owner of this.state.owners(true))if(owner.accountId===scope.accountId&&owner.executionInstallationId===scope.installationId&&owner.ownerKind==='instance'&&!retained.has(owner.ownerId))await this.removeOwner(owner);}
 async retireDefinition(scope:{accountId:string;installationId:string},definitionId:string,keepCredentials=false){await this.initialize();for(const owner of this.state.owners())if(owner.accountId===scope.accountId&&owner.executionInstallationId===scope.installationId&&owner.definitionId===definitionId)await this.removeOwner(owner,keepCredentials);}
 private invalidate(owner:ApiOwner,requestId?:string){
  const key=ownerKey(owner);this.fences.set(key,(this.fences.get(key)??0)+1);
  for(const entry of this.entries.values())if((sameOwner(entry.plan.owner,owner)||sameOwner(entry.plan.credentialOwner,owner))&&(!requestId||entry.plan.query.id===requestId)){entry.controller?.abort();entry.reading=empty('needs-authorization');entry.nextAt=Infinity;}
 }
 reconcile(){
  if(this.closed)return;
  for(const entry of this.entries.values())entry.references.clear();
  for(const consumer of this.consumers)for(const source of consumer.sources())for(const query of apiRequirements(source)){
   let plan:Plan;try{plan=this.plan(source,query,consumer.owner(source),consumer.credentialOwner(source));}catch{continue;}
   let entry=this.entries.get(plan.identity);
   if(!entry){
    if(this.entries.size>=B.cacheEntries)for(const [key,cached]of this.entries)if(!cached.references.size&&!cached.flight){this.entries.delete(key);if(this.entries.size<B.cacheEntries)break;}
    if(this.entries.size>=B.cacheEntries)continue;
    entry={plan,key:plan.identity,reading:initialReading(plan),controller:null,flight:null,nextAt:0,manualAt:0,fence:this.fences.get(ownerKey(plan.owner))??0,references:new Set()};this.entries.set(plan.identity,entry);
   }else{
    entry.plan=plan;
    if(!entry.flight&&entry.fence!==(this.fences.get(ownerKey(plan.owner))??0)){
     entry.fence=this.fences.get(ownerKey(plan.owner))??0;entry.nextAt=0;entry.reading=initialReading(plan);
    }
   }
   entry.references.add(consumer);
   if(!consumer.once&&source.manifest.dock.refresh.mode!=='manual'&&plan.permitted&&plan.configured&&!plan.grant?.suspension&&!entry.flight&&Date.now()>=entry.nextAt&&Date.now()>=(plan.grant?.notBefore??0)){
    const key=ownerKey(plan.owner);let budget=this.automaticBudgets.get(key);
    if(!budget){budget={attempts:0,headerBytes:0,responseBytes:0,deadline:performance.now()+B.apiDeadlineMs};this.automaticBudgets.set(key,budget);}
    void this.start(entry,false,budget);
   }
  }
  for(const entry of this.entries.values())if(!entry.references.size)entry.controller?.abort();this.arm();
 }
 lookup(source:WidgetDetailSource,query:DockApiRequirement,owner:ApiOwner,credentialOwner:ApiOwner):ApiReading{
  try{const plan=this.plan(source,query,owner,credentialOwner);if(!plan.permitted)return empty('needs-authorization');if(!plan.configured)return empty('needs-setup');return this.entries.get(plan.identity)?.reading??(this.entries.size>=B.cacheEntries?empty('failed',{code:'budget'}):empty('loading'));}catch{return empty('needs-setup');}
 }
 sourceIdentity(source:WidgetDetailSource,owner:ApiOwner,credentialOwner:ApiOwner){try{return digest(apiRequirements(source).map(query=>this.plan(source,query,owner,credentialOwner).identity));}catch{return'unconfigured';}}
 async manual(consumer:ApiConsumer,source:WidgetDetailSource,query:DockApiRequirement,budget?:ApiRefreshBudget){
  await this.initialize();this.reconcile();const plan=this.plan(source,query,consumer.owner(source),consumer.credentialOwner(source)),entry=this.entries.get(plan.identity);
  if(!entry||!entry.references.has(consumer)||!plan.permitted||!plan.configured)throw new Error('DOCK_API_AUTHORIZATION_REQUIRED');
  if(Date.now()<(plan.grant?.notBefore??0)){entry.reading={...entry.reading,failure:{code:'http',status:429,retryAt:plan.grant!.notBefore}};this.changed();return;}
  if(entry.flight)return entry.flight;if(Date.now()-entry.manualAt<1000)return;entry.manualAt=Date.now();return this.start(entry,true,budget);
 }
 private live(entry:Entry){
  if(this.closed||entry.controller?.signal.aborted||(this.fences.get(ownerKey(entry.plan.owner))??0)!==entry.fence)return false;
  try{return[...entry.references].some(consumer=>consumer.current(entry.plan.source))&&this.plan(entry.plan.source,entry.plan.query,entry.plan.owner,entry.plan.credentialOwner).identity===entry.key;}catch{return false;}
 }
 private start(entry:Entry,manual:boolean,budget:ApiRefreshBudget={attempts:0,headerBytes:0,responseBytes:0,deadline:performance.now()+B.apiDeadlineMs}):Promise<void>{
  if(entry.flight)return entry.flight;if(!this.live(entry)||!entry.plan.permitted||!entry.plan.configured||!manual&&entry.plan.grant?.suspension)return Promise.resolve();
  const controller=new AbortController();entry.controller=controller;const {plan}=entry,grant=plan.grant!;
  const task=Promise.resolve().then(async()=>{
   let sent=false;
   try{
    if(plan.query.request.method==='POST')await this.state.transition(plan.owner,plan.query.id,grant.revision,{suspension:'post'});
    if(!this.live(entry))return;
    const secret=plan.query.authentication.kind==='none'?null:this.state.material(plan.credentialOwner,plan.query.authentication.slot);
    if(plan.query.authentication.kind!=='none'&&secret===null)throw new Error('DOCK_API_CREDENTIAL_REQUIRED');
    let wire=buildApiRequest(plan.query,plan.source.accepted.widget.settings,secret),response:Awaited<ReturnType<ApiTransport>>|null=null,redirects=0,retries=0;
    while(true){
     if(!this.live(entry))return;
     try{
      response=await this.scheduler.schedule({owner:ownerKey(plan.owner),origin:wire.url.origin,signal:controller.signal,deadline:budget.deadline},async()=>{if(!this.live(entry))throw new Error('DOCK_API_CANCELLED');sent=true;return(this.ports.transport??directApiRequest)(wire,budget,controller.signal);});
     }catch(error){
      const code=error instanceof ApiTransportError?error.networkCode:undefined,message=error instanceof Error?error.message:'';
      const transient=code?['ECONNRESET','ETIMEDOUT','EAI_AGAIN'].includes(code):/(?:^|[^A-Z0-9])(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN)(?:$|[^A-Z0-9])|^socket hang up$/.test(message);
      if(plan.query.request.method!=='POST'&&transient&&retries++<B.apiRetryCount&&this.live(entry)&&performance.now()+B.apiRetryWindowMs<budget.deadline){await this.wait(B.apiRetryWindowMs,controller.signal);continue;}
      throw error;
     }
     if(!this.live(entry))return;
     if([301,302,303,307,308].includes(response.status)){
      if(plan.query.request.method==='POST'||!response.headers.location||++redirects>B.apiRedirectCount)throw new Error('DOCK_API_REDIRECT_FORBIDDEN');
      const destination=apiRedirect(plan.query,wire.url,response.headers.location);wire=buildApiRequest(plan.query,plan.source.accepted.widget.settings,secret,destination);continue;
     }
     if(response.status===429){
      const raw=response.headers.retryAfter,seconds=raw&&/^\d+$/.test(raw)?Number(raw):null,date=raw&&seconds===null?Date.parse(raw):NaN;
      const proposed=seconds!==null&&Number.isFinite(seconds)?Date.now()+seconds*1000:Number.isFinite(date)?date:Date.now()+plan.query.refreshIntervalMs;
      const retryAt=Number.isFinite(proposed)?Math.max(Date.now(),proposed):Number.MAX_SAFE_INTEGER;
      await this.state.transition(plan.owner,plan.query.id,grant.revision,{notBefore:retryAt});
      entry.reading={...entry.reading,state:entry.reading.updatedAt===null?'failed':'stale',failure:{code:'http',status:429,retryAt}};
      const waiting=Math.max(0,retryAt-Date.now());
      if(plan.query.request.method!=='POST'&&retries++<B.apiRetryCount&&waiting<=B.apiRetryWindowMs&&performance.now()+waiting<budget.deadline){await this.wait(waiting,controller.signal);continue;}
      entry.nextAt=Infinity;return;
     }
     if(response.status>=500&&plan.query.request.method!=='POST'&&retries++<B.apiRetryCount&&performance.now()+B.apiRetryWindowMs<budget.deadline){await this.wait(B.apiRetryWindowMs,controller.signal);continue;}
     break;
    }
    if(!response)return;
    if(response.status===401||response.status===403){
     await this.state.transition(plan.owner,plan.query.id,grant.revision,{suspension:'auth'});this.clearRequest(plan.owner,plan.query.id);
     entry.reading=empty('needs-authorization',{code:'authorization',status:response.status});entry.nextAt=Infinity;return;
    }
    if(response.status<200||response.status>=300){entry.reading={...entry.reading,state:entry.reading.updatedAt===null?'failed':'stale',failure:{code:'http',status:response.status,sent}};entry.nextAt=Date.now()+plan.query.refreshIntervalMs;return;}
    if(response.status===206){entry.reading=empty('partial',{code:'mapping',status:206});entry.nextAt=Date.now()+plan.query.refreshIntervalMs;return;}
    const reading=projectApiResponse(plan.query,response,Date.now(),secret?[secret]:[]);
    if(!this.live(entry))return;entry.reading=reading;entry.nextAt=Date.now()+plan.query.refreshIntervalMs;
    await this.state.transition(plan.owner,plan.query.id,grant.revision,{suspension:null,notBefore:0});
   }catch(error){
    if(!this.live(entry)||controller.signal.aborted)return;if(error instanceof ApiTransportError)sent=error.sent;const failure=safeFailure(error,sent);
    entry.reading={...entry.reading,state:entry.reading.updatedAt===null?'failed':'stale',failure:plan.query.request.method==='POST'&&sent?{...failure,code:'unknown-result',sent:true}:failure};entry.nextAt=Date.now()+plan.query.refreshIntervalMs;
   }finally{
    if(entry.controller===controller)entry.controller=null;if(entry.flight===task)entry.flight=null;
    if(![...this.entries.values()].some(value=>value.flight&&sameOwner(value.plan.owner,plan.owner)))this.automaticBudgets.delete(ownerKey(plan.owner));
    if(!this.closed){this.arm();this.changed();}
   }
  });entry.flight=task;return task;
 }
 private clearRequest(owner:ApiOwner,requestId:string){for(const entry of this.entries.values())if(sameOwner(entry.plan.owner,owner)&&entry.plan.query.id===requestId)entry.reading=empty('needs-authorization');}
 private wait(milliseconds:number,signal:AbortSignal){return new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(new Error('DOCK_API_CANCELLED'));};const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve();},milliseconds);timer.unref?.();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});}
 private arm(){
  if(this.timer){clearTimeout(this.timer);this.timer=null;}if(this.closed)return;
  const now=Date.now(),next=[...this.entries.values()].filter(entry=>entry.references.size&&!entry.flight&&Number.isFinite(entry.nextAt)&&entry.plan.permitted&&entry.plan.configured&&entry.plan.source.manifest.dock.refresh.mode!=='manual'&&![...entry.references].every(consumer=>consumer.once)&&!this.state.grant(entry.plan.owner,entry.plan.query.id)?.suspension).map(entry=>Math.max(entry.nextAt,entry.plan.grant?.notBefore??0));
  if(!next.length)return;
  this.timer=setTimeout(()=>{this.timer=null;this.reconcile();},Math.min(2147483647,Math.max(100,Math.min(...next)-now)));this.timer.unref?.();
 }
 changed(){if(this.closed)return;for(const consumer of this.consumers)consumer.notify();}
 release(consumer:ApiConsumer){this.consumers.delete(consumer);this.reconcile();}
 health():ApiHealth{return{consumers:[...this.consumers].reduce((count,consumer)=>count+consumer.demandCount(),0),flights:[...this.entries.values()].filter(entry=>entry.flight).length,queued:this.scheduler.health().queued,timers:Number(this.timer!==null),entries:this.entries.size};}
 private assertOpen(){if(this.closed)throw new Error('DOCK_API_CLOSED');}
 async close(){if(this.closed)return;this.closed=true;if(this.timer)clearTimeout(this.timer);this.timer=null;for(const consumer of [...this.consumers])await consumer.close();for(const entry of this.entries.values())entry.controller?.abort();this.scheduler.close();await Promise.allSettled([...this.entries.values()].flatMap(entry=>entry.flight?[entry.flight]:[]));this.entries.clear();this.copyChoices.clear();this.labels.clear();await this.state.close();}
}

class ApiConsumer implements DockApiConsumer{
 private readonly surfaces=new Map<string,readonly WidgetDetailSource[]>();
 private closed=false;
 once=false;
 constructor(private readonly broker:DockApiData,private readonly ports:ApiConsumerPorts){}
 owner(source:WidgetDetailSource){return this.ports.owner?.(source)??instanceApiOwner(source);}
 credentialOwner(source:WidgetDetailSource){return this.ports.credentialOwner?.(source)??this.owner(source);}
 current(source:WidgetDetailSource){if(this.closed||!this.broker.canRead()||!this.broker.currentScope(source))return false;try{if(this.ports.current)return this.ports.current(source);const current=this.ports.source(source.item.id);return Boolean(current&&current.accepted.revision===source.accepted.revision&&digest(current.accepted.widget)===digest(source.accepted.widget));}catch{return false;}}
 sources(){return[...new Map([...this.surfaces.values()].flat().filter(source=>this.current(source)).map(source=>[source.item.id,source])).values()];}
 demandCount(){return[...this.surfaces.values()].reduce((count,sources)=>count+sources.filter(source=>this.current(source)).length,0);}
 notify(){if(!this.closed)this.ports.changed();}
 validate(dock:DockContribution,widget:CustomDockWidget){return this.broker.validate(dock,widget);}
 setVisible(surface:string,sources:readonly WidgetDetailSource[]){if(this.closed)return;this.surfaces.set(surface,sources.filter(source=>apiRequirements(source).length>0));void this.broker.initialize().then(()=>{if(!this.closed)this.broker.reconcile();}).catch(()=>this.notify());}
 presentOnce(source:WidgetDetailSource){this.once=true;this.surfaces.set('host-test',[source]);this.broker.reconcile();}
 reading(itemId:string,requestId:string){if(!this.broker.canRead())return empty('paused');const source=this.ports.source(itemId),query=source&&apiRequirements(source).find(value=>value.id===requestId);return source&&query&&this.current(source)?this.broker.lookup(source,query,this.owner(source),this.credentialOwner(source)):empty('needs-setup');}
 async refresh(itemId:string){const source=this.sources().find(value=>value.item.id===itemId);if(!source)throw new Error('DOCK_API_NOT_VISIBLE');const budget:ApiRefreshBudget={attempts:0,headerBytes:0,responseBytes:0,deadline:performance.now()+B.apiDeadlineMs};for(const query of apiRequirements(source))await this.broker.manual(this,source,query,budget);}
 refreshQuery(source:WidgetDetailSource,query:DockApiRequirement){return this.broker.manual(this,source,query);}
 identity(source:WidgetDetailSource){return this.broker.sourceIdentity(source,this.owner(source),this.credentialOwner(source));}
 health(){return{...this.broker.health(),consumers:this.demandCount()};}
 async close(){if(this.closed)return;this.closed=true;this.surfaces.clear();this.broker.release(this);}
}
