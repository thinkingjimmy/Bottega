/**
 * [INPUT]: Depends on current native preview presentation, a clipped host slot and strict Main controls.
 * [OUTPUT]: Provides WidgetPreviewNative with current measured bounds, loading/failure feedback and explicit retry.
 * [POS]: Host chrome; author GUI executes only in its separate sandboxed WebContentsView.
 */
import {useLayoutEffect,useRef} from 'react';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {SettingsButton} from '@/components/settings/settings-layout';
import type {DockDetailPresentation} from '../../../../../../shared/system-dock/widgets/native';
import type {WidgetPreviewControl} from '../../../../../../shared/system-dock/widgets/preview/contracts';
export function WidgetPreviewNative({sessionId,surface,send}:{sessionId:string;surface:DockDetailPresentation;send(input:WidgetPreviewControl,quiet?:boolean):Promise<unknown>}){
 const {t}=useAppTranslation(),slot=useRef<HTMLDivElement>(null);
 const failed=surface.state==='failed';
 useLayoutEffect(()=>{
  const node=slot.current;if(!node||failed)return;let frame=0,last='';
  const update=()=>{frame=0;const rect=node.getBoundingClientRect(),clip=node.closest('[data-preview-scroll]')?.getBoundingClientRect()??rect,x=Math.max(rect.x,clip.x,0),y=Math.max(rect.y,clip.y,44),right=Math.min(rect.right,clip.right,innerWidth),bottom=Math.min(rect.bottom,clip.bottom,innerHeight-44),bounds=right>x&&bottom>y?{x,y,width:right-x,height:bottom-y}:null,key=JSON.stringify(bounds);if(key!==last){last=key;void send({kind:'bounds',sessionId,key:surface.key,bounds},true).catch(()=>{});}};
  const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);},observer=new ResizeObserver(schedule);observer.observe(node);window.addEventListener('resize',schedule);document.addEventListener('scroll',schedule,true);schedule();
  return()=>{if(frame)cancelAnimationFrame(frame);observer.disconnect();window.removeEventListener('resize',schedule);document.removeEventListener('scroll',schedule,true);void send({kind:'bounds',sessionId,key:surface.key,bounds:null},true).catch(()=>{});};
 },[sessionId,surface.key,failed,send]);
 return <div ref={slot} data-native-preview-slot="" data-native-preview-state={surface.state} className="relative h-80 min-h-60 overflow-hidden rounded-lg">
  {surface.state==='failed'?<div role="alert" className="grid gap-3 p-4 text-sm"><p>{t('systemDock.widgets.detailStopped')}</p><SettingsButton variant="outline" onClick={()=>void send({kind:'retry',sessionId,key:surface.key}).catch(()=>{})}>{t('common.retry')}</SettingsButton></div>:surface.state!=='ready'?<p role="status" className="p-4 text-sm">{t('systemDock.widgets.states.loading')}</p>:null}
 </div>;
}
