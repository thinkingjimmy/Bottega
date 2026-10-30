/**
 * [INPUT]: Depends on canonical Chat persistence, Home ownership, Project serialization and the default Agent identity.
 * [OUTPUT]: Provides idempotent notice-only Dock authoring Chat creation with outcome-aware recovery.
 * [POS]: Source Chat lifecycle collaborator; source allocation and plugin ownership remain with the plugin owner.
 */
import {randomUUID} from 'node:crypto';
import {DEFAULT_PROVIDER_ID} from '../../../../../shared/providers/catalog';
import type {ChatRecord} from '../../../../../shared/ipc/content/chats-ipc';
import type {ChatHomeService} from '../../../chat-home/chat-home-service';
import {isChatMutationOutcomeUnknown,type ChatStore,type ChatMessageMutation} from '../../chat-store';
export type SourceChatInput=Readonly<{intentId:string;id:string;pluginId:string;projectId:string;title:string}>;
type Ports={store:Pick<ChatStore,'getConversation'|'create'>;homes:Pick<ChatHomeService,'assertCanCreateChat'|'beginCreation'|'markPrepared'|'commitCreation'|'rollbackCreation'>|undefined;
  withProject<T>(id:string,work:()=>Promise<T>):Promise<T>;assertProject(id:string):Promise<void>;publish(mutation:ChatMessageMutation):void};
export async function createSourceChat(ports:Ports,input:SourceChatInput):Promise<ChatRecord>{
  const homes=ports.homes;if(!homes)throw new Error('CHAT_HOME_UNAVAILABLE');homes.assertCanCreateChat();
  const result=await ports.withProject(input.projectId,async()=>{
    await ports.assertProject(input.projectId);
    const home=await homes.beginCreation({intentId:input.intentId,chatId:input.id,submission:input,workspaceScope:{kind:'project',projectId:input.projectId}});
    try{
      await homes.markPrepared(input.id);const existing=await ports.store.getConversation(input.id);
      if(existing){
        const first=existing.messages[0];
        if(existing.projectId!==input.projectId||first?.role!=='notice'||first.notice.kind!=='plugin-chat-ready'||first.notice.pluginId!==input.pluginId)throw new Error('SOURCE_CHAT_IDENTITY_CHANGED');
        await homes.commitCreation(input.id);return{record:existing,mutation:null};
      }
      const mutation=await ports.store.create(input.id,{id:`notice_${randomUUID().replaceAll('-','')}`,role:'notice',content:'Widget authoring session is ready.',createdAt:Date.now(),seq:1,
        notice:{kind:'plugin-chat-ready',pluginId:input.pluginId,target:'dock'}},input.projectId,DEFAULT_PROVIDER_ID,
        {incarnationId:home.incarnationId,homeDir:home.homeDir,title:input.title,dormantNotice:true});
      await homes.commitCreation(input.id);return{record:mutation.record,mutation};
    }catch(error){if(!isChatMutationOutcomeUnknown(error))await homes.rollbackCreation(input.id);throw error;}
  });
  if(result.mutation)ports.publish(result.mutation);return result.record;
}
