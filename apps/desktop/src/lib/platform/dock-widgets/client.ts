/**
 * [INPUT]: Depends on React, the fixed main-window Dock bridge and canonical Chat routes.
 * [OUTPUT]: Provides cancellable definition snapshots and source-Chat routing without starting an Agent.
 * [POS]: Renderer Dock authoring adapter shared by Settings and the source Chat header.
 */
import {useEffect,useState,useCallback} from 'react';
import type {WidgetManagementSnapshot,WidgetAuthoringTarget} from '../../../../shared/system-dock/widgets/authoring';
import {chatRoute} from '../../chat/drafts/draft-route';
import '../system-dock-settings-client';
export const widgetAuthoringRoute=(target:Pick<WidgetAuthoringTarget,'chatId'>)=>chatRoute(target.chatId);
export function useDockWidgets(){
  const [snapshot,setSnapshot]=useState<WidgetManagementSnapshot|null>(null),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0);
  const refresh=useCallback(()=>setRevision(value=>value+1),[]);
  useEffect(()=>{
    const bridge=window.systemDockSettings;if(!bridge?.widgetSnapshot)return;let active=true,request=0;
    const load=()=>{const current=++request;void bridge.widgetSnapshot().then(value=>{if(active&&current===request){setSnapshot(value);setFailed(false);}},()=>{if(active&&current===request)setFailed(true);});};
    load();const stop=bridge.onWidgetsChanged?.(load);return()=>{active=false;stop?.();};
  },[revision]);
  return{snapshot,failed,refresh};
}
