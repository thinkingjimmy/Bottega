/**
 * [INPUT]: Canonical plugin search, existing Project metadata, native bridge and durable first-send authoring intent.
 * [OUTPUT]: WorkObjectMenuContent with grouped search and lazy source selection that creates no Project.
 * [POS]: On-demand work-object popover content; persistent trigger and RichInput remain outside this module.
 */
import {useState} from 'react';
import {Folder,MessageSquare,Plus,Puzzle} from 'lucide-react';
import {Button} from '@ai-chat/ui/components/ui/button';
import {Input} from '@ai-chat/ui/components/ui/input';
import {useAppTranslation} from '@/components/providers/preferences/i18n-provider';
import {pluginPlatformBridge,editablePlugin} from '@/lib/plugin-platform/client';
import {useUnifiedPluginIndex} from '@/lib/plugin-platform/projection/runtime';
import {usePluginSearch} from '@/lib/plugin-platform/projection/search';
import {pluginPickerCopy} from '@/lib/plugin-platform/picker-copy';
import {updateAgentDraft} from '@/lib/chat-agent-draft/state';
import {updateComposer} from '@/lib/chat/state/composer/chat-composer-store';
import type {ChatSessionController} from '../../../runtime/use-chat-session';
export function WorkObjectMenuContent({controller,remote,onClose}:{controller:ChatSessionController['composer'];remote:boolean;onClose:()=>void}){
  const {i18n}=useAppTranslation(),copy=pluginPickerCopy(i18n.language),{items:plugins,error,busy}=useUnifiedPluginIndex();
  const [query,setQuery]=useState(''),[failed,setFailed]=useState(''),needle=query.trim().toLocaleLowerCase(),search=usePluginSearch(query,true),sourcePlugins=needle?search.items:plugins;
  const sources=sourcePlugins.filter(item=>editablePlugin(item)&&item.manifest.name.toLocaleLowerCase().includes(needle));
  const projects=controller.projects.filter(item=>!item.archivedAt&&item.name.toLocaleLowerCase().includes(needle)&&!plugins.some(plugin=>plugin.sourceProject?.projectId===item.id));
  const chooseObject=(pluginId?:string)=>{const plugin=sourcePlugins.find(item=>item.manifest.id===pluginId);
    if(!plugin)updateAgentDraft(controller.chatId,current=>({...current,options:{...current.options,mode:{id:'create',name:copy.create}}}));
    updateComposer(controller.chatId,current=>({...current,projectId:plugin?.sourceProject?.projectId??null,pluginAuthoring:{operationId:crypto.randomUUID(),kind:plugin?'plugin':'new-plugin',...(plugin?{pluginId:plugin.manifest.id}:{}),displayName:plugin?.manifest.name??copy.newPlugin}}));onClose();};
  const chooseProject=(id:string|null)=>{updateComposer(controller.chatId,current=>({...current,pluginAuthoring:undefined}));controller.selectProject(id);onClose();};
  return <><Input aria-label={copy.search} placeholder={copy.search} value={query} onChange={event=>setQuery(event.target.value)} autoFocus className="mb-2 h-8 text-xs"/>
    <div className="max-h-72 overflow-y-auto"><p className="px-2 py-1 text-xs text-muted-foreground">{copy.projects}</p>{projects.map(project=><Button key={project.id} variant="ghost" className="w-full justify-start gap-2" disabled={project.missing} onClick={()=>chooseProject(project.id)}><Folder className="size-4"/><span className="truncate">{project.name}</span></Button>)}
      <p className="px-2 py-1 text-xs text-muted-foreground">{copy.plugins}</p>{sources.map(plugin=><Button key={plugin.manifest.id} variant="ghost" className="w-full justify-start gap-2" disabled={remote||plugin.directory.missing} title={remote?copy.localOnly:plugin.directory.missing?copy.sourceMissing:undefined} onClick={()=>chooseObject(plugin.manifest.id)}><Puzzle className="size-4"/><span className="truncate">{plugin.manifest.name}</span><span className="ml-auto text-[11px] text-muted-foreground">{copy.source}</span></Button>)}
      {!projects.length&&!sources.length&&!busy&&<p className="p-2 text-xs text-muted-foreground">{copy.empty}</p>}{needle&&search.page?.nextCursor&&<Button variant="ghost" className="w-full" disabled={search.busy} onClick={()=>void search.loadMore()}>{copy.more}</Button>}</div>
    {(error||search.error||failed)&&<p role="alert" className="p-2 text-xs text-destructive">{failed||copy.loadFailed}</p>}
    <div className="mt-1 border-t pt-1"><Button variant="ghost" className="w-full justify-start gap-2" onClick={()=>{onClose();void controller.createProject().catch(cause=>setFailed(String(cause)));}}><Plus className="size-4"/>{copy.newProject}</Button>
      <Button variant="ghost" className="w-full justify-start gap-2" disabled={remote||!pluginPlatformBridge()} title={remote?copy.localOnly:undefined} onClick={()=>chooseObject()}><Plus className="size-4"/>{copy.newPlugin}</Button><Button variant="ghost" className="w-full justify-start gap-2" onClick={()=>chooseProject(null)}><MessageSquare className="size-4"/>{copy.workInChat}</Button></div>
  </>;
}
