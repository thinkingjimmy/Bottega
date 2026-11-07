/**
 * [INPUT]: Bounded summary pagination, exact full UI reads and React external stores.
 * [OUTPUT]: useUnifiedPluginIndex and useRuntimePlugins independent of management paging.
 * [POS]: Cold runtime contribution projection; one local generation fences every changed notification and all pages.
 */
import {useSyncExternalStore} from 'react';
import type {UnifiedPluginCatalogPage,UnifiedPluginCatalogItem,UnifiedPluginCatalogSummary} from '@bottega/contracts/plugins/platform';
import {pluginPlatformBridge,isHostedAppPlugin} from '../client';
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
type CatalogState={page:UnifiedPluginCatalogPage|null;error:string;busy:boolean};
type IndexState=CatalogState&{runtimeItems:UnifiedPluginCatalogItem[];runtimeError:string;runtimeBusy:boolean;generation:number};
let indexState:IndexState={page:null,error:'',busy:false,runtimeItems:[],runtimeError:'',runtimeBusy:false,generation:0},indexGeneration=0;
const indexListeners=new Set<()=>void>();let indexRelease:(()=>void)|undefined;
const emitIndex=()=>indexListeners.forEach(listener=>listener());
async function loadIndex(){
  const bridge=pluginPlatformBridge();if(!bridge)return;
  const request=++indexGeneration;indexState={...indexState,busy:true,generation:request};emitIndex();
  try{
    let cursor:string|undefined,revision:number|undefined,page:UnifiedPluginCatalogPage;const items:UnifiedPluginCatalogSummary[]=[];
    do{page=await bridge.list({limit:100,...(cursor?{cursor}:{})});if(request!==indexGeneration)return;
      if(revision!==undefined&&revision!==page.revision)throw new Error('Plugin catalog changed while reading its contribution index');revision=page.revision;items.push(...page.items);cursor=page.nextCursor;
    }while(cursor);
    // Disabled delegated Apps still need their exact hostAppId for canonical management deduplication.
    const wanted=items.filter(item=>item.manifest.contributionKinds.some(kind=>kind==='page'||kind==='composer')&&(item.installation.enabled&&item.runtimeReady||isHostedAppPlugin(item)));
    const byId=new Map(wanted.map(item=>[item.manifest.id,item]));
    // Keep an unchanged active surface while source builds, but adopt disable/crash facts immediately.
    const retained=indexState.runtimeItems.flatMap(item=>{const summary=byId.get(item.manifest.id);return summary&&summary.activeRevision===item.activeRevision?[{...item,status:summary.status,runtimeReady:summary.runtimeReady,installation:summary.installation,error:summary.error}]:[];});
    indexState={page:{...page,items,nextCursor:undefined},error:'',busy:false,runtimeItems:retained,runtimeError:'',runtimeBusy:!!wanted.length,generation:request};emitIndex();
    const full=await Promise.all(wanted.map(item=>bridge.get(item.manifest.id)));if(request!==indexGeneration)return;
    indexState={...indexState,runtimeItems:full.filter((item):item is UnifiedPluginCatalogItem=>!!item),runtimeBusy:false};emitIndex();
  }catch(cause){if(request===indexGeneration){indexState={...indexState,busy:false,runtimeBusy:false,error:message(cause),runtimeError:message(cause)};emitIndex();}}
}
function subscribeIndex(listener:()=>void){
  indexListeners.add(listener);if(indexListeners.size===1){indexRelease=pluginPlatformBridge()?.onChanged(()=>void loadIndex());void loadIndex();}
  return()=>{indexListeners.delete(listener);if(!indexListeners.size){indexRelease?.();indexRelease=undefined;indexGeneration++;}};
}
export function useUnifiedPluginIndex(){const state=useSyncExternalStore(subscribeIndex,()=>indexState);return{items:state.page?.items??[],page:state.page,error:state.error,busy:state.busy,generation:state.generation,reload:loadIndex};}
export function useRuntimePlugins(){const state=useSyncExternalStore(subscribeIndex,()=>indexState);return{items:state.runtimeItems,error:state.runtimeError||state.error,busy:state.busy||state.runtimeBusy};}
