/**
 * [INPUT]: Signed React runtime, declared operations/liveness timing and the lease-bound Surface bridge.
 * [OUTPUT]: Immutable plugin React API and bootstrap with bounded RPCs, independent terminal close, heartbeat and fatal-stop cleanup.
 * [POS]: Product-owned plugin SDK; no App, Base, filesystem or arbitrary network authority is exposed.
 */
import { PLUGIN_COMPOSER_OPERATIONS, PLUGIN_SURFACE_LIVENESS } from "@bottega/contracts/plugins/surface/contract";

export const PLUGIN_RUNTIME_SOURCE = `
import React,{createContext,useContext} from 'react';
const Context=createContext(null);
export const __PluginProvider=Context.Provider;
export function usePlugin(){const value=useContext(Context);if(!value)throw Error('PLUGIN_HOST_MISSING');return value;}
`;

export const PLUGIN_TYPES_SOURCE = `
import type {ComponentType,Provider} from 'react';
export type PluginFormat=Readonly<{id:string;version:number}>;
export type PluginSession=Readonly<{sessionId:string;pluginId:string;generationId:string;
 sourceFormat:PluginFormat&{readableVersions:readonly number[]};sourceId?:string;recoverySourceId?:string;
 attachmentId?:string;recoveryIncompatible?:boolean;settings:Readonly<Record<string,unknown>>;locale:string;theme:'light'|'dark'}>;
export interface PluginClient{
 readonly session:PluginSession|null;
 request(operation:${PLUGIN_COMPOSER_OPERATIONS.map(value => JSON.stringify(value)).join("|")},payload?:unknown):Promise<unknown>;
 setDirty(dirty:boolean):Promise<void>;
 submitAttachment(input:{image:File;source:Uint8Array;format:PluginFormat;replaceAttachmentId?:string}):Promise<{attachmentId:string}>;
 checkpoint(source:Uint8Array,format:PluginFormat):Promise<{sourceId:string}>;
 readSource(sourceId:string):Promise<Uint8Array>;
 computeCoverage(bytes:Uint8Array,signal?:AbortSignal):Promise<Uint8Array>;
 cancelCoverage():Promise<void>;
 close(input?:{saved?:boolean;discarded?:boolean}):Promise<void>;
}
export function usePlugin():PluginClient;
export const __PluginProvider:Provider<PluginClient>;
`;

