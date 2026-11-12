/**
 * [INPUT]: Shipped immutable weather packages and lazy canonical source admission, dependency/opt-in trace owners; shared HostRuntime/tool processes, Project/Chat services, optional live Library identity and isolated Surface transport. Forwards the active interface locale getter only to the lazy dependency owner.
 * [OUTPUT]: Retryable official-source mounting after real Library admission, source Projects/builds bound to exact installed-input receipts, activation-bound Surface/failure/revocation, digest-fenced repairs and guarded recovery.
 * [POS]: Production unified plugin owner; startup and shutdown retain this owner independently of resident windows.
 */
import {realpath,lstat,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {shell} from 'electron';
import {developmentWidgetCatalogDirectory} from '../official/widget-mode';
import {isOfficialWidgetId} from '../../../../shared/system-dock/widgets/catalog/distribution';
import type {UnifiedPluginRevision} from '@bottega/contracts/plugins/platform';
import {officialToolPlugins,setPluginToolAvailabilityResolver} from '../../../../shared/plugin-tools';
import {UnifiedPluginPlatform} from '../platform/service';
import {UnifiedPluginSurfaceGateway} from '../platform/gateway';
import {registerUnifiedPluginPlatform} from '../platform/ipc';
import type {PluginSourceProjects} from '../engineering/source-projects';
import type {PluginSourceObserver} from '../engineering/freshness/observer';
import type {PluginSourceEpoch} from '../engineering/freshness/epoch';
import {PluginSourceSupersededError} from '../platform/model';
import {assertLibraryOutsideUserData} from '../../library/safety/admission';
import {PluginAuthoringLeases} from '../engineering/leases';
import type {PluginDependencyInstaller} from '../engineering/dependency/owner';
import {setUnifiedPluginAuthoring,deferUnifiedPluginAuthoring} from '../authoring/unified';
import {setPluginModeResolver} from '../../sections/coordinator/turns/mode-admission';
import {setPluginSourceTurnHooks} from './turns';
import type {PluginCloudPackages} from '../distribution/cloud';
import {deferPluginPackages} from './adapters/package-loader';
import type {composeOfficialFeatureAdapters} from './adapters/features';
import type {PluginCloudRuntime} from '../surface-integration/remote';
import type {ProjectsService} from '../../projects/projects-service';
import type {ChatStore} from '../../chats/chat-store';
import type {PluginSurfaceGateway} from '../surface-runtime/gateway';
import type {composePluginTools} from '../../startup/domains/plugin-tools-composition';
import type {BrowserWindow} from 'electron';
import type {PluginCatalog} from '../catalog';
import type {ArchiveService} from '../../archive/archive-service';
type Ports={userData:string;locale?():string;libraryRoot():string|null;projects:ProjectsService;chats:ChatStore;
  tools:Awaited<ReturnType<typeof composePluginTools>>;transport:PluginSurfaceGateway;catalog:PluginCatalog;archive:Pick<ArchiveService,'restore'>};
const installed:{current:UnifiedPluginIntegration|null}={current:null};
export const unifiedPluginIntegration=()=>installed.current;

export class UnifiedPluginIntegration{
  readonly platform:UnifiedPluginPlatform;
  readonly widgetCatalogDirectory=developmentWidgetCatalogDirectory();
  readonly gateway:UnifiedPluginSurfaceGateway;
  private sources?:Promise<PluginSourceProjects>;
  readonly leases:PluginAuthoringLeases;
  readonly packages:ReturnType<typeof deferPluginPackages<PluginCloudPackages>>;
  private readonly stop=new AbortController();
  private mountedLibrary:string|null=null;
  private libraryMount?:{root:string;flight:Promise<void>};
  private sourceObserver?:Promise<PluginSourceObserver>;
  private readonly sourceEpochs=new Map<string,PluginSourceEpoch>();
  private readonly timers=new Map<string,ReturnType<typeof setTimeout>>();
  private readonly flights=new Map<string,Promise<unknown>>();
  private dependencies?:Promise<PluginDependencyInstaller>;
  private readonly writers=new Map<string,number>();
  private readonly pending=new Set<string>();
  private releaseFailures?:()=>void;
  private cloud:PluginCloudRuntime|null=null;
  private releaseCloudIdentity?:()=>void;
  private releaseCloudCatalog?:()=>void;
  private readonly publications=new Set<string>();
  private publicationFlight:Promise<void>|null=null;
  private releaseChanges?:()=>void;
  private releaseBundled?:()=>void;
  private releaseLeaseChanges?:()=>void;
  private featureAdapters?:Awaited<ReturnType<typeof composeOfficialFeatureAdapters>>;
  readonly registrar={register:(window:BrowserWindow,url:string)=>registerUnifiedPluginPlatform(this.platform,window,url,{gateway:this.gateway,packages:()=>this.packages.get()})};
  constructor(private readonly ports:Ports){
    this.leases=new PluginAuthoringLeases(ports.userData);
    this.gateway=new UnifiedPluginSurfaceGateway({transport:ports.transport,activeRevision:id=>this.platform.activeRevision(id),
      activationId:(id,revision)=>this.platform.activationId(id,revision),invoke:input=>ports.tools.processes.invoke({...input,revision:input.revisionId})});
    this.platform=new UnifiedPluginPlatform({userData:ports.userData,developmentWidgetDistribution:Boolean(this.widgetCatalogDirectory),prepareUi:input=>this.gateway.prepare(input),
      prepareRuntime:async({revision,manifest,activationId,signal})=>{
        const contributions=manifest.contributions.filter(value=>value.kind==='service'||value.kind==='tool'&&value.executor.kind==='process');
        const host=ports.tools.hostRuntime(manifest,revision.revisionId);
        if(!contributions.length)return host;
        const stored=this.platform.get(revision.pluginId)?.directory.sourceDirectory;
        const sourceRoot=stored&&await lstat(stored).then(info=>info.isDirectory(),()=>false)?stored:join(revision.rootDirectory,'source');
        const runtime=await ports.tools.processes.prepare({manifest:{...manifest,contributions},revision:revision.revisionId,activationId,sourceRoot,
          dataRoot:join(ports.userData,'plugin-data',revision.pluginId),buildRoot:revision.rootDirectory,signal});
        return{readiness:[...runtime.readiness,...host.readiness],
          activate:async context=>{await host.activate();await runtime.activate(context);},
          drain:async context=>{await runtime.drain(context);await host.drain();},
          dispose:async context=>{await runtime.dispose(context);await host.dispose();}};
      },revokeContributions:async input=>{
        if('all'in input){this.gateway.revokePlugin(input.pluginId);ports.tools.registry.unregisterPlugin(input.pluginId);}
        else{this.gateway.revoke(input.pluginId,input.revisionId,input.activationId);ports.tools.registry.unregisterPlugin(input.pluginId,input.revisionId);}},
      applyEnablement:input=>this.featureAdapters?.apply(input)??Promise.resolve(),
      featureReady:id=>this.featureAdapters?.ready(id)??id!=='artifact',
      authoringWaiters:id=>{
        const source=this.platform.store.read(state=>state.plugins.find(value=>value.manifest.id===id)?.directory.sourceDirectory);
        return source?this.leases.waiting(source).map(value=>value.participant):[];
      },
      prepareAuthoring:input=>{
        const item=input.pluginId?this.platform.get(input.pluginId):null;
        if(item&&(item.manifest.source.kind==='official'&&!item.manifest.source.editable||item.manifest.contributions.some(value=>'hostViewId'in value&&value.hostViewId)))throw new Error('PLUGIN_NATIVE_SOURCE_NOT_EDITABLE');
        return this.sourceProjects().then(owner=>owner.prepare(input));
      },openFolder:async id=>{const item=this.platform.get(id);if(!item)throw new Error('PLUGIN_NOT_FOUND');
        const path=item.directory.sourceDirectory??item.directory.packageDirectory;await realpath(path);shell.showItemInFolder(path);},
      restoreSource:(revision,execution)=>{
        const operation=this.restoreSource(revision,execution),key=`source-restore:${revision.pluginId}`;this.flights.set(key,operation);
        return operation.finally(()=>{if(this.flights.get(key)===operation)this.flights.delete(key);});
      },deleteData:async id=>{await rm(join(ports.userData,'plugin-data',id),{recursive:true,force:true});},
      reportError:error=>console.warn('[plugins] unified runtime',error)});
    this.packages=deferPluginPackages(async()=>{
      const {PluginCloudPackages}=await import('../distribution/cloud');
      const owner=new PluginCloudPackages({userData:ports.userData,platform:this.platform,cloud:()=>this.cloud?.widgetPackages??null,
        accountId:()=>{const identity=this.cloud?.accountIdentity();return identity?.profile&&!['signed-out','signing-out','revoked','deleted','deleting'].includes(identity.status)?identity.profile.userId:null;}});
      try{await owner.initialize();return owner;}catch(error){await owner.close();throw error;}
    });
  }
  surfaceResources(){return this.ports.transport.resourceUsage();}
  private sourceProjects(){
    if(this.stop.signal.aborted)return Promise.reject<PluginSourceProjects>(this.stop.signal.reason);
    return this.sources??=(async()=>{
      const [{PluginSourceProjects},{pluginSourceProjectPorts}]=await Promise.all([
        import('../engineering/source-projects'),import('./source-binding')]);
      const owner=new PluginSourceProjects(pluginSourceProjectPorts(this.ports,this.platform));
      try{await owner.initialize();this.stop.signal.throwIfAborted();return owner;}
      catch(error){await owner.close().catch(()=>{});this.sources=undefined;throw error;}
    })();
  }
  async initialize(){
    if(process.env.BOTTEGA_PLUGIN_SURFACE_TRACE==='1'){const {instrumentPluginSurfaces}=await import('../platform/diagnostics');instrumentPluginSurfaces(this.gateway,this.platform);}
    this.releaseFailures=this.ports.tools.processes.onFailure(input=>{void this.platform.runtimeFailed(input.pluginId,input.revision,input.activationId,input.reason).catch(error=>console.warn('[plugins] process failure',error));});
    await this.leases.initialize();await this.platform.initialize();
    setPluginToolAvailabilityResolver(id=>this.platform.get(id)?this.platform.isActive(id):id.startsWith('host_'));
    if(!this.widgetCatalogDirectory){
      const {installBundledWeather}=await import('../official/bundled');
      await installBundledWeather(this.platform,this.ports.userData);
      let weatherEnabled=this.platform.get('bottega-weather')?.installation.enabled??false;
      this.releaseBundled=this.platform.onChanged(()=>{
        const enabled=this.platform.get('bottega-weather')?.installation.enabled??false,previous=weatherEnabled;weatherEnabled=enabled;
        if(!enabled||previous||this.stop.signal.aborted)return;
        const operation=installBundledWeather(this.platform,this.ports.userData);this.flights.set('bundled-weather',operation);
        void operation.catch(error=>console.warn('[plugins] bundled weather update',error)).finally(()=>{if(this.flights.get('bundled-weather')===operation)this.flights.delete('bundled-weather');});
      });
    }
    const {composeOfficialFeatureAdapters}=await import('./adapters/features');
    this.featureAdapters=await composeOfficialFeatureAdapters({platform:this.platform,catalog:this.ports.catalog,
      reportError:error=>console.warn('[plugins] official feature adapter',error)});
    setPluginModeResolver(()=>this.platform.modes());
    setPluginSourceTurnHooks({acquire:async input=>{
      const source=await realpath(input.workspace);
      const item=this.platform.store.read(state=>state.plugins.find(value=>value.directory.sourceDirectory===source));
      if(!item||input.mode?.nativeRequirements?.readOnly)return null;
      const owner={kind:'turn' as const,id:input.requestId};
      const lease=await this.leases.acquire(source,owner,input.chatId,input.signal);
      const pending=this.timers.get(item.manifest.id);if(pending){clearTimeout(pending);this.timers.delete(item.manifest.id);}
      this.writers.set(item.manifest.id,(this.writers.get(item.manifest.id)??0)+1);
      return{release:async()=>{await lease.release();const count=Math.max(0,(this.writers.get(item.manifest.id)??1)-1);this.writers.set(item.manifest.id,count);
        if(!count)this.schedule(item.manifest.id);}};
    }});
    setUnifiedPluginAuthoring(deferUnifiedPluginAuthoring(async()=>{
      this.stop.signal.throwIfAborted();const {createSourcePluginAuthoring}=await import('../authoring/source');this.stop.signal.throwIfAborted();
      return createSourcePluginAuthoring({platform:this.platform,projects:this.ports.projects,chats:this.ports.chats,signal:this.stop.signal,
        rebuild:id=>this.rebuild(id),schedule:id=>this.schedule(id),installDependencies:(id,root,signal)=>this.installDependencies(id,root,signal)});
    }));
    this.releaseChanges=this.platform.onChanged(()=>this.reconcile());installed.current=this;
    this.releaseLeaseChanges=this.leases.onChanged(()=>this.platform.refreshReadiness());
    await this.mountLibrary();this.reconcile();
  }
  mountLibrary():Promise<void>{
    this.stop.signal.throwIfAborted();
    const root=this.ports.libraryRoot();if(!root)return Promise.resolve();
    if(this.mountedLibrary===root)return Promise.resolve();
    if(this.mountedLibrary||this.libraryMount&&this.libraryMount.root!==root)throw new Error('PLUGIN_LIBRARY_CHANGED');
    if(this.libraryMount)return this.libraryMount.flight;
    const flight=this.mountOfficialSources(root).finally(()=>{
      if(this.libraryMount?.flight===flight)this.libraryMount=undefined;
      if(this.mountedLibrary===root&&!this.stop.signal.aborted)this.reconcile();
    });
    this.libraryMount={root,flight};return flight;
  }
  private async mountOfficialSources(root:string){
    const sources=await this.ports.tools.loadOfficialSources();this.stop.signal.throwIfAborted();
    if(!sources||this.ports.libraryRoot()!==root)throw new Error('PLUGIN_LIBRARY_CHANGED');
    for(const source of sources){
      this.stop.signal.throwIfAborted();
      const existing=this.platform.get(source.manifest.id);
      await this.platform.register({manifest:source.manifest,sourceDirectory:source.sourceDirectory,packageDirectory:source.packageDirectory,
        ...(source.official.nativeFeature?{hostAdapter:true as const}:{}),
        ...(source.manifest.essential?{trustedEssential:true}:{}),...(existing?.sourceProject?.projectId?{projectId:existing.sourceProject.projectId}:{}),replace:true});
    }
    await this.featureAdapters?.synchronize();
    // Initial and first-selected Libraries expose the same complete official defaults before content becomes ready.
    for(const source of sources)if(!this.nativeFeature(source.manifest.id)&&!this.platform.activeRevision(source.manifest.id))await this.rebuild(source.manifest.id).catch(error=>console.warn('[plugins] official feature remains unavailable',source.manifest.id,error));
    this.stop.signal.throwIfAborted();
    if(this.ports.libraryRoot()!==root)throw new Error('PLUGIN_LIBRARY_CHANGED');
    this.mountedLibrary=root;
  }
  private nativeFeature(id:string){return Boolean(this.widgetCatalogDirectory&&isOfficialWidgetId(id)||officialToolPlugins.find(value=>value.id===id)?.nativeFeature);}
  configureCloud(cloud:PluginCloudRuntime){
    this.releaseCloudIdentity?.();this.releaseCloudCatalog?.();this.cloud=cloud;
    let previous='';
    const refresh=()=>{void this.packages.get().then(owner=>owner.refresh()).catch(error=>{if(cloud.widgetPackages.available())console.warn('[plugins] package directory',error);});};
    const changed=()=>{
      const identity=cloud.accountIdentity(),available=cloud.widgetPackages.available(),key=JSON.stringify([identity.profile?.userId??null,identity.status,available]);
      if(key===previous)return;previous=key;this.packages.accountChanged();this.releaseCloudCatalog?.();this.releaseCloudCatalog=undefined;
      if(!available)return;
      this.releaseCloudCatalog=cloud.widgetPackages.watchCatalog(()=>refresh(),error=>console.warn('[plugins] package directory watch',error));refresh();
      for(const item of this.platform.store.read(state=>state.plugins))if(item.activeRevision&&['authored','copy'].includes(item.installation.origin))this.publications.add(item.manifest.id);
      this.publishPending();
    };
    this.releaseCloudIdentity=cloud.subscribeIdentity(changed);changed();
  }
  private publishPending(){
    if(this.publicationFlight||!this.cloud?.widgetPackages.available()||this.stop.signal.aborted)return;
    let retry=true;
    this.publicationFlight=(async()=>{
      for(const id of [...this.publications]){
        if(this.stop.signal.aborted||!this.cloud?.widgetPackages.available())return;
        // Only a successful explicit first Share grants this plugin/account consent. This method never grants it.
        const revision=this.platform.activeRevision(id)?.revisionId;
        try{await(await this.packages.get()).publishUpdates(id);if(this.platform.activeRevision(id)?.revisionId===revision)this.publications.delete(id);}catch(error){retry=false;console.warn('[plugins] shared update will retry on the next connection',error);return;}
      }
    })().finally(()=>{this.publicationFlight=null;if(retry&&this.publications.size)this.publishPending();});
  }
  private reconcile(){
    if(this.stop.signal.aborted||this.libraryMount)return;
    this.sourceObserver??=import('../engineering/freshness/observer').then(({PluginSourceObserver})=>new PluginSourceObserver({
      schedule:id=>this.schedule(id),changedDuringBuild:id=>this.sourceEpochs.get(id)?.notify(),
      failed:(id,error)=>{void this.platform.buildFailed(id,error).catch(cause=>console.warn('[plugins] source watch',cause));}}));
    void this.sourceObserver.then(observer=>{if(this.stop.signal.aborted){observer.close();return;}
      observer.reconcile(this.platform.store.read(state=>state.plugins.filter(item=>item.manifest.source.format==='bottega'&&!this.nativeFeature(item.manifest.id)).map(item=>({
        id:item.manifest.id,sourceDirectory:item.directory.sourceDirectory,enabled:item.installation.enabled,status:item.status,hasActive:Boolean(item.activeRevision),busy:this.flights.has(item.manifest.id)}))));
    }).catch(error=>console.warn('[plugins] source observation',error));
  }
  private schedule(id:string){
    if(this.stop.signal.aborted)return;
    if((this.writers.get(id)??0)>0){this.pending.add(id);return;}
    const previous=this.timers.get(id);if(previous)clearTimeout(previous);
    this.timers.set(id,setTimeout(()=>{this.timers.delete(id);if((this.writers.get(id)??0)>0){this.pending.add(id);return;}
      void this.rebuild(id).catch(error=>console.warn('[plugins] automatic build',error));},500));
  }
  rebuild(id:string):Promise<unknown>{
    if(this.stop.signal.aborted)return Promise.reject(this.stop.signal.reason);
    const existing=this.flights.get(id);if(existing){this.pending.add(id);return this.sourceEpochs.get(id)?.join(existing,()=>this.rebuild(id))??existing;}
    this.pending.delete(id);const timer=this.timers.get(id);if(timer){clearTimeout(timer);this.timers.delete(id);}
    const work=(async()=>{for(;;){
      try{return await this.build(id);}catch(error){
        const item=this.platform.get(id);
        if(error instanceof PluginSourceSupersededError&&!this.stop.signal.aborted&&item?.status!=='cleanup-failed'){
          if(!item?.installation.enabled)return item;
          if((this.writers.get(id)??0)>0){this.pending.add(id);return item;}
          this.pending.delete(id);const queued=this.timers.get(id);if(queued){clearTimeout(queued);this.timers.delete(id);}continue;
        }
        if(!this.stop.signal.aborted&&item?.installation.enabled&&item.status!=='cleanup-failed')await this.platform.buildFailed(id,error);
        throw error;
      }
    }})().finally(()=>{this.flights.delete(id);this.sourceEpochs.delete(id);if(this.pending.delete(id))this.schedule(id);this.reconcile();});
    this.flights.set(id,work);return work;
  }
  private async build(id:string){
    const item=this.platform.get(id);if(!item)throw new Error('PLUGIN_NOT_FOUND');
    if(!item.installation.enabled||item.manifest.source.format!=='bottega'||this.nativeFeature(id))return item;
    const packaged=!item.directory.sourceDirectory&&await lstat(join(item.directory.packageDirectory,'plugin-package.json')).then(info=>info.isFile(),error=>{if(error.code==='ENOENT')return false;throw error;});
    if(packaged){const sourceVersion=await this.platform.sourceChanged(id);
      const {importPluginDistribution}=await import('./distribution');
      const revision=await importPluginDistribution({directory:item.directory.packageDirectory,buildsRoot:join(this.ports.userData,'plugin-builds'),sourceVersion});
      return this.platform.activateCandidate(revision);}
    const source=item.directory.sourceDirectory??item.directory.packageDirectory;
    const {inspectPluginSource}=await import('../engineering/freshness/source');
    const inspected=await inspectPluginSource(source,this.platform.sourceBuild(id),this.stop.signal);
    if(inspected.unchanged){await this.platform.sourceUnchanged(id,{signal:this.stop.signal,assertCurrent:()=>{
      const current=this.platform.get(id);if(!current||(current.directory.sourceDirectory??current.directory.packageDirectory)!==source)throw new Error('PLUGIN_SOURCE_BINDING_CHANGED');}});return this.platform.get(id);}
    const dependencies=await this.installDependencies(id,source,this.stop.signal);
    const {PluginSourceEpoch}=await import('../engineering/freshness/epoch');
    const baseline=await inspectPluginSource(source,undefined,this.stop.signal),sourceVersion=await this.platform.sourceChanged(id);
    const bound=()=>{const record=this.platform.get(id);return !this.stop.signal.aborted&&(record?.directory.sourceDirectory??record?.directory.packageDirectory)===source;};
    const current=()=>this.sourceEpochs.get(id)===epoch&&bound();
    const epoch:PluginSourceEpoch=new PluginSourceEpoch({sourceDigest:baseline.sourceDigest,current,bindingCurrent:bound,
      inspect:async()=>(await inspectPluginSource(source,undefined,this.stop.signal)).sourceDigest,
      invalidate:async()=>{await this.platform.sourceChanged(id,undefined,()=>{if(!current())throw new PluginSourceSupersededError();});}});
    this.sourceEpochs.set(id,epoch);
    const assertCurrent=()=>{
      this.stop.signal.throwIfAborted();const item=this.platform.get(id);if(!item||(item.directory.sourceDirectory??item.directory.packageDirectory)!==source)throw new Error('PLUGIN_SOURCE_BINDING_CHANGED');
      epoch.assertCurrent();if(this.platform.store.read(state=>state.plugins.find(value=>value.manifest.id===id)?.sourceVersion)!==sourceVersion)throw new PluginSourceSupersededError();
    };
    try{
      const {buildUnifiedPlugin}=await import('../engineering/build');
      const result=await epoch.run(()=>buildUnifiedPlugin({sourceRoot:source,buildsRoot:join(this.ports.userData,'plugin-builds'),sourceVersion,signal:this.stop.signal,dependencyFingerprint:dependencies.dependencyFingerprint,dependencyLocalSourceDigest:dependencies.localSourceDigest}));
      const latest=(await inspectPluginSource(source,undefined,this.stop.signal)).sourceDigest;
      if(latest!==result.distribution.sourceDigest)throw new PluginSourceSupersededError();
      await epoch.drain();assertCurrent();
      const activated=await this.platform.activateCandidate(result.revision,{signal:this.stop.signal,builtSource:{sourceDirectory:source,sourceDigest:latest},assertCurrent});
      if(['authored','copy'].includes(activated.installation.origin)){this.publications.add(id);this.publishPending();}return activated;
    }finally{epoch.close();await epoch.drain();}
  }
  private dependencyInstaller(){
    return this.dependencies??=import('../engineering/dependency/owner').then(({PluginDependencyInstaller})=>new PluginDependencyInstaller({userData:this.ports.userData,locale:this.ports.locale,signal:this.stop.signal,
      name:id=>this.platform.get(id)?.manifest.name??id,current:(id,source)=>{const item=this.platform.get(id);if(!item||(item.directory.sourceDirectory??item.directory.packageDirectory)!==source)throw new Error('PLUGIN_SOURCE_BINDING_CHANGED');},
      warnings:(id,warnings)=>this.platform.buildWarnings(id,warnings)})).catch(error=>{this.dependencies=undefined;throw error;});
  }
  private installDependencies(id:string,source:string,signal:AbortSignal){return this.dependencyInstaller().then(owner=>owner.install(id,source,signal));}
  private async restoreSource(revision:UnifiedPluginRevision,execution:{signal?:AbortSignal;assertCurrent?():void}={}){
    const signal=execution.signal?AbortSignal.any([this.stop.signal,execution.signal]):this.stop.signal;
    const assertCurrent=()=>{signal.throwIfAborted();execution.assertCurrent?.();};assertCurrent();
    const item=this.platform.get(revision.pluginId),source=item?.directory.sourceDirectory;if(!source)throw new Error('PLUGIN_SOURCE_UNAVAILABLE');
    await assertLibraryOutsideUserData(source,this.ports.userData);
    const lease=await this.leases.acquire(source,{kind:'turn',id:`restore-${Date.now()}`},'restore',signal);
    this.writers.set(revision.pluginId,(this.writers.get(revision.pluginId)??0)+1);
    const pending=this.timers.get(revision.pluginId);if(pending){clearTimeout(pending);this.timers.delete(revision.pluginId);}
    const backup=join(this.ports.userData,'plugin-source-recovery',revision.pluginId,String(Date.now()));
    try{
      const {restorePluginSource}=await import('../engineering/recovery/source');
      await restorePluginSource({source,snapshot:join(revision.rootDirectory,'source'),backup,signal,assertCurrent});
      await this.sourceObserver?.then(observer=>observer.reset(revision.pluginId));
      await this.dependencies?.then(owner=>owner.invalidate(revision.pluginId,source));
      await this.platform.store.mutate(state=>{const record=state.plugins.find(value=>value.manifest.id===revision.pluginId);if(record)record.directory.missing=false;});
    }
    finally{await lease.release();const count=Math.max(0,(this.writers.get(revision.pluginId)??1)-1);this.writers.set(revision.pluginId,count);if(!count&&!this.stop.signal.aborted)this.schedule(revision.pluginId);}
  }
  async close(){
    this.stop.abort();this.releaseBundled?.();this.releaseLeaseChanges?.();this.releaseChanges?.();this.releaseFailures?.();this.releaseCloudIdentity?.();this.releaseCloudCatalog?.();for(const timer of this.timers.values())clearTimeout(timer);
    await this.libraryMount?.flight.catch(()=>{});
    await this.sourceObserver?.then(observer=>observer.close(),()=>{});
    await this.dependencies?.then(owner=>owner.close(),()=>{});
    await Promise.allSettled([...this.flights.values()]);setPluginModeResolver(()=>[]);setUnifiedPluginAuthoring(null);setPluginSourceTurnHooks(null);
    await this.packages.close();await this.publicationFlight;await this.featureAdapters?.close();await this.sources?.then(owner=>owner.close(),()=>{});await this.leases.close();this.gateway.close();await this.platform.dispose();await this.ports.tools.processes.close();await this.ports.tools.credentials.close();
    if(installed.current===this)installed.current=null;
  }
}
export async function initializeUnifiedPlugins(ports:Ports){const owner=new UnifiedPluginIntegration(ports);await owner.initialize();return owner;}
