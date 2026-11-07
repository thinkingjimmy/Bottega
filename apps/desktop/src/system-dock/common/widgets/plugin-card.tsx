/**
 * [INPUT]: Exact item-bound Dock Surface RPC, immutable plugin face, current live-authority flag, host-localized status text and current visibility/theme.
 * [OUTPUT]: Bounded opaque plugin card with at most eight pending calls, stable activation/revision identity and deterministic lease release, including same-revision authority revocation.
 * [POS]: Lazy Dock-only frame; the resident bar keeps its cheap host summary unless the declaration requests a custom card.
 */
import { useCallback,useEffect,useLayoutEffect,useRef,useState,type ReactNode } from 'react';
import type { PluginSurfaceDescriptor } from '@bottega/contracts/plugins/surface/native';
import type { CustomWidgetFace } from '../../../../shared/system-dock/widgets/runtime';
import '../bridge';
type Plugin=NonNullable<CustomWidgetFace['plugin']>;
const descriptor=(value:unknown):value is PluginSurfaceDescriptor=>{const item=value as Partial<PluginSurfaceDescriptor>|null;return!!item&&typeof item==='object'&&typeof item.url==='string'&&typeof item.id==='string'&&item.sandbox==='allow-scripts';};
const cssTheme=()=>{const css=getComputedStyle(document.documentElement),read=(key:string,fallback:string)=>css.getPropertyValue(key).trim()||fallback,surface=read('--surface-solid','#202024'),text=read('--text','#f2f2f2'),raised=read('--surface-raised','#303034');return{'--background':surface,'--foreground':text,'--card':raised,'--card-foreground':text,'--muted':raised,'--muted-foreground':read('--muted','#999999'),'--border':read('--line','#444444'),'--primary':read('--accent','#8dafff'),'--primary-foreground':surface,'--radius':'0.5rem'};};
export function PluginDockCard({itemId,plugin,title,unavailable,fallback=null}:{itemId:string;plugin:Plugin;title:string;unavailable:string;fallback?:ReactNode}){
  const slot=useRef<HTMLDivElement>(null),frame=useRef<HTMLIFrameElement>(null),pluginRef=useRef(plugin),[visible,setVisible]=useState(false),[lease,setLease]=useState<PluginSurfaceDescriptor|null>(null),[failed,setFailed]=useState(false);
  const scope=JSON.stringify([visible,plugin.customCard,itemId,plugin.pluginId,plugin.contributionId,plugin.instanceId,plugin.revision,plugin.activationId]),[seenScope,setSeenScope]=useState(scope);
  if(scope!==seenScope){setSeenScope(scope);setLease(null);setFailed(false);}
  useLayoutEffect(()=>{pluginRef.current=plugin;},[plugin]);
  const context=useCallback(()=>{frame.current?.contentWindow?.postMessage({type:'bottega-plugin-context',configuration:pluginRef.current.configuration,theme:cssTheme()},'*');},[]);
  useEffect(()=>{const node=slot.current;if(!node)return;let intersects=false;const update=()=>setVisible(intersects&&document.visibilityState!=='hidden');const observer=new IntersectionObserver(entries=>{intersects=entries.some(entry=>entry.isIntersecting);update();});observer.observe(node);document.addEventListener('visibilitychange',update);return()=>{observer.disconnect();document.removeEventListener('visibilitychange',update);};},[]);
  useEffect(()=>{
    const bridge=window.systemDock;if(!visible||!plugin.customCard||!bridge)return;
    let live=true,current:PluginSurfaceDescriptor|null=null,pending=0,expiry:ReturnType<typeof setTimeout>|undefined;const receipts=new Map<string,Promise<unknown>>();
    const release=(value:PluginSurfaceDescriptor|null)=>{if(value)void bridge.pluginSurface({kind:'release',itemId,leaseId:value.id}).catch(()=>undefined);};
    const message=(event:MessageEvent)=>{const body=event.data;if(!live||!current||event.source!==frame.current?.contentWindow||event.origin!=='null'||!body||body.type!=='bottega-plugin-rpc'||body.pluginId!==plugin.pluginId||body.contributionId!==plugin.contributionId||typeof body.requestId!=='string'||body.requestId.length>128||typeof body.method!=='string'||body.method.length>128)return;
      let bytes;try{bytes=new TextEncoder().encode(JSON.stringify(body)).byteLength;}catch{return;}if(bytes>65536||pending>=8)return;
      const admitted=current,target=frame.current.contentWindow;let answer=receipts.get(body.requestId);
      if(!answer){pending++;answer=bridge.pluginSurface({kind:'call',itemId,leaseId:admitted.id,method:body.method,input:body.input}).finally(()=>pending--);if(receipts.size>=64)receipts.delete(receipts.keys().next().value!);receipts.set(body.requestId,answer);}
      void answer.then(result=>{if(live&&current===admitted)target?.postMessage({type:'bottega-plugin-rpc-result',requestId:body.requestId,result},'*');},cause=>{if(live&&current===admitted)target?.postMessage({type:'bottega-plugin-rpc-result',requestId:body.requestId,error:cause instanceof Error?cause.message:String(cause)},'*');});
    };
    window.addEventListener('message',message);
    void bridge.pluginSurface({kind:'open',itemId}).then(value=>{if(!descriptor(value))throw new Error('Plugin surface unavailable');if(!live){release(value);return;}current=value;setLease(value);setFailed(false);expiry=setTimeout(()=>{if(live){release(current);current=null;setLease(null);setFailed(true);}},Math.max(1,value.expiresAt-Date.now()));},()=>{if(live)setFailed(true);}).catch(()=>{if(live)setFailed(true);});
    const observer=new MutationObserver(context);observer.observe(document.documentElement,{attributes:true,attributeFilter:['class','style','data-theme']});
    return()=>{live=false;clearTimeout(expiry);observer.disconnect();window.removeEventListener('message',message);release(current);};
  },[visible,itemId,plugin.pluginId,plugin.contributionId,plugin.instanceId,plugin.revision,plugin.activationId,plugin.customCard,context]);
  useEffect(context,[context,plugin.configuration]);
  return <div ref={slot} data-plugin-dock-card={itemId} style={{width:'100%',height:'100%',minHeight:0,overflow:'hidden',borderRadius:'inherit'}}>{failed||!plugin.customCard?<div role="status" title={unavailable} style={{width:'100%',height:'100%',display:'grid',placeItems:'center'}}>{fallback??unavailable}</div>:visible&&lease?<iframe ref={frame} key={lease.id} src={lease.url} title={title} sandbox="allow-scripts" referrerPolicy="no-referrer" style={{display:'block',width:'100%',height:'100%',border:0}} onLoad={context} onError={()=>{setFailed(true);if(lease)void window.systemDock?.pluginSurface({kind:'release',itemId,leaseId:lease.id}).catch(()=>undefined);setLease(null);}}/>:fallback}</div>;
}
