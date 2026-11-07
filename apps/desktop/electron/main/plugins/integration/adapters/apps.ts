/**
 * [INPUT]: Canonical AppStore events, main-owned request UUIDs, original App enablement/removal authority, Library root and unified host-adapter registry.
 * [OUTPUT]: Base/Web/Server page/service contributions with stable identity and explicit main-owned retained uninstall through the original lifecycle owner.
 * [POS]: C7/E3 production delegation; no duplicate Base, generation, server, source Project, GUI grant or data epoch is created.
 */
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { hashCanonical } from '@bottega/contracts/core/canonical-json';
import { unifiedPluginManifestSchema,type UnifiedPluginManifest } from '@bottega/contracts/plugins/platform';
import { appDisplayName,type AppRecord } from '../../../../../shared/ipc/apps/apps-ipc';
import type { AppsService } from '../../../apps/apps-service';
import { durableReplaceFile } from '../../../persistence/durable-json';
import type { UnifiedPluginPlatform } from '../../platform/service';
export const appPluginId=(appId:string)=>`app_${hashCanonical(appId).slice(0,40)}`;
type Ports={apps:AppsService;platform:UnifiedPluginPlatform;libraryRoot():string|null;reportError?(error:unknown):void};
function manifestOf(record:AppRecord):UnifiedPluginManifest{
  const app=record.manifest;if(!app)throw new Error('An installed App manifest is required');
  const id=appPluginId(record.id),name=appDisplayName(record).slice(0,160),entry=`host-app/${record.id}`;
  return unifiedPluginManifestSchema.parse({schemaVersion:1,id,name,version:'1.0.0',description:app.description.slice(0,8192),
    source:{kind:record.origin==='preset'?'official':record.origin==='local'?'authored':'external',format:app.kind==='base'?'base-app':app.kind==='server'?'server-app':'web-app',editable:false,
      ...(record.sourceRepoUrl?.startsWith('https://')?{url:record.sourceRepoUrl}:{}),revision:`sha256:${hashCanonical({generation:record.generationBinding.active?.generationId??null,manifest:app})}`},
    requirements:{sdkVersion:1,platforms:['darwin'],runtimes:['desktop']},dependencies:[],
    slots:{declares:[],injects:[{slot:'main.pages',ownerPluginId:'host'},{slot:'sidebar.navigation',ownerPluginId:'host'}]},
    contributions:[{id:'page',kind:'page',name,entry,slot:'main.pages',hostAppId:record.id,navigation:{label:name}},
      ...(app.kind==='server'?[{id:'service',kind:'service',name,entry,hostAppId:record.id,parallelSafe:false}]:[])],dataContract:'host-app-1'});
}
export async function composeAppPluginAdapters(ports:Ports){
  const registered=new Map<string,()=>void>(),fingerprints=new Map<string,string>(),appIds=new Map<string,string>(),cleanupErrors=new Map<string,string>();
  let closed=false,chain:Promise<void>=Promise.resolve();
  const sync=async(appId:string)=>{
    if(closed)return;const record=ports.apps.store.get(appId),id=appPluginId(appId);
    if(!record||!record.manifest){
      const release=registered.get(id);if(release){release();registered.delete(id);fingerprints.delete(id);appIds.delete(id);if(ports.platform.get(id))await ports.platform.remove({pluginId:id});}return;
    }
    const library=ports.libraryRoot();if(!library)return;
    appIds.set(id,appId);
    const manifest=manifestOf(record),fingerprint=hashCanonical(manifest),directory=join(library,'plugins',id,'source');
    if(fingerprints.get(id)!==fingerprint){
      await mkdir(directory,{recursive:true});await durableReplaceFile(join(directory,'bottega.plugin.json'),`${JSON.stringify(manifest,null,2)}\n`);
      await ports.platform.register({manifest,packageDirectory:directory,enabled:false,trust:true,replace:true,hostAdapter:true});
      fingerprints.set(id,fingerprint);
    }
    if(!registered.has(id))registered.set(id,ports.platform.registerHostAdapter(id,{
      state:()=>{const current=ports.apps.store.get(appId),active=current?.generationBinding.active,cleanup=cleanupErrors.get(id);
        const ready=Boolean(current?.manifest&&active&&['ready','updating','update-failed'].includes(current.state)&&
          (current.manifest.kind!=='server'||ports.apps.runtimeState(appId)==='running'));
        return{enabled:current?.enabled??false,ready:ready&&!cleanup,...(cleanup?{status:'cleanup-failed' as const,error:cleanup}:current?.lastError?.message?{error:current.lastError.message}:!current?{error:'The installed App was removed'}:{})};},
      setEnabled:async(enabled,reviewed)=>{const current=await ports.apps.enablement.impact(appId);
        if(!enabled&&current.enabled&&!reviewed)throw new Error('Review the App impact before turning it off');
        const impact=!enabled&&reviewed?reviewed:current;
        try{await ports.apps.enablement.setEnabled({appId,enabled,expectedRevision:impact.revision,...(!enabled?{impactDigest:impact.digest}:{})});cleanupErrors.delete(id);}
        catch(cause){if(ports.apps.store.get(appId)?.enabled===false)cleanupErrors.set(id,cause instanceof Error?cause.message:String(cause));throw cause;}},
      remove:()=>ports.apps.uninstall(appId,randomUUID()),
    }));
    await ports.platform.refreshHostAdapter(id);
  };
  const enqueue=(appId:string)=>{chain=chain.then(()=>sync(appId)).catch(error=>ports.reportError?.(error));return chain;};
  const release=ports.apps.onEvent(event=>{if('appId'in event&&['status','removed','runtime'].includes(event.type))void enqueue(event.appId);});
  for(const record of ports.apps.store.list())await enqueue(record.id);
  return{refresh:async()=>{const records=ports.apps.store.list(),alive=new Set(records.map(record=>record.id));for(const id of appIds.values())if(!alive.has(id))await enqueue(id);for(const record of records)await enqueue(record.id);},close:async()=>{closed=true;release();await chain;for(const stop of registered.values())stop();registered.clear();}};
}
