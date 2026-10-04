/**
 * [INPUT]: Native source setup, exact eligible Skill catalog, current draft and Project-aware routes.
 * [OUTPUT]: openPluginAuthoring prepares an explicit authoring Skill reference and returns its Chat route.
 * [POS]: Source Chat entry shared by New plugin and Edit source; never submits a model request automatically.
 */
import {readDraftChatId,readComposer,setComposerProject,updateComposer} from "@/lib/chat/state/composer/chat-composer-store";
import {readAgentDraft} from '@/lib/chat-agent-draft/state';
import {builtinAgent} from '../../../../../shared/chat-agent/options';
import {listSkills} from "@/lib/skills/skills-client";
import {chatRoute,draftRoute} from "@/lib/chat/drafts/draft-route";
import type {WorkbenchCopy} from '@ai-chat/ui/lib/workbench-copy';
import "@/lib/apps/plugins-client";
export async function openPluginAuthoring(copy:WorkbenchCopy['guiHistory'],pluginId?:string){
  const bridge=window.pluginSurfaces;if(!bridge)throw new Error(copy.loadFailed);
  const draftId=readDraftChatId(),draft=readComposer(draftId);
  const occupied=draft.draft.files.length>0||draft.draft.richValue.some(node=>node.type!=='text'||node.value.trim());
  if(!pluginId&&occupied)throw new Error(copy.draftBusy);
  const target=pluginId?await bridge.edit(pluginId,occupied?null:draftId):await bridge.newPlugin(draftId);
  if(!target)throw new Error(copy.draftBusy);
  const backend=builtinAgent(readAgentDraft(target.chatId).options.backend);if(!backend)throw new Error(copy.skillMissing);
  if(target.projectId)setComposerProject(target.chatId,target.projectId);
  const scope=target.projectId?{kind:'project' as const,projectId:target.projectId}:{kind:'conversation' as const,conversationId:target.chatId};
  const catalog=await listSkills({scope,backend,planMode:false,forceReload:true});const skill=catalog.skills.find(value=>value.name==='plugin-authoring');
  if(!skill)throw new Error(copy.skillMissing);
  updateComposer(target.chatId,current=>({...current,draft:{...current.draft,richValue:[...current.draft.richValue,
    ...(!current.draft.richValue.some(node=>node.type==='skill'&&node.ref===skill.ref)?[{id:crypto.randomUUID(),type:'skill' as const,ref:skill.ref,name:skill.name,label:skill.displayName??skill.name}]:[]),
    ...(!pluginId?[{id:crypto.randomUUID(),type:'text' as const,value:` ${copy.starterPrompt}\n\n`}]:[]) ]}}));
  return target.projectId?draftRoute(target.projectId):chatRoute(target.chatId);
}