export function pluginBootstrapSource(entry: string) {
  return `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {__PluginProvider} from '@bottega/plugin-react';
const operations=new Set(${JSON.stringify(PLUGIN_COMPOSER_OPERATIONS)});
const bridge=globalThis.__bottegaSurface??null;
const params=new URLSearchParams(location.hash.slice(1));
const nonce=params.get('readyNonce')||'';
const hostOrigin=params.get('hostOrigin')||'';
const postTarget=hostOrigin==='null'?'*':hostOrigin;
const nativePost=parent.postMessage.bind(parent);
const pending=new Map();let closed=false,heartbeat=null;
let preferences=null;const preferenceListeners=new Set();
function applyPreferences(value){
 if(closed||!value||typeof value.locale!=='string'||value.locale.length>32||!['light','dark'].includes(value.theme))return;
 preferences=Object.freeze({locale:value.locale,theme:value.theme});
 document.documentElement.lang=value.locale;document.documentElement.classList.toggle('dark',value.theme==='dark');document.documentElement.style.colorScheme=value.theme;
 for(const listener of preferenceListeners)listener(preferences);
}
const encoder=new TextEncoder(),MAX=1048576,CHUNK=262144,SOURCE=16777216;
history.replaceState(null,'',location.href.replace(/#.*$/,''));
function error(value){const result=new Error(value?.message||value?.code||String(value));if(value?.code)result.code=value.code;return result;}
function budget(value){if(encoder.encode(JSON.stringify(value??null)).byteLength>MAX)throw Error('PLUGIN_RPC_BUDGET');}
function settle(requestId,result,cause){
 const item=pending.get(requestId);if(!item)return;
 pending.delete(requestId);clearTimeout(item.timer);
 if(cause!==undefined){item.reject(cause);return;}
 try{budget(result);item.resolve(result);}catch(cause){item.reject(cause);}
}
function request(operation,payload={}){
 if(closed) return Promise.reject(Error('PLUGIN_SESSION_CLOSED'));
 if(!operations.has(operation))return Promise.reject(Error('PLUGIN_OPERATION_DENIED'));
 try{budget(payload);}catch(cause){return Promise.reject(cause);}
 if(!bridge&&(!nonce||!hostOrigin||hostOrigin==='*'))return Promise.reject(Error('PLUGIN_HOST_MISSING'));
 return new Promise((resolve,reject)=>{
  const requestId=crypto.randomUUID(),timer=setTimeout(()=>settle(requestId,undefined,Error('PLUGIN_RPC_TIMEOUT')),30000);
  pending.set(requestId,{resolve,reject,timer});
  if(bridge){Promise.resolve().then(()=>bridge.call(operation,payload)).then(value=>settle(requestId,value),cause=>settle(requestId,undefined,cause??Error('PLUGIN_REQUEST_FAILED')));return;}
  try{nativePost({channel:'bottega:plugin-request',requestId,readyNonce:nonce,operation,payload},postTarget);}catch(cause){settle(requestId,undefined,cause);}
 });
}
addEventListener('message',event=>{
 if(closed||event.source!==parent||event.origin!==hostOrigin)return;
 const data=event.data;if(data?.readyNonce!==nonce)return;
 if(data.channel==='bottega:plugin-preferences'){applyPreferences(data.preferences);return;}
 if(data.channel==='bottega:plugin-response')settle(data.requestId,data.result,data.error?error(data.error):undefined);
});
function stop(){
 if(closed)return;closed=true;
 if(heartbeat!==null){clearInterval(heartbeat);heartbeat=null;}
 const waiting=[...pending.values()];pending.clear();
 for(const item of waiting){clearTimeout(item.timer);item.reject(Error('PLUGIN_SESSION_CLOSED'));}
}
addEventListener('pagehide',stop,{once:true});
addEventListener('error',stop);
addEventListener('unhandledrejection',stop);
function base64(bytes){let value='';for(let start=0;start<bytes.length;start+=8192)value+=String.fromCharCode(...bytes.subarray(start,start+8192));return btoa(value);}
function decode(value){if(typeof value!=='string'||value.length>Math.ceil(CHUNK/3)*4)throw Error('PLUGIN_SOURCE_CHUNK');const raw=atob(value);return Uint8Array.from(raw,c=>c.charCodeAt(0));}
async function digest(bytes){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');}
let serial=Promise.resolve();
function exclusive(run){const result=serial.then(run,run);serial=result.catch(()=>{});return result;}
const session=await request('plugin.open');
if(!session||typeof session.pluginId!=='string'||typeof session.generationId!=='string')throw Error('PLUGIN_SESSION_INVALID');
let uncertainCommit=null;
function indeterminate(cause){return cause?.message==='PLUGIN_RPC_TIMEOUT'||cause?.reason==='timeout';}
async function commit(transactionId,key){
 for(let attempt=0;attempt<3;attempt++){
  try{const result=await request('plugin.transfer.commit',{transactionId});uncertainCommit=null;return result;}
  catch(cause){if(!indeterminate(cause)){uncertainCommit=null;throw cause;}uncertainCommit={transactionId,key};if(attempt===2)throw cause;}
 }
}
async function upload(kind,bytes,format,image,replaceAttachmentId,signal){
 signal?.throwIfAborted();
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>SOURCE)throw Error('PLUGIN_SOURCE_BUDGET');
 const source={pluginId:session.pluginId,generationId:session.generationId,format,byteLength:bytes.length,sha256:await digest(bytes)};
 const imageBytes=image?new Uint8Array(await image.arrayBuffer()):null;
 if(imageBytes&&(imageBytes.length<8||imageBytes.length>8388608))throw Error('PLUGIN_IMAGE_BUDGET');
 signal?.throwIfAborted();
 const metadata={kind,source,...(image?{image:{name:image.name,byteLength:imageBytes.length,sha256:await digest(imageBytes)}}:{}),...(replaceAttachmentId?{replaceAttachmentId}:{})};
 const key=JSON.stringify(metadata);
 if(uncertainCommit){if(uncertainCommit.key!==key)throw Error('PLUGIN_TRANSFER_PENDING');return commit(uncertainCommit.transactionId,key);}
 const result=await request('plugin.transfer.begin',metadata);
 const transactionId=result?.transactionId;if(typeof transactionId!=='string')throw Error('PLUGIN_TRANSFER_INVALID');
 try{
  for(const [part,data] of [['source',bytes],['image',imageBytes]]){
   if(!data)continue;
   for(let offset=0;offset<data.length;offset+=CHUNK){signal?.throwIfAborted();await request('plugin.transfer.chunk',{transactionId,part,offset,bytes:base64(data.subarray(offset,offset+CHUNK))});}
  }
  signal?.throwIfAborted();return await commit(transactionId,key);
 }catch(cause){if(!uncertainCommit)await request('plugin.transfer.abort',{transactionId}).catch(()=>{});throw cause;}
}
async function readSource(sourceId,signal){
 const parts=[];let offset=0,total=null;
 do{
  signal?.throwIfAborted();const part=await request('plugin.source.read',{sourceId,offset,length:CHUNK});
  if(!Number.isSafeInteger(part?.byteLength)||part.byteLength<1||part.byteLength>SOURCE||(total!==null&&total!==part.byteLength))throw Error('PLUGIN_SOURCE_BUDGET');
  total=part.byteLength;const bytes=decode(part.bytes);
  if(!bytes.length||offset+bytes.length>total)throw Error('PLUGIN_SOURCE_CHUNK');parts.push(bytes);offset+=bytes.length;
 }while(offset<total);
 const bytes=new Uint8Array(total);offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
}
const client=Object.freeze({
 session:Object.freeze(session),request,
 setDirty:dirty=>request('plugin.dirty',{dirty}).then(()=>{}),
 submitAttachment:input=>exclusive(()=>upload('attachment',input.source,input.format,input.image,input.replaceAttachmentId)),
 checkpoint:(source,format)=>exclusive(()=>upload('checkpoint',source,format)),
 readSource,
 cancelCoverage:()=>request('plugin.compute.coverage',{contract:'sketch.coverage/v1',cancel:true}).then(()=>{}),
 computeCoverage:(bytes,signal)=>exclusive(async()=>{
  const cancel=()=>{void client.cancelCoverage().catch(()=>{});};signal?.throwIfAborted();signal?.addEventListener('abort',cancel,{once:true});
  try{const input=await upload('compute',bytes,{id:'sketch.coverage/v1',version:1},null,null,signal);
   signal?.throwIfAborted();const output=await request('plugin.compute.coverage',{contract:'sketch.coverage/v1',sourceId:input.sourceId});
   signal?.throwIfAborted();return await readSource(output.sourceId,signal);
  }finally{signal?.removeEventListener('abort',cancel);}
 }),
 close:async(input={})=>{await request('plugin.close',input);stop();},
});
const target=document.getElementById('root');if(!target)throw Error('PLUGIN_ROOT_MISSING');
const module=await import(${JSON.stringify(entry)});if(typeof module.default!=='function')throw Error('PLUGIN_ENTRY_INVALID');
if(bridge?.onPreferences)bridge.onPreferences(applyPreferences);
function PluginHost(){
 const [current,setCurrent]=React.useState(()=>Object.freeze({...session,...preferences}));
 React.useEffect(()=>{const changed=value=>setCurrent(Object.freeze({...session,...value}));preferenceListeners.add(changed);if(preferences)changed(preferences);return()=>preferenceListeners.delete(changed);},[]);
 const value=React.useMemo(()=>Object.freeze({...client,session:current}),[current]);
 return React.createElement(__PluginProvider,{value},React.createElement(module.default));
}
createRoot(target,{onUncaughtError:stop}).render(React.createElement(PluginHost));
if(!closed)heartbeat=setInterval(()=>{
 if(!closed&&document.visibilityState==='visible')void request('plugin.heartbeat').catch(()=>{});
},${JSON.stringify(PLUGIN_SURFACE_LIVENESS.heartbeatMs)});
if(bridge)bridge.post('bottega:surface:ready');else nativePost({channel:'bottega:plugin-ready',readyNonce:nonce},postTarget);
`;
}
