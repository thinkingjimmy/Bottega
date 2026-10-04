/**
 * [INPUT]: Depends on plugin identity/compiler/runtime, the Surface gateway, authored recovery, package registry and record service.
 * [OUTPUT]: Provides PluginSurfaceIntegration for authored and record package catalogs, bounded admission, shared file delivery and lifecycle invalidation.
 * [POS]: Startup composition for the shared Sketch and package UI Surface transport.
 */
import { readFile } from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { PluginComposerEntry, GuiHistory, PluginDraftOwner } from '@bottega/contracts/plugins/surface/native';
import type { RemotePluginCatalog } from '@ai-chat/cloud-protocol/surfaces/plugin/catalog';
import type { AppsService } from '../../apps/apps-service';
import type { ChatStore } from '../../chats/chat-store';
import type {ProjectsService} from '../../projects/projects-service';
import type { BuiltinOwner, PluginCatalog } from '../catalog';
import { createPluginGuiBuildService } from '../../apps/gui-build/composition';
import { pluginGuiManifestSchema } from '../../apps/gui-build/source/manifest';
import { PluginSurfaceRuntime } from '../surface-runtime/service';
import { PluginSurfaceGateway } from '../surface-runtime/gateway';
import { PluginRecoveryStore } from '../recovery/store';
import type { PluginAuthoringRuntime } from '../authoring/toolset';
import { durableReplaceFile } from '../../persistence/durable-json';
import {pluginSourceRoot} from '../authoring/source-root';
import {createPluginSource} from '../authoring/scaffold';
import {registerPluginSurfaces} from './ipc';
import {RemotePluginSurfaces,type PluginCloudRuntime} from './remote';
import {pluginCatalog,admitPluginCatalog} from './catalog';
import type {BrowserWindow} from 'electron';
import { RecordPluginService } from '../records/service';
import { registerRecordPlugins } from '../records/ipc';

