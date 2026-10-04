/**
 * [INPUT]: Window-bound plugin leases, authenticated parent messaging and host-supplied scoped dispatch.
 * [OUTPUT]: NativePluginFrame shared by composer and record plugins; NativePluginSurface retains composer recovery.
 * [POS]: Opaque isolated iframe transport with bounded requests, liveness and terminal lease cleanup.
 */
import {useLayoutEffect,useEffect,useMemo,useRef,useState} from 'react';
import type {PluginSurfaceDescriptor} from '@bottega/contracts/plugins/surface/native';
import type {PluginSurfaceEnvironment,PluginSurfaceProps} from '@ai-chat/chat-ui/plugins/host/contracts';
import "@/lib/apps/plugins-client";
export function NativePluginSurface(props:PluginSurfaceProps){
 const port=useMemo(()=>({
  open:()=>{const bridge=window.pluginSurfaces!;const owner={chatId:props.scope.chatId,incarnationId:props.scope.incarnationId};
    return props.scope.ownerDeviceId==='local'?bridge.open(props.entry.id,owner):bridge.openRemote(props.entry.id,props.scope.ownerDeviceId,owner);},
  validate:(id:string)=>window.pluginSurfaces!.validate(id),release:(id:string)=>window.pluginSurfaces!.release(id),
  onChanged:(listener:()=>void)=>window.pluginSurfaces!.onChanged(listener),
 }),[props.scope,props.entry.id]);
 return <NativePluginFrame {...props} port={port}/>;
}
export type NativeSurfacePort={open():Promise<PluginSurfaceDescriptor>;validate(id:string):Promise<boolean>;release(id:string):Promise<void>;onChanged(listener:()=>void):()=>void};
export function NativePluginFrame(props:Omit<PluginSurfaceProps,'scope'>&{port:NativeSurfacePort}){
 const {entry,port,createDispatch,beforeEnd,onStatus}=props;
 const preferences=useRef(props.preferences);useLayoutEffect(()=>{preferences.current=props.preferences;},[props.preferences]);
 const disabled=useRef<(()=>void)|null>(null),enabled=useRef(entry.enabled);useLayoutEffect(()=>{enabled.current=entry.enabled;},[entry.enabled]);
 const frame=useRef<HTMLIFrameElement>(null),[lease,setLease]=useState<PluginSurfaceDescriptor|null>(null);
 useEffect(()=>{
  const bridge=port;
  let active=true,terminal=false,authorityRevision=0,current:PluginSurfaceDescriptor|null=null,serial=Promise.resolve(),ready=false,started=0;
  let dispatch:ReturnType<PluginSurfaceProps['createDispatch']>|null=null;
  const receipts=new Map<string,Promise<unknown>>();
  const retire=(reason:Parameters<PluginSurfaceProps['beforeEnd']>[0],status:string)=>{terminal=true;const previous=current;current=null;dispatch=null;setLease(null);onStatus(status);void beforeEnd(reason).catch(()=>{});if(previous)void bridge.release(previous.id);};
  const acquire=async()=>{
    await beforeEnd('generation');if(!active||terminal)return;
    if(!enabled.current||!entry.generationId){retire('disabled','disabled');return;}
    onStatus('loading');
    const next=await bridge.open();
    const release=()=>bridge.release(next.id);
    // A terminal event can precede the IPC reply; never mount its late lease.
    if(!active||terminal){await release();return;}
    if(!enabled.current){retire('disabled','disabled');await release();return;}
    let revision:number,valid:boolean;
    do {revision=authorityRevision;valid=await bridge.validate(next.id).catch(()=>false);}
    while(active&&!terminal&&enabled.current&&valid&&revision!==authorityRevision);
    if(!active||terminal){await release();return;}
    if(!enabled.current){retire('disabled','disabled');await release();return;}
    if(!valid){retire('revoked','revoked');await release();return;}
    if(Date.now()>=next.expiresAt){retire('lease-expired','expired');await release();return;}
    current=next;ready=false;started=Date.now();dispatch=createDispatch(next);receipts.clear();setLease(next);
  };
  disabled.current=()=>retire('disabled','disabled');
  const changed=()=>{authorityRevision++;serial=serial.then(async()=>{
    if(!active||!current)return;
    const captured=current;
    const valid=await bridge.validate(captured.id).catch(()=>false);
    if(active&&current===captured&&!valid)retire('revoked','revoked');
    // A newer catalog entry is for the next opening; the validated lease retains this editor.
  }).catch(()=>{if(active)retire('revoked','revoked');});};
  const message=(event:MessageEvent)=>{
    if(!active||!current||event.source!==frame.current?.contentWindow||event.origin!=='null')return;
    const body=event.data;if(!body||body.readyNonce!==current.readyNonce)return;
    if(body.channel==='bottega:plugin-ready'){ready=true;onStatus('ready');frame.current?.contentWindow?.postMessage({channel:'bottega:plugin-preferences',readyNonce:current.readyNonce,preferences:preferences.current},'*');return;}
    if(body.channel!=='bottega:plugin-request'||typeof body.requestId!=='string'||body.requestId.length>128||!dispatch)return;
    if(Date.now()>=current.expiresAt){retire('lease-expired','expired');return;}
    if(!current.operations.includes(body.operation))return;
    let length:number;try{length=new TextEncoder().encode(JSON.stringify(body)).length;}catch{return;}if(length>1024*1024)return;
    const nonce=current.readyNonce,target=frame.current?.contentWindow;
    let result=receipts.get(body.requestId);if(!result){if(receipts.size>=256)receipts.delete(receipts.keys().next().value!);result=dispatch(body.operation,body.payload);receipts.set(body.requestId,result);}
    void result.then(result=>{if(active&&current?.readyNonce===nonce)target?.postMessage({channel:'bottega:plugin-response',readyNonce:nonce,requestId:body.requestId,result},'*');},error=>{
      if(active&&current?.readyNonce===nonce)target?.postMessage({channel:'bottega:plugin-response',readyNonce:nonce,requestId:body.requestId,error:error instanceof Error?error.message:'PLUGIN_REQUEST_FAILED'},'*');});
  };
  window.addEventListener('message',message);const off=bridge.onChanged(changed);
  void acquire().catch(()=>{if(active&&!terminal)retire('crash','error');});
  const expiry=setInterval(()=>{if(current&&(Date.now()>=current.expiresAt||!ready&&Date.now()-started>15000)){const expired=Date.now()>=current.expiresAt;retire(expired?'lease-expired':'crash',expired?'expired':'error');}},1000);
  return()=>{active=false;disabled.current=null;clearInterval(expiry);off();window.removeEventListener('message',message);void beforeEnd('crash').catch(()=>{});if(current)void bridge.release(current.id);};
 },[entry.id,port,createDispatch,beforeEnd,onStatus]); // eslint-disable-line react-hooks/exhaustive-deps -- Admitted editors keep their opening generation until closed.
 useEffect(()=>{if(!entry.enabled)disabled.current?.();},[entry.enabled]);
 useEffect(()=>{if(lease)frame.current?.contentWindow?.postMessage({channel:'bottega:plugin-preferences',readyNonce:lease.readyNonce,preferences:props.preferences},'*');},[lease,props.preferences]);
 if(!lease)return null;
 // Electron file pages serialize their message origin as null, even when location.origin is file://.
 const hostOrigin=window.location.protocol==='file:'?'null':window.location.origin;
 const url=new URL(lease.url);url.hash=new URLSearchParams({readyNonce:lease.readyNonce,hostOrigin}).toString();
 return <iframe ref={frame} key={lease.id} title={entry.name} src={url.href} sandbox="allow-scripts" className="size-full border-0" referrerPolicy="no-referrer"/>;
}
export const nativePluginEnvironment:PluginSurfaceEnvironment={Surface:NativePluginSurface,recovery:scope=>{
 const target={chatId:scope.chatId,incarnationId:scope.incarnationId,pluginId:scope.pluginId,...(scope.attachmentId?{attachmentId:scope.attachmentId}:{}),...(scope.ownerDeviceId==='local'?{}:{ownerDeviceId:scope.ownerDeviceId})};
 return {read:()=>window.pluginSurfaces!.recovery.read(target),write:source=>window.pluginSurfaces!.recovery.write(target,source),remove:()=>window.pluginSurfaces!.recovery.remove(target)};
}};
