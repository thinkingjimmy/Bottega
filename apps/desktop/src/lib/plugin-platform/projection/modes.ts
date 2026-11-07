/**
 * [INPUT]: React effects and canonical mode declarations/readiness.
 * [OUTPUT]: usePluginModes with live change subscriptions and stale-response fencing.
 * [POS]: Selected-mode guard and optional composer mode menu projection; native guarantees remain declared host facts.
 */
import {useEffect,useState} from 'react';
import type {UnifiedPluginMode} from '@bottega/contracts/plugins/platform';
import {pluginPlatformBridge} from '../client';
const message=(cause:unknown)=>cause instanceof Error?cause.message:String(cause);
export function usePluginModes(){
  const [modes,setModes]=useState<UnifiedPluginMode[]>([]),[error,setError]=useState('');
  useEffect(()=>{let live=true,request=0;const bridge=pluginPlatformBridge();if(!bridge)return;
    const load=()=>{const id=++request;void bridge.modes().then(next=>{if(live&&id===request){setModes(next);setError('');}},cause=>{if(live&&id===request)setError(message(cause));});};
    load();const stop=bridge.onChanged(load);return()=>{live=false;stop();};},[]);
  return{modes,error};
}
