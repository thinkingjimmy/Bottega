/**
 * [INPUT]: Depends on schema-free Dock operations/budgets and the private isolated native bridge.
 * [OUTPUT]: Provides signed Dock React context/data hooks, typed client declarations and a post-commit ready bootstrap.
 * [POS]: Dedicated Dock compiler module; it exposes no App/composer, arbitrary network, storage or filesystem capability.
 */
import {DOCK_OPERATIONS,DOCK_RPC_BUDGET} from '@bottega/contracts/plugins/dock/session/protocol';
export const DOCK_RUNTIME_SOURCE=`
import React,{createContext,useContext,useEffect,useState} from 'react';
const Context=createContext(null);
export const __DockProvider=Context.Provider;
export function useDock(){const value=useContext(Context);if(!value)throw Error('DOCK_HOST_MISSING');return value;}
export function useDockData(){
 const dock=useDock(),[state,setState]=useState({readings:{},actions:[],loading:true,error:null});
 useEffect(()=>{
  let live=true,flight=false,queued=false;
  async function load(){
   if(!live)return;if(flight){queued=true;return;}flight=true;
   try{const value=await dock.read();if(live)setState({...value,loading:false,error:null});}
   catch{if(live)setState({readings:{},actions:[],loading:false,error:'DOCK_DATA_UNAVAILABLE'});}
   finally{flight=false;if(live&&queued){queued=false;void load();}}
  }
  const stop=dock.subscribe(()=>{void load();});void load();return()=>{live=false;stop();};
 },[dock]);return state;
}
`;
export const DOCK_TYPES_SOURCE=`
import type {Provider} from 'react';
export type DockOperation=${DOCK_OPERATIONS.map(value=>JSON.stringify(value)).join('|')};
export type DockSeries=Readonly<{from:number;to:number;timeZone:string;points:readonly Readonly<{at:number;value:number|null}>[]}>;
export type DockScalar=string|number|boolean|null;
export type DockRecord=Readonly<{id:string;values:Readonly<Record<string,DockScalar>>}>;
export type DockColumn=Readonly<{id:string;label:string;type:'text'|'number'|'date'|'select'|'checkbox'|'url'}>;
export type DockGroup=Readonly<{key:DockScalar;count:number}>;
export type DockReading=Readonly<{state:'ready'|'loading'|'no-data'|'partial'|'stale'|'needs-setup'|'needs-authorization'|'definition-missing'|'paused'|'failed';updatedAt:number|null;values:Readonly<Record<string,DockScalar|DockSeries>>;records?:readonly DockRecord[];columns?:readonly DockColumn[];groups?:readonly DockGroup[]}>;
export type DockAction=Readonly<{ref:string;kind:'refresh'|'open-base'|'open-task'|'open-usage';label:string}>;
export type DockDataSnapshot=Readonly<{readings:Readonly<Record<string,DockReading>>;actions:readonly DockAction[]}>;
export type DockClientSession=Readonly<{sessionId:string;name:string;scope:Readonly<{kind:'authoring-preview'|'dock-detail';definitionId:string;generationId:string;ownerKind:'instance'|'authoring-draft';ownerId:string;accountEpoch:number;revision:number}>;settings:Readonly<Record<string,string|number|boolean>>;locale:string;theme:'light'|'dark';operations:readonly DockOperation[]}>;
export interface DockClient{
 readonly session:DockClientSession;
 request(operation:DockOperation,payload?:unknown):Promise<unknown>;
 read(sources?:readonly string[]):Promise<DockDataSnapshot>;
 action(ref:string):Promise<void>;
 close():Promise<void>;
 subscribe(listener:()=>void):()=>void;
}
export function useDock():DockClient;
export function useDockData():DockDataSnapshot&Readonly<{loading:boolean;error:string|null}>;
export const __DockProvider:Provider<DockClient>;
`;
export function dockBootstrapSource(entry:string){return`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {__DockProvider} from '@bottega/dock-react';
const bridge=globalThis.__bottegaDock;
if(!bridge||typeof bridge.request!=='function')throw Error('DOCK_HOST_MISSING');
const allowed=new Set(${JSON.stringify(DOCK_OPERATIONS)}),listeners=new Set(),preferences=new Set();
let closed=false,stopChanges=null;
function stop(failed=false){if(closed)return;closed=true;stopChanges?.();listeners.clear();preferences.clear();if(failed)bridge.fail?.();}
addEventListener('pagehide',()=>stop(),{once:true});addEventListener('error',()=>stop(true));addEventListener('unhandledrejection',()=>stop(true));
async function request(operation,payload={}){
 if(closed)throw Error('DOCK_SESSION_CLOSED');if(!allowed.has(operation))throw Error('DOCK_OPERATION_DENIED');
 if(new TextEncoder().encode(JSON.stringify(payload)).byteLength>${DOCK_RPC_BUDGET.inputBytes})throw Error('DOCK_RPC_BUDGET');return bridge.request(operation,payload);
}
const session=await request('dock.open');
if(!session||typeof session.sessionId!=='string'||!['dock-detail','authoring-preview'].includes(session.scope?.kind))throw Error('DOCK_SESSION_INVALID');
let currentSession=Object.freeze(session);
function applyPreferences(value){
 if(!value||typeof value.locale!=='string'||!['light','dark'].includes(value.theme))return;
 currentSession=Object.freeze({...currentSession,locale:value.locale,theme:value.theme});document.documentElement.lang=value.locale;document.documentElement.classList.toggle('dark',value.theme==='dark');document.documentElement.style.colorScheme=value.theme;
 for(const listener of preferences)listener(currentSession);
}
applyPreferences(session);
stopChanges=bridge.onChanged(value=>{if(closed)return;if(value?.kind==='preferences')applyPreferences(value);else for(const listener of listeners)listener();});
const client=Object.freeze({session:currentSession,request,read:sources=>request('dock.data.read',sources?{sources:[...sources]}:{}),action:ref=>request('dock.action',{ref}).then(()=>{}),close:()=>request('dock.close').then(()=>stop()),subscribe:listener=>{listeners.add(listener);return()=>listeners.delete(listener);}});
const module=await import(${JSON.stringify(entry)});if(typeof module.default!=='function')throw Error('DOCK_ENTRY_INVALID');
const target=document.getElementById('root');if(!target)throw Error('DOCK_ROOT_MISSING');
function DockHost(){
 const [current,setCurrent]=React.useState(()=>currentSession);
 React.useEffect(()=>{preferences.add(setCurrent);setCurrent(currentSession);return()=>preferences.delete(setCurrent);},[]);
 React.useEffect(()=>{void request('dock.heartbeat',{ready:true}).catch(()=>stop(true));},[]);
 const value=React.useMemo(()=>Object.freeze({...client,session:current}),[current]);return React.createElement(__DockProvider,{value},React.createElement(module.default));
}
createRoot(target,{onUncaughtError:()=>stop(true)}).render(React.createElement(DockHost));
`;
}
