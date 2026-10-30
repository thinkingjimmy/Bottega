/**
 * [INPUT]: Depends on a host dialog ref, current session identity and its fixed Main control command.
 * [OUTPUT]: Provides useWidgetPreviewVisibility with coalesced visible/occluded acknowledgements and complete observer cleanup.
 * [POS]: Host-only demand acknowledgement; Main independently checks window, privacy, lock and source scope.
 */
import {useLayoutEffect} from 'react';
import type {WidgetPreviewControl} from '../../../../../../shared/system-dock/widgets/preview/contracts';
export function useWidgetPreviewVisibility(node:HTMLDivElement|null,sessionId:string|undefined,send:(input:WidgetPreviewControl,quiet?:boolean)=>Promise<unknown>){
 useLayoutEffect(()=>{
  if(!node||!sessionId)return;let frame=0,last:boolean|undefined;
  const update=()=>{frame=0;const rect=node.getBoundingClientRect(),x=Math.min(innerWidth-1,Math.max(0,rect.x+rect.width/2)),y=Math.min(innerHeight-1,Math.max(0,rect.y+rect.height/2)),top=document.elementFromPoint(x,y),visible=document.visibilityState==='visible'&&rect.width>0&&rect.height>0&&Boolean(top&&node.contains(top));if(last!==visible){last=visible;void send({kind:'present',sessionId,visible},true).catch(()=>{});}};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
  const resize=new ResizeObserver(schedule),mutations=new MutationObserver(schedule);resize.observe(node);mutations.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['class','style','hidden','data-state']});document.addEventListener('visibilitychange',schedule);window.addEventListener('resize',schedule);schedule();
  return()=>{if(frame)cancelAnimationFrame(frame);resize.disconnect();mutations.disconnect();document.removeEventListener('visibilitychange',schedule);window.removeEventListener('resize',schedule);void send({kind:'present',sessionId,visible:false},true).catch(()=>{});};
 },[node,sessionId,send]);
}
