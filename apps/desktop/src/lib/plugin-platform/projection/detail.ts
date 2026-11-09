/**
 * [INPUT]: React effects, canonical plugin identities and exact get/changed bridge operations.
 * [OUTPUT]: usePluginDetail with identity/request generation fences; legacy IDs stay with their original detail owner.
 * [POS]: Optional source/detail projection; same-revision source writer changes invalidate its current read.
 */
import {useEffect,useState} from 'react';
import type {UnifiedPluginCatalogItem} from '@bottega/contracts/plugins/platform';
import {pluginPlatformBridge} from '../client';
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
/** Source writer waits are volatile; a durable revision is not a sufficient detail cache key. */
export function usePluginDetail(requestedId:string|null|undefined){
  const pluginId=requestedId&&/^[A-Za-z0-9_-]{1,128}$/.test(requestedId)?requestedId:null;
  const [state,setState]=useState<{plugin:UnifiedPluginCatalogItem|null;id:string|null;error:string;busy:boolean}>({plugin:null,id:null,error:'',busy:false});
  useEffect(()=>{const bridge=pluginPlatformBridge();if(!bridge||!pluginId)return;let live=true,generation=0;
    const load=()=>{const request=++generation;setState(previous=>({...previous,busy:true}));void bridge.get(pluginId).then(plugin=>{if(live&&request===generation)setState({plugin,id:pluginId,error:'',busy:false});},cause=>{if(live&&request===generation)setState({plugin:null,id:pluginId,error:message(cause),busy:false});});};
    load();const release=bridge.onChanged(load);return()=>{live=false;generation++;release();};
  },[pluginId]);
  return{plugin:state.id===pluginId?state.plugin:null,error:state.id===pluginId?state.error:'',busy:!!pluginId&&(state.id!==pluginId||state.busy)};
}
