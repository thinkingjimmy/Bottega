/**
 * [INPUT]: React external stores and bounded catalog summary pages.
 * [OUTPUT]: Settings-scoped plugin management pagination with atomic refresh of the requested depth.
 * [POS]: Optional Plugins management projection; it does not define runtime contribution discovery.
 */
import {useSyncExternalStore} from 'react';
import type {UnifiedPluginCatalogPage} from '@bottega/contracts/plugins/platform';
import {pluginPlatformBridge} from '../client';
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
type CatalogState={page:UnifiedPluginCatalogPage|null;error:string;busy:boolean};
let catalogState:CatalogState={page:null,error:'',busy:false},catalogGeneration=0,catalogRequestedDepth=0;
const catalogListeners=new Set<()=>void>();let catalogRelease:(()=>void)|undefined;
const emitCatalog=()=>catalogListeners.forEach(listener=>listener());
async function loadCatalog(append=false){
  const bridge=pluginPlatformBridge();if(!bridge)return;
  const previous=catalogState.page,cursor=append?previous?.nextCursor:undefined;
  if(append&&!cursor)return;
  catalogRequestedDepth=Math.max(catalogRequestedDepth,(previous?.items.length??0)+(append?100:0));
  const depth=catalogRequestedDepth;
  const request=++catalogGeneration;catalogState={...catalogState,busy:true};emitCatalog();
  try{
    let next=await bridge.list({scope:"settings",limit:100,...(cursor?{cursor}:{})});if(request!==catalogGeneration)return;
    const revision=next.revision;
    if(append&&previous?.revision!==revision)throw new Error('Stale plugin catalog cursor');
    const items=append?[...(previous?.items??[]),...next.items]:[...next.items];
    // A live notification must also satisfy an explicit Load more that has not returned yet.
    while(!append&&next.nextCursor&&items.length<depth){
      next=await bridge.list({scope:"settings",limit:100,cursor:next.nextCursor});if(request!==catalogGeneration)return;
      if(next.revision!==revision)throw new Error('Stale plugin catalog cursor');
      items.push(...next.items);
    }
    catalogRequestedDepth=next.nextCursor?Math.max(catalogRequestedDepth,items.length):items.length;
    catalogState={page:{...next,items},error:'',busy:false};emitCatalog();
  }catch(cause){if(request===catalogGeneration){catalogState={...catalogState,error:message(cause),busy:false};emitCatalog();}}
}

function subscribeCatalog(listener:()=>void){
  catalogListeners.add(listener);if(catalogListeners.size===1){catalogRelease=pluginPlatformBridge()?.onChanged(()=>void loadCatalog());void loadCatalog();}
  return()=>{catalogListeners.delete(listener);if(!catalogListeners.size){catalogRelease?.();catalogRelease=undefined;catalogGeneration++;}};
}
export function useUnifiedPlugins(){const state=useSyncExternalStore(subscribeCatalog,()=>catalogState);return{items:state.page?.items??[],...state,reload:loadCatalog};}
