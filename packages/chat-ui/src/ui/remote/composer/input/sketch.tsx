/**
 * [INPUT]: Owner-device plugin catalog, isolated Surface environment and current remote draft custody.
 * [OUTPUT]: useRemoteSketch opens generic composer plugins and atomically retains PNG plus opaque source.
 * [POS]: Web/remote composer adapter; author UI executes only inside its owning device's compiled frame.
 */
import {useEffect,useRef,useState} from 'react';
import type {RemoteDraftStore} from '../../../../platform/remote/input/draft';
import type {PluginComposerEntry,PluginHostScope} from '../../../../plugins/host/contracts';
import {PluginComposerModal} from '../../../../plugins/host/modal';
import {usePluginSurfaceEnvironment} from '../../../../plugins/host/context';
import {pluginSourceEditable} from '@bottega/contracts/plugins/surface/source';
export function useRemoteSketch(store:RemoteDraftStore,locale:string,lifetime:AbortSignal|undefined,input:{entries:readonly PluginComposerEntry[];scope:PluginHostScope}){
 const environment=usePluginSurfaceEnvironment(),active=useRef<RemoteDraftStore|null>(store);
 const [session,setSession]=useState<{id:string;entry:PluginComposerEntry;scope:PluginHostScope;attachmentId?:string;anchor:HTMLElement|null;file?:File}|null>(null);
 const [owner,setOwner]=useState({store,lifetime,scope:input.scope});
 if(owner.store!==store||owner.lifetime!==lifetime||owner.scope!==input.scope){setOwner({store,lifetime,scope:input.scope});setSession(null);}
 useEffect(()=>{active.current=store;const abort=()=>{active.current=null;setSession(null);};lifetime?.addEventListener('abort',abort,{once:true});
 return()=>{active.current=null;lifetime?.removeEventListener('abort',abort);};},[store,lifetime]);
 const editable=(id:string)=>{const source=store.snapshot().files.find(file=>file.id===id)?.pluginSource;
 const entry=input.entries.find(entry=>entry.id===source?.pluginId);
 return Boolean(environment&&source&&entry?.enabled&&entry.generationId&&pluginSourceEditable(source,{pluginId:entry.id,format:entry.sourceFormat}));};
 const currentEntry=session ? input.entries.find(value=>value.id===session.entry.id) ?? {...session.entry,enabled:false} : null;
 const open=(entry:PluginComposerEntry,anchor:HTMLElement|null,attachmentId?:string)=>{
 if(!environment||!entry.enabled||!entry.generationId)return;
 if(attachmentId&&!editable(attachmentId))return;
 const file=store.snapshot().files.find(file=>file.id===attachmentId);
 setSession({id:crypto.randomUUID(),entry,scope:input.scope,attachmentId,anchor,file:file?.file});};
 const close=()=>{const anchor=session?.anchor;setSession(null);queueMicrotask(()=>anchor?.isConnected&&anchor.focus());};
 const valid=()=>active.current===store&&!lifetime?.aborted&&(!session?.attachmentId||store.snapshot().files.some(file=>file.id===session.attachmentId&&file.file===session.file));
 return {open,edit:(anchor:HTMLElement,id:string)=>{const source=store.snapshot().files.find(file=>file.id===id)?.pluginSource;
 const entry=input.entries.find(entry=>entry.id===source?.pluginId);if(entry)open(entry,anchor,id);},editable,available:Boolean(environment),active:Boolean(session),preload:()=>{},
 dialog:session&&currentEntry?<PluginComposerModal key={session.id} entry={currentEntry} scope={session.scope} locale={locale} attachmentId={session.attachmentId}
 source={store.snapshot().files.find(file=>file.id===session.attachmentId)?.pluginSource} valid={valid}
 commit={(image,source,id)=>{if(!valid())throw Error('PLUGIN_OWNER_EXPIRED');return store.addPlugin(image,source,id);}} onClosed={close}/>:null};
}
