/**
 * [INPUT]: Native enabled composer contribution catalog and change notifications.
 * [OUTPUT]: useComposerPlugins exposes the current compiled plugin generation and source reader contract.
 * [POS]: Native Add-menu projection, independent of editor code.
 */
import {useEffect,useState} from 'react';
import type {PluginComposerEntry} from '@ai-chat/chat-ui/plugins/host/contracts';
import "@/lib/apps/plugins-client";
export function useComposerPlugins(){
 const [entries,setEntries]=useState<PluginComposerEntry[]>([]);
 useEffect(()=>{const bridge=window.pluginSurfaces;if(!bridge)return;let active=true;
 const refresh=()=>{void bridge.list().then(values=>{if(active)setEntries(values.map(value=>({id:value.id,name:value.name,enabled:value.enabled,error:value.reason??null,
 generationId:value.activeGenerationId,composer:{id:value.id,title:value.name,icon:value.icon},sourceFormat:value.sourceFormat})));}).catch(()=>{if(active)setEntries([]);});};
 refresh();const off=bridge.onChanged(refresh);return()=>{active=false;off();};},[]);return entries;
}
