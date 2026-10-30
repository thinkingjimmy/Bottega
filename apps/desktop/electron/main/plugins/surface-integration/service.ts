/**
 * [INPUT]: Depends on plugin/compiler/runtime identity, separate Library source and Cloud account owners, the Surface gateway, recovery, package registry and record service.
 * [OUTPUT]: Provides shared plugin catalogs/delivery, deferred Dock source/package ownership, retryable official initialization, bounded admission and complete lifecycle invalidation/cleanup.
 * [POS]: Startup composition for the shared Sketch and package UI Surface transport.
 */
import type {WidgetScopeCleanup} from '../../cloud/widgets/cleanup/owner';
import { readFile,stat } from 'node:fs/promises';
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
import { PluginInitializer } from './initialization';
import type {SourceChatInput} from '../../chats/lifecycle/source/create';
import {createDeferredOwner,type DeferredOwner} from '../lifecycle/deferred';
import type {DockSourceOwner} from './dock/create';

const grantsSchema=z.record(z.string(),z.array(z.string()).max(32));
export class PluginSurfaceIntegration {
  readonly runtime:PluginSurfaceRuntime;
  readonly gateway:PluginSurfaceGateway;
  readonly recovery:PluginRecoveryStore;
  readonly compiler;
  readonly remote:RemotePluginSurfaces;
  readonly records:RecordPluginService|null;
  private readonly dockOwner:DeferredOwner<DockSourceOwner>;
  private savedDockState=false;
  private readonly releaseWidgetCleanup:Array<()=>void>=[];
  private readonly releaseRecords:Array<()=>void>=[];
  private grants:Record<string,string[]>={};
  private readonly grantsFile:string;
  private readonly stop=new AbortController();
  private releaseCatalog:(()=>void)|null=null;
  private releaseChanges:(()=>void)|null=null;
  private readonly listeners=new Set<()=>void>();
  private readonly seed=new PluginInitializer(()=>this.seedSketch(),()=>{for(const listener of this.listeners)listener();});
  private get seedError(){return this.seed.error??'PLUGIN_PREPARING';}
  readonly registrar={register:(window:BrowserWindow,url:string)=>{registerPluginSurfaces(this,this.ports.apps,window,url);if(this.records)registerRecordPlugins(this.records,url);}};
  readonly cloudSource={list:()=>this.catalog().map(value=>({id:value.id})),intent:(id:string)=>id.startsWith('host:')&&this.records?this.records.intent(id):this.runtime.intent(id),catalog:()=>this.catalog(),onChanged:(fn:()=>void)=>this.onChanged(fn)};
  constructor(private readonly ports:{widgetCleanup?:WidgetScopeCleanup;userData:string;apps:AppsService;chats:ChatStore;projects:ProjectsService;accountId():string;libraryId():string|null;deviceId:string;
    createSourceChat?(input:SourceChatInput):Promise<unknown>;
    restoreSourceChat?(input:{chatId:string;incarnationId:string;projectId:string},current:()=>boolean):Promise<void>;
    records?:Omit<ConstructorParameters<typeof RecordPluginService>[0],'gateway'|'authored'>}){
    this.grantsFile=join(ports.userData,'plugin-surface-grants.json');
    this.compiler=createPluginGuiBuildService(ports.userData);
    this.runtime=new PluginSurfaceRuntime(ports.userData,{compiler:this.compiler,officialSourceRoot:()=>pluginSourceRoot(ports.userData,'sketch'),admit:manifest=>this.admit(manifest),authorize:async input=>{
      this.stop.signal.throwIfAborted();
      if('dock' in input.manifest)return;
      const operations=input.manifest.operations;
      if(input.reason==='install'){
        const next={...this.grants,[input.pluginId]:[...operations]};
        await durableReplaceFile(this.grantsFile,JSON.stringify(next));this.grants=next;
      }else if(operations.some(operation=>!this.grants[input.pluginId]?.includes(operation)))throw new Error('PLUGIN_OPERATION_GRANT_REQUIRED');
    }});
    this.dockOwner=createDeferredOwner(async current=>{const {createDockSourceOwner}=await import('./dock/create');return createDockSourceOwner({...ports,runtime:this.runtime},()=>current()&&!this.stop.signal.aborted);});
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
    const initialize=async()=>{await this.compiler.initialize();await this.runtime.initialize();};
    if(this.ports.widgetCleanup)this.releaseWidgetCleanup.push(await this.ports.widgetCleanup.initialize({generations:async accountId=>{const {clearWidgetRuntimePins}=await import('../../cloud/widgets/cleanup/files');await clearWidgetRuntimePins(this.ports.userData,this.ports.deviceId,accountId,this.runtime);}},initialize));else await initialize();
    this.savedDockState=(await Promise.all(['dock-widget-authoring.json','dock-widget-runtime.json','dock-widget-instances.json'].map(name=>stat(join(this.ports.userData,name)).then(()=>true,(error:NodeJS.ErrnoException)=>error.code!=='ENOENT')))).some(Boolean);
    if(this.records&&this.ports.records){
      await this.records.refresh();
      let refresh=Promise.resolve();
      const changed=()=>{refresh=refresh.then(async()=>{await this.records!.refresh();for(const listener of this.listeners)listener();}).catch(cause=>console.warn('[record-plugins] catalog refresh failed',cause));};
      this.releaseRecords.push(this.ports.records.registry.onInventoryChanged(changed),this.ports.records.packages.onRevoked(changed));
    }
  }
  onChanged(listener:()=>void){this.listeners.add(listener);const off=this.runtime.onChanged(listener);return()=>{this.listeners.delete(listener);off();};}
  widgetCleanup(){return this.ports.widgetCleanup??null;}
  dockScope(){return{accountId:this.ports.accountId(),installationId:this.ports.deviceId,libraryId:this.ports.libraryId()};}
  hasDockState(){return this.savedDockState||this.dockLoaded()||this.runtime.list().some(record=>Boolean(record.authoringManifest&&'dock'in record.authoringManifest)||record.generations.some(generation=>'dock'in generation.manifest));}
  dockLoaded(){return this.dockOwner.peek()!==null;}
  loadDock(){return this.dockOwner.get();}
  libraryChanged(){for(const listener of this.listeners)listener();}
  startSeed(){void this.retryInitialization('sketch').catch(()=>undefined);}
  async retryInitialization(id:string){
    if(id!=='sketch')throw new Error('plugin-not-found');
    this.stop.signal.throwIfAborted();
    if(this.runtime.descriptor(id))return;
    await this.seed.start();
  }
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
    ...(item.error?{reason:item.error}:{}),...(item.id==='sketch'&&!this.runtime.descriptor(item.id)?{initialization:this.seed.state==='failed'?'failed' as const:'preparing' as const}:{}),
    activeGenerationId:item.generationId,sourceFormat:item.sourceFormat,operations:this.composerOperations(item.id)}));}
  private active(id:string){const record=this.runtime.descriptor(id);return record?.generations.find(generation=>generation.generationId===record.activeGenerationId);}
  private composerOperations(id:string){const generation=this.active(id);return generation&&'composer' in generation.manifest?generation.manifest.operations:[];}
  activateComposer(id:string,generation:string,expected:string){
    const record=this.runtime.descriptor(id);
    if(record&&(record.authoringManifest&&'dock' in record.authoringManifest||record.generations.some(value=>'dock' in value.manifest)))throw new Error('Dock versions require a user preview and explicit application');
    return this.runtime.activate(id,generation,{expectedActiveGenerationId:expected});
  }
  catalog():RemotePluginCatalog{return [...pluginCatalog(this.runtime.list(),this.seedError),...this.records?.catalog()??[]];}
  private admit(manifest:z.infer<typeof pluginGuiManifestSchema>){admitPluginCatalog(this.catalog(),manifest);}
  history(id:string):GuiHistory{const record=this.runtime.descriptor(id);
    if(!record&&id==='sketch')return {activeGenerationId:null,error:this.seed.error,generations:[]};
    if(!record)throw new Error('plugin-not-found');
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
    unsupported:()=>this.runtime.descriptor(item.id)?null:{key:this.seed.state==='failed'?'guiHistory.initializationFailed':'guiHistory.initializing'},
    health:async()=>{const error=this.runtime.descriptor(item.id)?.error??item.error;return {level:error?'error':'ok',summary:error?{text:error}:{key:'plugins.health.ready'},facts:[],checkedAt:Date.now()};}}));}
  authoring():PluginAuthoringRuntime{return {
    findByChat:chatId=>this.runtime.findByChat(chatId),
    install:input=>this.runtime.installLocal(input.sourceRoot,{ownerChatId:input.chatId,signal:input.signal}),
    validate:async input=>{
      const record=this.runtime.descriptor(input.pluginId);if(!record||record.ownerChatId!==input.chatId)throw new Error('plugin-chat-unbound');
      const manifest=pluginGuiManifestSchema.parse(JSON.parse(await readFile(join(record.sourceRoot,'plugin.json'),'utf8')));
      const previous=record.generations[0]?.manifest;
      if(previous&&(manifest.id!==record.pluginId||('dock' in previous)!==('dock' in manifest)))throw new Error('Plugin source identity or authoring target changed');
      const prepared=await this.compiler.prepare({appId:record.pluginId,sourceRoot:record.sourceRoot,manifest,signal:input.signal});
      try{return {valid:true,sourcePackageDigest:prepared.digests.sourcePackageDigest};}finally{await prepared.cleanup();}
    },
    history:async id=>this.history(id),
    activate:input=>{
      const record=this.runtime.descriptor(input.pluginId);
      if(record?.generations.some(generation=>'dock' in generation.manifest))throw new Error('Dock versions require a user preview and explicit application');
      return this.runtime.activate(input.pluginId,input.generationId,{expectedActiveGenerationId:input.expectedActiveGenerationId,signal:input.signal});
    },
  };}
  async close(){for(const detach of this.releaseWidgetCleanup)detach();this.remote.close();this.stop.abort();for(const release of this.releaseRecords)release();await this.seed.wait();this.releaseChanges?.();this.releaseCatalog?.();const errors:unknown[]=[];for(const run of [()=>this.dockOwner.close(),()=>this.runtime.dispose()])try{await run();}catch(error){errors.push(error);}if(errors.length)throw new AggregateError(errors,'PLUGIN_SURFACE_CLEANUP_FAILED');}
}
