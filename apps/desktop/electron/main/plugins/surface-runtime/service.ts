/**
 * [INPUT]: Depends on the shared immutable compiler/seal, durable file publication, source inventory, catalog admission, source provenance and host authorization.
 * [OUTPUT]: Provides capacity-admitted local install, owned-source watching, atomic activation, retained failure, durable rollback/forward, strict-current publication and expiring lease-scoped generation pins.
 * [POS]: Plugin surface lifecycle owner; reuses App compiler artifacts without App records, Base grants or host-package execution.
 */
import {assertPluginIdentity} from "./identity";
import { randomUUID } from "node:crypto";
import { REMOTE_PLUGIN_CATALOG_LIMITS } from "@ai-chat/cloud-protocol/surfaces/plugin/catalog";
import { readFile, realpath, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { runtimeFileSchema, type PluginRuntimeRecord, type PluginGeneration, type PluginRuntimeOptions } from "./model";
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
      const record:PluginRuntimeRecord=existing??{pluginId:manifest.id,origin,ownerChatId:input.ownerChatId,sourceRoot:canonical,enabled:true,activeGenerationId:null,previousGenerationId:null,generations:[],error:null,revision:0};
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
  activate(pluginId:string,generationId:string,input:{expectedActiveGenerationId:string|null;signal?:AbortSignal}) {
    return this.enqueue(async()=>{
      const record=this.require(pluginId);
      if(record.activeGenerationId!==input.expectedActiveGenerationId)throw new Error("Active plugin generation changed");
      const target=record.generations.find(item=>item.generationId===generationId&&item.available);
      if(!target)throw new Error("Plugin generation is no longer available");
      input.signal?.throwIfAborted();
      await assertPluginIdentity(record,this.options);
      this.options.admit?.(target.manifest);
      await this.verify(pluginId,target);
      await this.authorize(record,target,"activate");
      input.signal?.throwIfAborted();
      const next={...record,activeGenerationId:generationId,previousGenerationId:record.activeGenerationId===generationId?record.previousGenerationId:record.activeGenerationId,error:null,revision:record.revision+1};
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
    const root=join(this.artifactRoot(pluginId,generation.generationId),"runtime/gui");
    return {kind:"compiled" as const,generationId:generation.generationId,artifactDigest:generation.digests.contentDigest,
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
    this.purgePins();return new Set([record.activeGenerationId,record.previousGenerationId,...[...this.pins.values()].filter(pin=>pin.pluginId===record.pluginId).map(pin=>pin.generationId)]);
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
      if(!this.records.has(record.pluginId)&&this.records.size>=REMOTE_PLUGIN_CATALOG_LIMITS.entries)throw new Error(`Plugin catalog capacity exceeds ${REMOTE_PLUGIN_CATALOG_LIMITS.entries} entries`);
      this.options.admit?.(manifest);
      const fingerprint=await this.fingerprint(record.sourceRoot);
      prepared=await this.options.compiler.prepare({appId:record.pluginId,sourceRoot:record.sourceRoot,manifest,...(signal?{signal}:{})});
      const generation:PluginGeneration={generationId,createdAt:Date.now(),manifest,digests:{...prepared.digests},files:[...prepared.receipt.files],available:true};
      await prepared.seal(this.artifactRoot(record.pluginId,generationId));
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
      const next={...record,activeGenerationId:generationId,previousGenerationId:record.activeGenerationId,generations,error:null,revision:record.revision+1};
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
        const fingerprint=await this.fingerprint(record.sourceRoot);
        if(this.observed.get(record.pluginId)===fingerprint)continue;
        this.observed.set(record.pluginId,fingerprint);
        await this.rebuild(record.pluginId);
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
