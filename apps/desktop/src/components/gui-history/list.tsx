/**
 * [INPUT]: Common main-owned App/plugin history, current active CAS identity and five-language workbench copy.
 * [OUTPUT]: GuiHistoryList and PluginHistoryList show available generations and explicit activation/pending failures.
 * [POS]: Shared version list consumed by App settings and plugin details.
 */
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useWorkbenchCopy} from '@ai-chat/ui/lib/workbench-copy';
import type {GuiGenerationsBridge,GuiHistory,GuiOwner} from '@bottega/contracts/plugins/surface/native';
import "@/lib/apps/plugins-client";
type HistoryProps = {owner:GuiOwner;locale:string;bridge?:GuiGenerationsBridge};
export function GuiHistoryList(props:HistoryProps){
  return <GuiHistoryEntries key={`${props.owner.kind}:${props.owner.id}`} {...props}/>;
}
function GuiHistoryEntries({owner,locale,bridge=window.guiGenerations}:HistoryProps){
  const workbench=useWorkbenchCopy(locale),copy=workbench.guiHistory,[history,setHistory]=useState<GuiHistory|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[revision,refresh]=useState(0);
  const scope=`${owner.kind}:${owner.id}`,live=useRef(true),lock=useRef(false);
  useLayoutEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
  useEffect(()=>{let active=true;if(!bridge)return;
    void bridge.history(owner).then(value=>{if(active){setHistory(value);setError('');}},cause=>{if(active)setError(cause instanceof Error?cause.message:copy.loadFailed);});
    return()=>{active=false;};
  },[bridge,scope,revision,copy.loadFailed]);
  if(!bridge)return null;
  const activate=async(generationId:string)=>{
    if(lock.current||!history?.activeGenerationId)return;const expected=history.activeGenerationId;lock.current=true;setBusy(true);setError('');
    try{await bridge.activate(owner,generationId,expected);if(live.current)refresh(value=>value+1);}
    catch(cause){if(live.current)setError(cause instanceof Error?cause.message:String(cause));}
    finally{if(live.current){lock.current=false;setBusy(false);}}
  };
  return <section className="flex flex-col gap-3" aria-label={copy.title} data-gui-history="">
    <div className="flex items-center justify-between gap-3"><h2 className="font-semibold text-sm">{copy.title}</h2><button type="button" disabled={busy} className="text-muted-foreground text-xs hover:text-foreground" onClick={()=>refresh(value=>value+1)}>{copy.refresh}</button></div>
    {(error||history?.error)&&<p role="alert" className="text-destructive text-sm">{error||history?.error}</p>}
    {history&&!history.generations.length&&<p className="text-muted-foreground text-sm">{copy.empty}</p>}
    <ol className="divide-y rounded-lg border">{history?.generations.map(generation=><li key={generation.generationId} data-generation={generation.generationId} className="flex items-center justify-between gap-3 px-4 py-3">
      <div className="min-w-0"><p className="truncate text-sm">{generation.version||generation.generationId.slice(0,14)}{generation.active&&<span className="ml-2 text-muted-foreground text-xs">{copy.current}</span>}{generation.previous&&<span className="ml-2 text-muted-foreground text-xs">{copy.previous}</span>}</p>
        <time className="text-muted-foreground text-xs" dateTime={new Date(generation.createdAt).toISOString()}>{new Date(generation.createdAt).toLocaleString(locale)}</time></div>
      {!generation.active&&<button type="button" className="shrink-0 rounded-md border px-3 py-2 text-xs hover:bg-muted disabled:opacity-50" disabled={busy||!generation.available} onClick={()=>void activate(generation.generationId)}>{busy?copy.switching:copy.activate}</button>}
    </li>)}</ol>
    {history?.pendingGenerationId&&<p className="text-muted-foreground text-xs">{copy.pending}</p>}
  </section>;
}
export function PluginHistoryList({id,locale,onEdit}:{id:string;locale:string;onEdit?():void}){
  const [availability,setAvailable]=useState({id,available:false});
  const copy=useWorkbenchCopy(locale).guiHistory;
  useEffect(()=>{let active=true;const update=()=>{void window.pluginSurfaces?.list().then(items=>{if(active)setAvailable({id,available:items.some(item=>item.id===id)});}).catch(()=>{if(active)setAvailable({id,available:false});});};update();const off=window.pluginSurfaces?.onChanged(update);return()=>{active=false;off?.();};},[id]);
  return availability.id===id&&availability.available?<><GuiHistoryList owner={{kind:'plugin',id}} locale={locale}/>{onEdit&&<button type="button" className="self-start rounded-md border px-3 py-2 text-sm hover:bg-muted" onClick={onEdit}>{copy.edit}</button>}</>:null;
}
