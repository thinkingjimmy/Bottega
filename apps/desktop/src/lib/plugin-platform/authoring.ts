/**
 * [INPUT]: Existing composer and Agent draft stores plus canonical plugin identities.
 * [OUTPUT]: Lazy source authoring intent and Create mode on an unsent Chat without allocating a source directory or Project.
 * [POS]: New Chat, plugin details and Widget Edit share this entry; first-send submission owns allocation.
 */
import { readDraftChatId, updateComposer } from '@/lib/chat/state/composer/chat-composer-store';
import { readAgentDraft, updateAgentDraft } from '@/lib/chat-agent-draft/state';
import { chatRoute, draftRoute } from '@/lib/chat/drafts/draft-route';
import { pluginPlatformBridge,editablePlugin } from './client';
import { pluginPlatformCopy } from './copy';
import type { PluginAuthoringIntent } from '@/lib/chat/state/composer/model';
export async function pluginAuthoringDraft(input:{pluginId?:string;copy?:boolean;instanceId?:string;name?:string},locale='en'){
  const bridge=pluginPlatformBridge(),copy=pluginPlatformCopy(locale);if(!bridge)throw new Error(copy.localOnly);
  const chatId=readDraftChatId(),agent=readAgentDraft(chatId);
  if(agent.canonical)throw new Error(copy.unavailable);
  const plugin=input.pluginId?await bridge.get(input.pluginId):null;
  if(input.pluginId&&(!plugin||!editablePlugin(plugin)))throw new Error(copy.unavailable);
  const intent:PluginAuthoringIntent={operationId:crypto.randomUUID(),kind:input.pluginId?'plugin':'new-plugin',
    ...(input.pluginId?{pluginId:input.pluginId}:{}),...(input.copy?{copy:true}:{}),...(input.instanceId?{instanceId:input.instanceId}:{}),
    ...(input.name?{name:input.name}:{}),displayName:plugin?.manifest.name??copy.newPlugin};
  updateAgentDraft(chatId,current=>({...current,options:{...current.options,mode:{id:'create',name:copy.create}}}));
  updateComposer(chatId,current=>({...current,projectId:null,pluginAuthoring:intent}));
  return chatId===readDraftChatId()?draftRoute():chatRoute(chatId);
}

/** Resolves only exact declared Widget identities; ambiguous short contribution ids never select another plugin's source. */
export async function widgetPluginAuthoringDraft(definitionId:string|undefined,locale:string,instanceId?:string,copy=false){
  if(!definitionId)return pluginAuthoringDraft({},locale);
  const bridge=pluginPlatformBridge();if(!bridge)throw new Error(pluginPlatformCopy(locale).localOnly);
  const matches=[];let cursor:string|undefined;
  do{const page=await bridge.list({limit:100,...(cursor?{cursor}:{})});
    const candidates=await Promise.all(page.items.filter(item=>item.manifest.contributionKinds.includes('widget')).map(item=>bridge.get(item.manifest.id)));
    for(const plugin of candidates){if(!plugin)continue;const widgets=plugin.manifest.contributions.filter(item=>item.kind==='widget');
      if(widgets.some(item=>definitionId===`${plugin.manifest.id}.${item.id}`||definitionId===`${plugin.manifest.id}:${item.id}`)||(widgets.length===1&&definitionId===plugin.manifest.id))matches.push(plugin);
    }cursor=page.nextCursor;
  }while(cursor);
  if(matches.length!==1)throw new Error(pluginPlatformCopy(locale).sourceMissing);
  return pluginAuthoringDraft({pluginId:matches[0]!.manifest.id,copy,instanceId},locale);
}
