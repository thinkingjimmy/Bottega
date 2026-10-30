/**
 * [INPUT]: Depends on the shared immutable compiler/seal, Surface file-tree digest, durable file publication, source inventory, catalog admission, source provenance and host authorization.
 * [OUTPUT]: Provides capacity-admitted authored sources, manual Dock candidates, automatic composer activation, account-scoped durable delivery retention and cleanup, rollback/forward and strict-current composer delivery with bounded session pins.
 * [POS]: Plugin surface lifecycle owner; reuses App compiler artifacts without App records, Base grants or host-package execution.
 */
import {assertPluginIdentity} from "./identity";
import { randomUUID } from "node:crypto";
import { REMOTE_PLUGIN_CATALOG_LIMITS } from "@ai-chat/cloud-protocol/surfaces/plugin/catalog";
import { appSurfaceTreeDigest } from "@ai-chat/cloud-protocol/surfaces/manifest";
import { readFile, realpath, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { runtimeFileSchema, generationCustodyScopeSchema, type GenerationCustodyScope, type PluginRuntimeRecord, type PluginGeneration, type PluginRuntimeOptions } from "./model";
import { pluginGuiManifestSchema } from "../../apps/gui-build/source/manifest";
import { inspectPluginSource } from "../../apps/gui-build/source/inspection";
import { verifyCompiledV3Artifact } from "../../apps/gui-build/pipeline/seal";
import { durableReplaceFile } from "../../persistence/durable-json";
import { packageDigest } from "../../apps/share/package/package-contract";
import { sha256, canonicalJson } from "../../apps/support";
import { artifactBytes, collectUnreferenced, collectUnknownPlugins } from "./retention";

export class PluginSurfaceRuntime {
  private records = new Map<string,PluginRuntimeRecord>();
  private quarantined:PluginRuntimeRecord[] = [];
  private readonly pins=new Map<string,{pluginId:string;generationId:string;expiresAt:number;timer:ReturnType<typeof setTimeout>}>();
  private tail:Promise<unknown> = Promise.resolve();
  private timer:ReturnType<typeof setInterval>|null = null;
  private polling = false;
  private stopped = true;
  private readonly listeners = new Set<(pluginId:string)=>void>();
  private readonly observed = new Map<string,string>();
  private readonly root:string;
  private readonly file:string;
  constructor(userData:string,private readonly options:PluginRuntimeOptions) {
    this.root=join(userData,"plugin-surface-generations");this.file=join(userData,"plugin-surfaces.json");
  }
  async initialize() {
    if(!this.stopped) throw new Error("Plugin runtime is already initialized");
    const bytes = await readFile(this.file,"utf8").catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
    const state = bytes === null ? {plugins:[],quarantined:[]} : runtimeFileSchema.parse(JSON.parse(bytes));
    this.quarantined=state.quarantined;
    this.records=new Map();
    for(const record of state.plugins){
      try{await assertPluginIdentity(record,this.options);this.records.set(record.pluginId,record);}
      catch(cause){this.quarantined.push({...record,enabled:false,error:this.reason(cause)});}
    }
    for(const record of this.records.values()) {
      const current = this.active(record);
      if(current) {
        this.options.admit?.(current.manifest);
        try {await this.verify(record.pluginId,current);} catch(cause) {record.enabled=false;record.error=this.reason(cause);}
      }
      try {this.observed.set(record.pluginId,await this.fingerprint(record.sourceRoot));} catch { /* Missing source never destroys sealed history. */ }
    }
    await this.persist(this.records);
    await collectUnknownPlugins(this.root,new Set([...this.records.keys(),...this.quarantined.map(record=>record.pluginId)])).catch(()=>undefined);
    for(const record of this.records.values())await this.collect(record.pluginId).catch(()=>undefined);
    this.stopped=false;
    if((this.options.watchIntervalMs??700)>0) {this.timer=setInterval(()=>{void this.poll();},this.options.watchIntervalMs??700);this.timer.unref?.();}
  }
  list() {return structuredClone([...this.records.values()]);}
  descriptor(pluginId:string) {const value=this.records.get(pluginId);return value?structuredClone(value):null;}
  findByChat(chatId:string) {return this.list().find(record=>record.ownerChatId===chatId)??null;}
  history(pluginId:string) {return structuredClone(this.require(pluginId).generations).sort((a,b)=>b.createdAt-a.createdAt);}
  onChanged(listener:(pluginId:string)=>void) {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
  watch(listener:(pluginId:string)=>void) {return this.onChanged(listener);}
  artifactRoot(pluginId:string,generationId:string) {
    if(!/^[a-z][a-z0-9.-]{0,119}$/.test(pluginId)||!/^plugin-[a-f0-9-]{36}$/.test(generationId))throw new Error("Invalid plugin artifact identity");
    return join(this.root,pluginId,generationId);
  }
  installLocal(sourceRoot:string,input:{ownerChatId:string;expectedActiveGenerationId?:string|null;signal?:AbortSignal}) {
    return this.install(sourceRoot,input,"local");
  }
  registerDockSource(sourceRoot:string,ownerChatId:string){
    return this.enqueue(async()=>{
      const canonical=await realpath(sourceRoot);await inspectPluginSource(canonical);const manifest=await this.manifest(canonical);
      if(!('dock' in manifest))throw new Error('Dock source declaration required');
      await assertPluginIdentity({pluginId:manifest.id,sourceRoot:canonical,origin:'local'},this.options);
      const existing=this.records.get(manifest.id);
      if(existing){if(existing.sourceRoot!==canonical||existing.ownerChatId!==ownerChatId)throw new Error('Plugin source ownership changed');return this.descriptor(manifest.id)!;}
      if(this.records.size>=REMOTE_PLUGIN_CATALOG_LIMITS.entries)throw new Error('Plugin catalog capacity exceeded');
      if([...this.records.values()].some(record=>record.ownerChatId===ownerChatId))throw new Error('Chat already owns another plugin source');
      if(!ownerChatId.trim()||ownerChatId.length>160)throw new Error('Invalid source Chat');
      const record:PluginRuntimeRecord={pluginId:manifest.id,origin:'local',ownerChatId,sourceRoot:canonical,enabled:true,authoringManifest:manifest,
        activeGenerationId:null,candidateGenerationId:null,previousGenerationId:null,generations:[],retentionPins:[],lastActivation:null,error:null,revision:0};
      this.observed.set(record.pluginId,await this.fingerprint(canonical));await this.commit(record);return this.descriptor(record.pluginId)!;
    });
  }
  async dockPreview(pluginId:string){
    const record=this.require(pluginId),generation=record.generations.find(value=>value.generationId===record.candidateGenerationId&&value.available);
    if(!generation||!('dock' in generation.manifest))throw new Error('DOCK_PREVIEW_UNAVAILABLE');
    await assertPluginIdentity(record,this.options);await this.verify(pluginId,generation);
    const sourceFingerprint=await this.fingerprint(join(this.artifactRoot(pluginId,generation.generationId),'source'));
    if(await this.fingerprint(record.sourceRoot)!==sourceFingerprint||this.require(pluginId).candidateGenerationId!==generation.generationId)throw new Error('DOCK_PREVIEW_CONFLICT');
    return{id:pluginId,generationId:generation.generationId,sourceFingerprint,name:generation.manifest.name,dock:structuredClone(generation.manifest.dock)};
  }
  async dockVersion(pluginId:string,generationId:string){
    const record=this.require(pluginId),generation=record.generations.find(value=>value.generationId===generationId&&value.available);
    if(!generation||!('dock'in generation.manifest))throw new Error('DOCK_VERSION_UNAVAILABLE');
    await assertPluginIdentity(record,this.options);await this.verify(pluginId,generation);
    return{id:pluginId,generationId,sourceFingerprint:await this.fingerprint(join(this.artifactRoot(pluginId,generationId),'source')),name:generation.manifest.name,dock:structuredClone(generation.manifest.dock)};
  }
  /** Main-only seed entry. Agent/IPC authoring only receives installLocal. */
  installOfficial(sourceRoot:string,input:{ownerChatId:string;signal?:AbortSignal}) {
    return this.install(sourceRoot,input,"official");
  }
  private install(sourceRoot:string,input:{ownerChatId:string;expectedActiveGenerationId?:string|null;signal?:AbortSignal},origin:PluginRuntimeRecord["origin"]) {
    return this.enqueue(async()=>{
      const canonical=await realpath(sourceRoot);
      await inspectPluginSource(canonical);
      const manifest=await this.manifest(canonical);
      await assertPluginIdentity({pluginId:manifest.id,sourceRoot:canonical,origin},this.options);
      const existing=this.records.get(manifest.id);
      if([...this.records.values()].some(item=>item.ownerChatId===input.ownerChatId&&item.pluginId!==manifest.id))throw new Error("Chat already owns another plugin source");
      if(existing && existing.ownerChatId!==input.ownerChatId) throw new Error("Plugin belongs to another Chat");
      if(existing && existing.sourceRoot!==canonical) throw new Error("Plugin already has a different source directory");
      if(!input.ownerChatId.trim()||input.ownerChatId.length>160)throw new Error("Invalid plugin source Chat");
      if(input.expectedActiveGenerationId!==undefined && (existing?.activeGenerationId??null)!==input.expectedActiveGenerationId)throw new Error("Active plugin generation changed");
      const record:PluginRuntimeRecord=existing??{pluginId:manifest.id,origin,ownerChatId:input.ownerChatId,sourceRoot:canonical,enabled:true,authoringManifest:null,activeGenerationId:null,candidateGenerationId:null,previousGenerationId:null,generations:[],retentionPins:[],lastActivation:null,error:null,revision:0};
      return this.build(record,"install",input.signal);
    });
  }
  rebuild(pluginId:string,input:{expectedActiveGenerationId?:string|null;signal?:AbortSignal}={}) {
    return this.enqueue(async()=>{
      const record=this.require(pluginId);
      if(input.expectedActiveGenerationId!==undefined&&record.activeGenerationId!==input.expectedActiveGenerationId)throw new Error("Active plugin generation changed");
      return this.build(record,"rebuild",input.signal);
    });
  }
  activate(pluginId:string,generationId:string,input:{expectedActiveGenerationId:string|null;expectedSourceFingerprint?:string;operationId?:string;signal?:AbortSignal}) {
    return this.enqueue(async()=>{
      const record=this.require(pluginId);
      if(input.operationId!==undefined&&!/^[A-Za-z0-9_-]{8,128}$/.test(input.operationId))throw new Error('Invalid activation operation identity');
      if(record.activeGenerationId!==input.expectedActiveGenerationId)throw new Error("Active plugin generation changed");
      const target=record.generations.find(item=>item.generationId===generationId&&item.available);
      if(!target)throw new Error("Plugin generation is no longer available");
      input.signal?.throwIfAborted();
      await assertPluginIdentity(record,this.options);
      this.options.admit?.(target.manifest);
      await this.verify(pluginId,target);
      await this.authorize(record,target,"activate");
      input.signal?.throwIfAborted();
      if(input.expectedSourceFingerprint!==undefined){
        if(!('dock' in target.manifest)||record.candidateGenerationId!==generationId||await this.fingerprint(record.sourceRoot)!==input.expectedSourceFingerprint)throw new Error('DOCK_PREVIEW_CONFLICT');
      }
      const next={...record,activeGenerationId:generationId,previousGenerationId:record.activeGenerationId===generationId?record.previousGenerationId:record.activeGenerationId,
        lastActivation:input.operationId?{operationId:input.operationId,generationId,expectedPrevious:input.expectedActiveGenerationId}:null,error:null,revision:record.revision+1};
      await this.commit(next);
      return this.descriptor(pluginId)!;
    });
  }
  bindAuthoringChat(pluginId:string,chatId:string,expectedOwnerChatId:string) {
    return this.enqueue(async()=>{const record=this.require(pluginId);
      await assertPluginIdentity(record,this.options);
      if(record.ownerChatId!==expectedOwnerChatId)throw new Error("Plugin source Chat changed");
      if([...this.records.values()].some(item=>item.ownerChatId===chatId&&item.pluginId!==pluginId))throw new Error("Chat already owns another plugin source");
      if(!chatId.trim()||chatId.length>160)throw new Error("Invalid plugin source Chat");
      await this.commit({...record,ownerChatId:chatId,revision:record.revision+1});return this.descriptor(pluginId)!;
    });
  }
  setEnabled(pluginId:string,enabled:boolean) {
    return this.enqueue(async()=>{
      const record=this.require(pluginId),current=this.active(record);
      await assertPluginIdentity(record,this.options);
      if(enabled&&current){await this.verify(pluginId,current);await this.authorize(record,current,"activate");}
      await this.commit({...record,enabled,revision:record.revision+1});return this.descriptor(pluginId)!;
    });
  }
  async intent(pluginId:string) {
    const record=this.records.get(pluginId),generation=record&&this.active(record);
    if(!record?.enabled||!generation)return {kind:"none" as const};
    await this.assertServing(pluginId,generation.generationId);
    return this.delivery(pluginId,generation,()=>this.assertServing(pluginId,generation.generationId));
  }
  /** Acquisition can only pin the currently authorized generation, never a caller-selected historical id. */
  pinIntent(pluginId:string,expiresAt:number) {
    return this.enqueue(async()=>{
      this.purgePins();
      if(this.pins.size>=16||!Number.isFinite(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+30*60_000)throw new Error("Plugin surface pin budget exceeded");
      const record=this.require(pluginId),generation=this.active(record);
      if(!record.enabled||!generation)throw new Error("Plugin generation is unavailable");
      await this.authorize(record,generation,"serve");
      const id=randomUUID(),release=()=>this.releasePin(id);
      const timer=setTimeout(release,Math.max(0,expiresAt-Date.now()));timer.unref?.();
      this.pins.set(id,{pluginId,generationId:generation.generationId,expiresAt,timer});
      const available=()=>{
        const pin=this.pins.get(id),current=this.records.get(pluginId);
        if(this.stopped||!pin||pin.expiresAt<=Date.now()||!current?.enabled||!current.generations.some(item=>item.generationId===generation.generationId&&item.available)){release();return false;}
        return true;
      };
      const validate=async()=>{
        try{
          for(;;){
            if(!available())throw new Error("Plugin surface pin is unavailable");
            const current=this.require(pluginId);await this.authorize(current,generation,"serve");
            if(!available())throw new Error("Plugin surface pin is unavailable");
            if(this.records.get(pluginId)===current)return;
            // Ordinary activation and GC replace records. Recheck current grants without blocking behind compilation.
          }
        }catch(cause){release();throw cause;}
      };
      try{await validate();return {intent:this.delivery(pluginId,generation,validate,release),available,validate,release};}catch(cause){release();throw cause;}
    });
  }
  private delivery(pluginId:string,generation:PluginGeneration,validate:()=>Promise<void>,failed?:()=>void) {
    if('dock' in generation.manifest)throw new Error('Dock generations require a Dock-scoped Surface');
    const root=join(this.artifactRoot(pluginId,generation.generationId),"runtime/gui");
    // Surface identity covers only delivered GUI files; contentDigest also covers private authoring source.
    return {kind:"compiled" as const,generationId:generation.generationId,artifactDigest:appSurfaceTreeDigest(generation.files),
      files:generation.files.map(file=>({...file,mime:MIME[extname(file.path)]??"application/octet-stream",read:async()=>{
        try{
          await validate();const bytes=await readFile(join(root,file.path));
          if(bytes.byteLength!==file.bytes||sha256(bytes)!==file.sha256)throw new Error("Plugin artifact integrity changed");
          await validate();return bytes;
        }catch(cause){failed?.();throw cause;}
      }})),sdkSlice:{data:false,preferences:false,workspace:false},grantedCapabilities:[],hostActions:[],
      plugin:{operations:generation.manifest.operations,sourceFormat:generation.manifest.sourceFormat}};
  }
  private releasePin(id:string) {
    const pin=this.pins.get(id);if(!pin)return;
    this.pins.delete(id);clearTimeout(pin.timer);
    if(!this.stopped)void this.enqueue(()=>this.collect(pin.pluginId)).catch(()=>undefined);
  }
  private purgePins(){for(const [id,pin]of this.pins)if(pin.expiresAt<=Date.now())this.releasePin(id);}
  private protectedGenerations(record:PluginRuntimeRecord){
    this.purgePins();return new Set([record.activeGenerationId,record.candidateGenerationId,record.previousGenerationId,...record.retentionPins.map(pin=>pin.generationId),...[...this.pins.values()].filter(pin=>pin.pluginId===record.pluginId).map(pin=>pin.generationId)]);
  }
  /** Persistent custody only. This does not authorize a Surface, data read or activation. */
  retainGeneration(pluginId:string,generationId:string,id:string,scope?:GenerationCustodyScope){
    return this.enqueue(async()=>{
      if(scope)scope=generationCustodyScopeSchema.parse(scope);
      if(!/^[A-Za-z0-9_-]{8,128}$/.test(id))throw new Error('Invalid generation retention identity');
      const record=this.require(pluginId),existing=record.retentionPins.find(pin=>pin.id===id);
      if(existing){if(existing.generationId!==generationId||canonicalJson(existing.scope??null)!==canonicalJson(scope??null))throw new Error('Generation retention identity changed');return;}
      const generation=record.generations.find(value=>value.generationId===generationId&&value.available);
      if(!generation)throw new Error('Retained generation is unavailable');
      if(record.retentionPins.length>=128)throw new Error('Generation retention capacity exceeded');
      await assertPluginIdentity(record,this.options);await this.verify(pluginId,generation);
      await this.commit({...record,retentionPins:[...record.retentionPins,{id,generationId,...(scope?{scope}: {})}],revision:record.revision+1});
    });
  }
  releaseGeneration(pluginId:string,id:string){
    return this.enqueue(async()=>{const record=this.require(pluginId);if(!record.retentionPins.some(pin=>pin.id===id))return;
      await this.commit({...record,retentionPins:record.retentionPins.filter(pin=>pin.id!==id),revision:record.revision+1});await this.collect(pluginId);
    });
  }
  releaseAccountGenerations(raw:GenerationCustodyScope){
    const scope=generationCustodyScopeSchema.parse(raw);
    return this.enqueue(async()=>{
      const matches=(pin:PluginRuntimeRecord['retentionPins'][number])=>pin.scope?.accountId===scope.accountId&&pin.scope.installationId===scope.installationId;
      for(const record of [...this.records.values()])if(record.retentionPins.some(matches)){
        await this.commit({...record,retentionPins:record.retentionPins.filter(pin=>!matches(pin)),revision:record.revision+1});await this.collect(record.pluginId);
      }
      const quarantined=this.quarantined.map(record=>record.retentionPins.some(matches)?{...record,retentionPins:record.retentionPins.filter(pin=>!matches(pin)),revision:record.revision+1}:record);
      if(quarantined.some((record,index)=>record!==this.quarantined[index])){
        const before=this.quarantined;this.quarantined=quarantined;
        try{await this.persist(this.records);}catch(error){this.quarantined=before;throw error;}
      }
    });
  }
  async assertServing(pluginId:string,generationId:string) {
    const record=this.require(pluginId),current=this.active(record);
    if(!record.enabled||current?.generationId!==generationId)throw new Error("Plugin generation is unavailable");
    await this.authorize(record,current,"serve");
    if(this.records.get(pluginId)!==record)throw new Error("Plugin generation changed while reading");
  }
  async dispose() {this.stopped=true;for(const id of this.pins.keys())this.releasePin(id);if(this.timer)clearInterval(this.timer);this.timer=null;await this.tail;}
  private enqueue<T>(operation:()=>Promise<T>):Promise<T> {
    if(this.stopped)return Promise.reject(new Error("Plugin runtime is stopped"));
    const next=this.tail.then(operation);this.tail=next.catch(()=>undefined);return next;
  }
  private async build(record:PluginRuntimeRecord,reason:"install"|"rebuild",signal?:AbortSignal) {
    const generationId=`plugin-${randomUUID()}`;
    let prepared:Awaited<ReturnType<PluginRuntimeOptions["compiler"]["prepare"]>>|undefined;
    try {
      signal?.throwIfAborted();
      await assertPluginIdentity(record,this.options);
      const manifest=await this.manifest(record.sourceRoot);
      if(manifest.id!==record.pluginId)throw new Error("Plugin source identity changed");
      const previous=record.generations[0]?.manifest??record.authoringManifest;
      if(previous&&('dock' in previous)!==('dock' in manifest))throw new Error('Plugin authoring target changed; create a separate definition');
      if(!this.records.has(record.pluginId)&&this.records.size>=REMOTE_PLUGIN_CATALOG_LIMITS.entries)throw new Error(`Plugin catalog capacity exceeds ${REMOTE_PLUGIN_CATALOG_LIMITS.entries} entries`);
      this.options.admit?.(manifest);
      prepared=await this.options.compiler.prepare({appId:record.pluginId,sourceRoot:record.sourceRoot,manifest,...(signal?{signal}:{})});
      const generation:PluginGeneration={generationId,createdAt:Date.now(),manifest,digests:{...prepared.digests},files:[...prepared.receipt.files],available:true};
      await prepared.seal(this.artifactRoot(record.pluginId,generationId));
      // Component synchronization can update working source before the compiler freezes it.
      const fingerprint=await this.fingerprint(join(this.artifactRoot(record.pluginId,generationId),'source'));
      await this.verify(record.pluginId,generation);
      await this.authorize(record,generation,reason);
      signal?.throwIfAborted();
      const generations=[...record.generations,generation];
      if(generations.length>256){
        const protectedIds=this.protectedGenerations(record);protectedIds.add(generationId);
        const index=generations.findIndex(item=>!protectedIds.has(item.generationId));
        if(index<0)throw new Error("Plugin generation history is fully retained");
        generations.splice(index,1);
      }
      const manual='dock' in manifest;
      const next={...record,authoringManifest:manifest,activeGenerationId:manual?record.activeGenerationId:generationId,candidateGenerationId:manual?generationId:null,
        previousGenerationId:manual?record.previousGenerationId:record.activeGenerationId,lastActivation:manual?record.lastActivation:null,generations,error:null,revision:record.revision+1};
      await this.commit(next);
      this.observed.set(record.pluginId,fingerprint);
      await this.collect(record.pluginId).catch(()=>undefined);
      return this.descriptor(record.pluginId)!;
    } catch(cause) {
      if(this.records.has(record.pluginId))await this.commit({...this.require(record.pluginId),error:this.reason(cause),revision:this.require(record.pluginId).revision+1});
      throw cause;
    } finally {await prepared?.cleanup().catch(()=>undefined); }
  }
  private async collect(pluginId:string) {
    const record=this.require(pluginId),protectedIds=this.protectedGenerations(record);
    let bytes=0;const drop:PluginGeneration[]=[];
    for(const generation of [...record.generations].filter(item=>item.available).sort((a,b)=>Number(protectedIds.has(b.generationId))-Number(protectedIds.has(a.generationId))||b.createdAt-a.createdAt)) {
      const size=await artifactBytes(this.artifactRoot(pluginId,generation.generationId));
      if(protectedIds.has(generation.generationId)||bytes+size<=(this.options.artifactBudgetBytes??128*1024*1024))bytes+=size;else drop.push(generation);
    }
    if(drop.length) {
      const ids=new Set(drop.map(item=>item.generationId));
      await this.commit({...record,generations:record.generations.map(item=>ids.has(item.generationId)?{...item,available:false}:item),revision:record.revision+1});
    }
    await collectUnreferenced(join(this.root,pluginId),new Set([...this.require(pluginId).generations.filter(item=>item.available).map(item=>item.generationId),...this.quarantined.filter(item=>item.pluginId===pluginId).flatMap(item=>item.generations.map(generation=>generation.generationId))]));
  }
  private async poll() {
    if(this.stopped||this.polling)return;this.polling=true;
    try {for(const record of this.list()) {
      if(this.stopped)break;
      try {
        await this.enqueue(async()=>{
          const current=this.require(record.pluginId),fingerprint=await this.fingerprint(current.sourceRoot);
          if(this.observed.get(current.pluginId)===fingerprint)return;
          this.observed.set(current.pluginId,fingerprint);
          await this.build(current,"rebuild");
        });
      } catch(cause) {
        if(!this.stopped)await this.enqueue(async()=>{const current=this.require(record.pluginId),error=this.reason(cause);if(current.error!==error)await this.commit({...current,error,revision:current.revision+1});});
      }
    }} finally {this.polling=false;}
  }
  private async fingerprint(root:string) {const inventory=await inspectPluginSource(root);return packageDigest(root,inventory.files);}
  private async manifest(root:string) {const bytes=await readFile(join(root,"plugin.json"));if(bytes.length>64*1024)throw new Error("Plugin manifest exceeds its budget");return pluginGuiManifestSchema.parse(JSON.parse(bytes.toString("utf8")));}
  private active(record:PluginRuntimeRecord) {return record.generations.find(item=>item.generationId===record.activeGenerationId&&item.available)??null;}
  private require(pluginId:string) {const record=this.records.get(pluginId);if(!record)throw new Error("Plugin is not installed");return record;}
  private verify(pluginId:string,generation:PluginGeneration) {return (this.options.verify??verifyCompiledV3Artifact)(this.artifactRoot(pluginId,generation.generationId),generation.digests);}
  private authorize(record:PluginRuntimeRecord,target:PluginGeneration,reason:"install"|"rebuild"|"activate"|"serve") {
    return assertPluginIdentity(record,this.options).then(()=>this.options.authorize({pluginId:record.pluginId,generationId:target.generationId,manifest:target.manifest,previousManifest:this.active(record)?.manifest??null,ownerChatId:record.ownerChatId,reason}));
  }
  private async commit(record:PluginRuntimeRecord) {
    const next=new Map(this.records);next.set(record.pluginId,record);await this.persist(next);this.records=next;
    for(const listener of this.listeners){try{listener(record.pluginId);}catch{/* Observers cannot undo a durable activation. */}}
  }
  private async persist(records:Map<string,PluginRuntimeRecord>) {
    const state=runtimeFileSchema.parse({schemaVersion:1,plugins:[...records.values()],quarantined:this.quarantined});await mkdir(this.root,{recursive:true,mode:0o700});await durableReplaceFile(this.file,canonicalJson(state));
  }
  private reason(cause:unknown) {return (cause instanceof Error?cause.message:String(cause)).slice(0,2048);}
}
const MIME:Readonly<Record<string,string>>={".html":"text/html",".js":"text/javascript",".css":"text/css",".png":"image/png",".jpg":"image/jpeg",".jpeg":"image/jpeg",".svg":"image/svg+xml",".webp":"image/webp",".woff":"font/woff",".woff2":"font/woff2"};