const grantsSchema=z.record(z.string(),z.array(z.string()).max(32));
export class PluginSurfaceIntegration {
  readonly runtime:PluginSurfaceRuntime;
  readonly gateway:PluginSurfaceGateway;
  readonly recovery:PluginRecoveryStore;
  readonly compiler;
  readonly remote:RemotePluginSurfaces;
  readonly records:RecordPluginService|null;
  private readonly releaseRecords:Array<()=>void>=[];
  private grants:Record<string,string[]>={};
  private readonly grantsFile:string;
  private readonly stop=new AbortController();
  private releaseCatalog:(()=>void)|null=null;
  private releaseChanges:(()=>void)|null=null;
  private seed:Promise<void>|null=null;
  private seedError='PLUGIN_PREPARING';
  private readonly listeners=new Set<()=>void>();
  readonly registrar={register:(window:BrowserWindow,url:string)=>{registerPluginSurfaces(this,this.ports.apps,window,url);if(this.records)registerRecordPlugins(this.records,url);}};
  readonly cloudSource={list:()=>this.catalog().map(value=>({id:value.id})),intent:(id:string)=>id.startsWith('host:')&&this.records?this.records.intent(id):this.runtime.intent(id),catalog:()=>this.catalog(),onChanged:(fn:()=>void)=>this.onChanged(fn)};
  constructor(private readonly ports:{userData:string;apps:AppsService;chats:ChatStore;projects:ProjectsService;accountId():string;deviceId:string;
    records?:Omit<ConstructorParameters<typeof RecordPluginService>[0],'gateway'|'authored'>}){
    this.grantsFile=join(ports.userData,'plugin-surface-grants.json');
    this.compiler=createPluginGuiBuildService(ports.userData);
    this.runtime=new PluginSurfaceRuntime(ports.userData,{compiler:this.compiler,officialSourceRoot:()=>pluginSourceRoot(ports.userData,'sketch'),admit:manifest=>this.admit(manifest),authorize:async input=>{
      this.stop.signal.throwIfAborted();
      const operations=input.manifest.operations;
      if(input.reason==='install'){
        const next={...this.grants,[input.pluginId]:[...operations]};
        await durableReplaceFile(this.grantsFile,JSON.stringify(next));this.grants=next;
      }else if(operations.some(operation=>!this.grants[input.pluginId]?.includes(operation)))throw new Error('PLUGIN_OPERATION_GRANT_REQUIRED');
    }});
    this.gateway=new PluginSurfaceGateway(this.runtime);
    this.records=ports.records?new RecordPluginService({...ports.records,gateway:this.gateway,authored:()=>pluginCatalog(this.runtime.list(),this.seedError)}):null;
    ports.apps.configurePluginSurfaces(this.gateway);
    this.recovery=new PluginRecoveryStore({root:join(ports.userData,'plugin-recovery'),scope:async request=>{
      if(request.ownerDeviceId&&request.ownerDeviceId!==ports.deviceId){const scope=await this.remote.scope(request.ownerDeviceId,request);return{...request,...scope};}
      this.assertOwner(request);return {...request,accountId:ports.accountId(),ownerDeviceId:ports.deviceId};
    }});
    this.remote=new RemotePluginSurfaces(this.gateway,this.recovery,()=>{for(const listener of this.listeners)listener();});
  }
  configureRemote(cloud:PluginCloudRuntime){this.remote.configure(cloud);}
  async initialize(){
    const bytes=await readFile(this.grantsFile,'utf8').catch((error:NodeJS.ErrnoException)=>{if(error.code==='ENOENT')return null;throw error;});
    this.grants=bytes?grantsSchema.parse(JSON.parse(bytes)):{};
    await this.compiler.initialize();
    await this.runtime.initialize();
    if(this.records&&this.ports.records){
      await this.records.refresh();
      let refresh=Promise.resolve();
      const changed=()=>{refresh=refresh.then(async()=>{await this.records!.refresh();for(const listener of this.listeners)listener();}).catch(cause=>console.warn('[record-plugins] catalog refresh failed',cause));};
      this.releaseRecords.push(this.ports.records.registry.onInventoryChanged(changed),this.ports.records.packages.onRevoked(changed));
    }
  }
  onChanged(listener:()=>void){this.listeners.add(listener);const off=this.runtime.onChanged(listener);return()=>{this.listeners.delete(listener);off();};}
  startSeed(){this.seed=this.seedSketch().catch(cause=>{this.seedError=cause instanceof Error?cause.message:String(cause);}).finally(()=>{for(const listener of this.listeners)listener();});}
  async seedSketch(){
    if(this.runtime.descriptor('sketch'))return;
    const {ensureOfficialSketchSource}=await import('../sketch/source');
    const root=await ensureOfficialSketchSource(this.ports.userData);
    await this.runtime.installOfficial(root,{ownerChatId:'sketch-authoring',signal:this.stop.signal});
  }
  assertOwner(owner:PluginDraftOwner){
    if(!/^[A-Za-z0-9_-]{1,128}$/.test(owner.chatId))throw new Error('PLUGIN_DRAFT_INVALID');
    const incarnation=this.ports.chats.getIncarnationId(owner.chatId);
    if(incarnation?incarnation!==owner.incarnationId:owner.incarnationId!==''||!owner.chatId.startsWith('c'))throw new Error('PLUGIN_DRAFT_EXPIRED');
  }
  list():readonly PluginComposerEntry[]{return this.catalog().filter(item=>!item.records).map(item=>({id:item.id,name:item.composer.title,icon:item.composer.icon,enabled:item.enabled,
    ...(item.error?{reason:item.error}:{}),activeGenerationId:item.generationId,sourceFormat:item.sourceFormat,operations:this.active(item.id)?.manifest.operations??[]}));}
  private active(id:string){const record=this.runtime.descriptor(id);return record?.generations.find(generation=>generation.generationId===record.activeGenerationId);}
  catalog():RemotePluginCatalog{return [...pluginCatalog(this.runtime.list(),this.seedError),...this.records?.catalog()??[]];}
  private admit(manifest:z.infer<typeof pluginGuiManifestSchema>){admitPluginCatalog(this.catalog(),manifest);}
  history(id:string):GuiHistory{const record=this.runtime.descriptor(id);if(!record)throw new Error('plugin-not-found');
    return {activeGenerationId:record.activeGenerationId,error:record.error,generations:this.runtime.history(id).map(generation=>({generationId:generation.generationId,
      createdAt:generation.createdAt,available:generation.available,version:generation.manifest.version,active:generation.generationId===record.activeGenerationId,
      previous:generation.generationId===record.previousGenerationId}))};}
  async edit(id:string,draftChatId:string|null){const record=this.runtime.descriptor(id);if(!record)throw new Error('plugin-not-found');
    if(this.ports.chats.has(record.ownerChatId))return {chatId:record.ownerChatId};
    if(draftChatId===null)return null;
    this.assertOwner({chatId:draftChatId,incarnationId:''});
    const {project}=await this.ports.projects.commitExternalProject({canonicalRoot:record.sourceRoot,name:this.active(id)?.manifest.name??id});
    await this.runtime.bindAuthoringChat(id,draftChatId,record.ownerChatId);return {chatId:draftChatId,projectId:project.id};
  }
  async newPlugin(chatId:string){this.assertOwner({chatId,incarnationId:''});
    const root=await createPluginSource(this.ports.userData,`plugin-${randomUUID()}`);
    const {project}=await this.ports.projects.commitExternalProject({canonicalRoot:root,name:'Plugin'});return {chatId,projectId:project.id};
  }
  attachCatalog(catalog:PluginCatalog){
    this.releaseCatalog=catalog.addOwnerSource(()=>this.owners(),{reservedIds:['sketch']});
    this.releaseChanges=this.onChanged(()=>{void catalog.refresh();});
  }
  private owners():BuiltinOwner[]{return this.catalog().filter(item=>!item.records).map(item=>({
    presentation:{official:item.id==='sketch',version:this.active(item.id)?.manifest.version??null,origin:this.runtime.descriptor(item.id)?.sourceRoot},
    descriptor:{id:item.id,kind:'feature',source:item.id==='sketch'?'builtin':'package',
    name:item.id==='sketch'?{key:'plugins.builtin.sketch.name'}:{text:item.name},summary:item.id==='sketch'?{key:'plugins.builtin.sketch.summary'}:{text:this.active(item.id)!.manifest.summary},description:item.id==='sketch'?{key:'plugins.builtin.sketch.description'}:null,
    icon:item.composer.icon,provides:[],requires:[],turnOn:{mode:'direct'},turnOff:{allowed:true},settings:[],
    capabilities:(this.active(item.id)?.manifest.operations??[]).map(operation=>({label:{text:operation},id:operation}))},
    enabled:()=>this.runtime.descriptor(item.id)?.enabled===true,setEnabled:async enabled=>{await this.runtime.setEnabled(item.id,enabled);},
    unsupported:()=>this.runtime.descriptor(item.id)?null:{text:this.seedError},
    health:async()=>{const error=this.runtime.descriptor(item.id)?.error??item.error;return {level:error?'error':'ok',summary:error?{text:error}:{key:'plugins.health.ready'},facts:[],checkedAt:Date.now()};}}));}
  authoring():PluginAuthoringRuntime{return {
    findByChat:chatId=>this.runtime.findByChat(chatId),
    install:input=>this.runtime.installLocal(input.sourceRoot,{ownerChatId:input.chatId,signal:input.signal}),
    validate:async input=>{
      const record=this.runtime.descriptor(input.pluginId);if(!record||record.ownerChatId!==input.chatId)throw new Error('plugin-chat-unbound');
      const manifest=pluginGuiManifestSchema.parse(JSON.parse(await readFile(join(record.sourceRoot,'plugin.json'),'utf8')));
      const prepared=await this.compiler.prepare({appId:record.pluginId,sourceRoot:record.sourceRoot,manifest,signal:input.signal});
      try{return {valid:true,sourcePackageDigest:prepared.digests.sourcePackageDigest};}finally{await prepared.cleanup();}
    },
    history:async id=>this.history(id),
    activate:input=>this.runtime.activate(input.pluginId,input.generationId,{expectedActiveGenerationId:input.expectedActiveGenerationId,signal:input.signal}),
  };}
  async close(){this.remote.close();this.stop.abort();for(const release of this.releaseRecords)release();await this.seed;this.releaseChanges?.();this.releaseCatalog?.();await this.runtime.dispose();}
}
