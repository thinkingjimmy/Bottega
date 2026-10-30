/**
 * [INPUT]: Depends on the trusted native presentation key, ResizeObserver and fixed panel intents.
 * [OUTPUT]: Provides a bounded native detail slot, honest loading/failure states and explicit host Retry.
 * [POS]: Host chrome only; author code runs in a separate native WebContentsView inside the measured slot.
 */
import {useLayoutEffect,useRef} from 'react';
import type {DockDetailPresentation} from '../../../../../../shared/system-dock/widgets/native';
import {usePanel} from '../../../context';
export function NativeWidgetSlot({itemId,surface}:{itemId:string;surface:DockDetailPresentation}){
 const {send,t}=usePanel(),slot=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{
  const node=slot.current;if(!node||surface.state==='failed')return;
  const update=()=>{const rect=node.getBoundingClientRect();if(rect.width>0&&rect.height>0)send({kind:'widget-detail-slot',itemId,key:surface.key,bounds:{x:rect.x,y:rect.y,width:rect.width,height:rect.height}});};
  const observer=new ResizeObserver(update);observer.observe(node);window.addEventListener('resize',update);update();return()=>{observer.disconnect();window.removeEventListener('resize',update);};
 },[itemId,surface.key,surface.state,send]);
 return <div ref={slot} data-native-widget-slot="" data-native-widget-state={surface.state} style={{position:'relative',flex:1,minHeight:0,margin:8,overflow:'hidden'}}>
  {surface.state==='failed'?<div className="empty-state" role="alert"><p>{t('systemDock.widgets.detailStopped')}</p><button type="button" className="button" onClick={()=>send({kind:'widget-detail-retry',itemId,key:surface.key})}>{t('common.retry')}</button></div>
   :surface.state!=='ready'?<p className="empty-state" role="status">{t('systemDock.widgets.states.loading')}</p>:null}
 </div>;
}
