/**
 * [INPUT]: Depends on the fixed Main preview bridge, held candidate/Chat identity and monotonic host snapshots.
 * [OUTPUT]: Provides useWidgetPreviewSession with exact request replay, cancellation, guarded updates and temporary cleanup.
 * [POS]: Main authoring adapter; it stores no executable path, data grant or persistent accepted mapping.
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import type {WidgetPreview} from '../../../../../../shared/system-dock/widgets/authoring';
import type {WidgetPreviewConfiguration,WidgetPreviewControl,WidgetPreviewResult,WidgetPreviewSnapshot} from '../../../../../../shared/system-dock/widgets/preview/contracts';
import {resolvedThemeStore} from '@/lib/appearance/theme';
const snapshotValue=(value:WidgetPreviewResult):value is WidgetPreviewSnapshot=>Boolean(value&&'sessionId'in value);
export function useWidgetPreviewSession(preview:WidgetPreview,chatId:string,targetId:string|undefined,onRemoteClose:()=>void){
 const bridge=window.systemDockSettings!,[snapshot,setSnapshot]=useState<WidgetPreviewSnapshot|null>(null),[loading,setLoading]=useState(true),[failed,setFailed]=useState(false);
 const alive=useRef(false),epoch=useRef(0),current=useRef<WidgetPreviewSnapshot|null>(null),request=useRef<string|null>(null),stopping=useRef(false),remoteClose=useRef(onRemoteClose),theme=useRef(resolvedThemeStore.getSnapshot());
 useEffect(()=>{remoteClose.current=onRemoteClose;},[onRemoteClose]);
 const accept=useCallback((value:WidgetPreviewSnapshot)=>{if(!alive.current||current.current?.sessionId!==value.sessionId||value.revision<current.current.revision)return;current.current=value;theme.current=value.theme;setSnapshot(value);},[]);
 const closeRequest=useCallback(async(id:string)=>{stopping.current=true;try{await bridge.widgetPreviewControl({kind:'close',requestId:id});}finally{stopping.current=false;}},[bridge]);
 const draft=useCallback(async()=>{const value=await bridge.widgetPreviewControl({kind:'draft',previewId:preview.previewId,chatId,...(targetId?{targetId}:{})});if(!value||!('settings'in value))throw new Error('DOCK_PREVIEW_CONFIGURATION_REQUIRED');return value;},[bridge,preview.previewId,chatId,targetId]);
 const start=useCallback(async(mode:'sample'|'real',configuration?:WidgetPreviewConfiguration,requestId:string=crypto.randomUUID())=>{
  const revision=++epoch.current,previous=request.current;setLoading(true);setFailed(false);
  try{
   if(previous&&previous!==requestId)await closeRequest(previous);if(!alive.current||revision!==epoch.current)throw new Error('DOCK_PREVIEW_CLOSED');
   request.current=requestId;current.current=null;setSnapshot(null);const values=configuration??await draft();if(!alive.current||revision!==epoch.current)throw new Error('DOCK_PREVIEW_CLOSED');
   const result=await bridge.widgetPreviewControl({kind:'open',requestId,previewId:preview.previewId,chatId,...(targetId?{targetId}:{}),mode,theme:theme.current,configuration:values});
   if(!alive.current||revision!==epoch.current){void closeRequest(requestId).catch(()=>{});throw new Error('DOCK_PREVIEW_CLOSED');}
   if(!snapshotValue(result))throw new Error('DOCK_PREVIEW_RESPONSE_INVALID');current.current=result;theme.current=result.theme;setSnapshot(result);return result;
  }catch(error){if(alive.current&&revision===epoch.current)setFailed(true);throw error;}finally{if(alive.current&&revision===epoch.current)setLoading(false);}
 },[bridge,chatId,closeRequest,draft,preview.previewId,targetId]);
 const stop=useCallback(async()=>{epoch.current++;const id=request.current;request.current=null;current.current=null;setSnapshot(null);setLoading(false);if(id)await closeRequest(id);},[closeRequest]);
 const control=useCallback(async(input:WidgetPreviewControl,quiet=false)=>{
  const session=current.current;try{const result=await bridge.widgetPreviewControl(input);if(snapshotValue(result)&&current.current?.sessionId===session?.sessionId)accept(result);return result;}
  catch(error){if(!quiet&&alive.current&&current.current?.sessionId===session?.sessionId)setFailed(true);throw error;}
 },[accept,bridge]);
 useEffect(()=>bridge.onWidgetPreviewChanged(value=>{if(!alive.current||value.sessionId!==current.current?.sessionId)return;accept(value);if(value.state==='closed'&&value.reason==='closed'&&!stopping.current)remoteClose.current();}),[accept,bridge]);
 const dispose=useCallback(()=>{alive.current=false;epoch.current++;const id=request.current;request.current=null;current.current=null;if(id)void closeRequest(id).catch(()=>{});},[closeRequest]);
 useEffect(()=>{alive.current=true;let cancelled=false;queueMicrotask(()=>{if(!cancelled)void start('sample').catch(()=>{});});return()=>{cancelled=true;dispose();};},[dispose,start]);
 return{snapshot,loading,failed,start,stop,control,draft};
}
