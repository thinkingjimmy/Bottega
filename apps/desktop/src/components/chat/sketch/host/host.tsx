/**
 * [INPUT]: Stable plugin sessions, native authenticated frames and atomic current-draft attachment custody.
 * [OUTPUT]: SketchHost mounts the generic plugin Surface modal outside route transitions.
 * [POS]: Shell-level host; the complete editor is compiled into the plugin iframe.
 */
import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {PluginSurfaceEnvironmentProvider} from '@ai-chat/chat-ui/plugins/host/context';
import {PluginComposerModal} from '@ai-chat/chat-ui/plugins/host/modal';
import {useAppTranslation} from "@/components/providers/preferences/i18n-provider";
import {composerOwnerValid,subscribeComposer} from "@/lib/chat/state/composer/chat-composer-store";
import {saveComposerPluginAttachment} from '@/lib/chat-composer/plugin/attachment';
import {closeSketch,readSketchSession,subscribeSketchSession} from './controller';
import {nativePluginEnvironment} from './plugin/surface';
export function SketchHost(){
 const session=useSyncExternalStore(subscribeSketchSession,readSketchSession,readSketchSession),{i18n}=useAppTranslation();
 const scope=useMemo(()=>session?{chatId:session.owner.chatId,incarnationId:session.owner.incarnationId??'',ownerDeviceId:session.ownerDeviceId}:null,[session]);
 useEffect(()=>{if(!session)return;return subscribeComposer(session.owner.chatId,()=>{if(!composerOwnerValid(session.owner))closeSketch(session.id);});},[session]);
 useEffect(()=>()=>{const current=readSketchSession();if(current)closeSketch(current.id);},[]);
 if(!session||!scope)return null;
 return <PluginSurfaceEnvironmentProvider value={nativePluginEnvironment}><PluginComposerModal key={session.id} entry={session.entry} scope={scope} locale={i18n.language}
  source={session.source} attachmentId={session.attachmentId} valid={()=>composerOwnerValid(session.owner)}
  commit={(image,source,id)=>saveComposerPluginAttachment(session.owner,image,source,id)} onClosed={reason=>closeSketch(session.id,reason==='saved')}/></PluginSurfaceEnvironmentProvider>;
}
