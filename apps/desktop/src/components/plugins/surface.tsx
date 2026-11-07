/**
 * [INPUT]: Canonical immutable Surface leases, bounded main RPC and host theme/configuration.
 * [OUTPUT]: IsolatedPluginSurface with source-bound messaging, exact activation/revision reloading, stale catalog-read fencing, lease expiry and deterministic release.
 * [POS]: Shared page/composer/Widget host; isolation provides stability without a false permission boundary.
 */
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from 'react';
import type { UnifiedPluginSurfaceDescriptor } from '@bottega/contracts/plugins/platform';
import { Button } from '@ai-chat/ui/components/ui/button';
import { pluginPlatformBridge } from '@/lib/plugin-platform/client';
import { pluginPlatformCopy } from '@/lib/plugin-platform/copy';
const themeKeys=['--background','--foreground','--card','--card-foreground','--popover','--popover-foreground','--primary','--primary-foreground','--secondary','--secondary-foreground','--muted','--muted-foreground','--accent','--accent-foreground','--destructive','--border','--input','--ring','--radius'];
const theme=()=>{const style=getComputedStyle(document.documentElement);return Object.fromEntries(themeKeys.map(key=>[key,style.getPropertyValue(key).trim()]));};
export function IsolatedPluginSurface({pluginId,contributionId,instanceId,configuration={},locale='en',className='size-full',title,onFailure}:{pluginId:string;contributionId:string;instanceId?:string;configuration?:Readonly<Record<string,unknown>>;locale?:string;className?:string;title:string;onFailure?:(error:string)=>void}){
  const bridge=pluginPlatformBridge(),copy=pluginPlatformCopy(locale),frame=useRef<HTMLIFrameElement>(null),[lease,setLease]=useState<UnifiedPluginSurfaceDescriptor|null>(null),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  const surfaceFailure=useRef<(leaseId:string,message:string)=>void>(()=>undefined);
  const configurationRef=useRef(configuration);useLayoutEffect(()=>{configurationRef.current=configuration;},[configuration]);
  const failRef=useRef(onFailure);useLayoutEffect(()=>{failRef.current=onFailure;},[onFailure]);
  const sendContext=useCallback(()=>frame.current?.contentWindow?.postMessage({type:'bottega-plugin-context',configuration:configurationRef.current,theme:theme()},'*'),[]);
  useEffect(()=>{
    if(!bridge)return;
    let live=true,request=0,current:UnifiedPluginSurfaceDescriptor|null=null,pending=0,expiry:ReturnType<typeof setTimeout>|undefined;
    const receipts=new Map<string,Promise<unknown>>();
    const release=(value:UnifiedPluginSurfaceDescriptor|null)=>{if(value)void bridge.releaseSurface({leaseId:value.id}).catch(()=>undefined);};
    const fail=(leaseId:string,message:string)=>{if(!live||current?.id!==leaseId)return;clearTimeout(expiry);release(current);current=null;setLease(null);setError(message);failRef.current?.(message);};surfaceFailure.current=fail;
    const acquire=async()=>{const generation=++request;try{const next=await bridge.openSurface({pluginId,contributionId,...(instanceId?{instanceId}:{})});if(!live||generation!==request){release(next);return;}clearTimeout(expiry);release(current);current=next;receipts.clear();setLease(next);setError('');expiry=setTimeout(()=>fail(next.id,copy.pageUnavailable),Math.max(1,next.expiresAt-Date.now()));}
      catch(cause){if(live&&generation===request){clearTimeout(expiry);release(current);current=null;setLease(null);const message=cause instanceof Error?cause.message:String(cause);setError(message);failRef.current?.(message);}}};
    const message=(event:MessageEvent)=>{
      if(!live||!current||event.source!==frame.current?.contentWindow||event.origin!=='null')return;
      const body=event.data;if(!body||body.type!=='bottega-plugin-rpc'||body.pluginId!==pluginId||body.contributionId!==contributionId||typeof body.requestId!=='string'||body.requestId.length>128||typeof body.method!=='string'||body.method.length>160)return;
      let size;try{size=new TextEncoder().encode(JSON.stringify(body)).byteLength;}catch{return;}if(size>1024*1024||pending>=32)return;
      const admitted=current,target=frame.current.contentWindow;
      let result=receipts.get(body.requestId);if(!result){pending++;result=bridge.call({leaseId:admitted.id,method:body.method,input:body.input}).finally(()=>pending--);if(receipts.size>=256)receipts.delete(receipts.keys().next().value!);receipts.set(body.requestId,result);}
      void result.then(result=>{if(live&&current===admitted)target?.postMessage({type:'bottega-plugin-rpc-result',requestId:body.requestId,result},'*');},cause=>{if(live&&current===admitted)target?.postMessage({type:'bottega-plugin-rpc-result',requestId:body.requestId,error:cause instanceof Error?cause.message:String(cause)},'*');});
    };
    window.addEventListener('message',message);const stop=bridge.onChanged(()=>{const admitted=current;void bridge.get(pluginId).then(item=>{if(!live||current!==admitted)return;if(admitted&&item?.runtimeReady&&item.activeRevision===admitted.generationId&&item.activationId===admitted.activationId)return;void acquire();},()=>{if(live&&current===admitted)void acquire();});});void acquire();
    const observer=new MutationObserver(sendContext);observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
    return()=>{live=false;request++;clearTimeout(expiry);if(surfaceFailure.current===fail)surfaceFailure.current=()=>undefined;stop();observer.disconnect();window.removeEventListener('message',message);release(current);};
  },[bridge,pluginId,contributionId,instanceId,attempt,copy.unavailable,copy.pageUnavailable,sendContext]);
  useEffect(sendContext,[configuration,sendContext]);
  if(!bridge||error)return <div className="flex size-full min-h-32 flex-col items-center justify-center gap-3 p-5 text-center" role="alert"><p className="max-w-lg text-sm text-muted-foreground">{copy.pageUnavailable}</p><p className="max-w-lg break-words text-xs text-destructive">{error||copy.unavailable}</p><Button variant="outline" onClick={()=>setAttempt(value=>value+1)}>{copy.retry}</Button></div>;
  if(!lease)return <div className="grid size-full min-h-24 place-items-center text-xs text-muted-foreground" role="status">{copy.loading}</div>;
  return <iframe ref={frame} key={lease.id} src={lease.url} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" className={`${className} border-0`} onLoad={sendContext} onError={()=>surfaceFailure.current(lease.id,copy.pageUnavailable)}/>;
}
