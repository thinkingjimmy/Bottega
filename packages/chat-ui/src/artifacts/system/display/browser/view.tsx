/**
 * [INPUT]: Authenticated native consumer, exact copied System bindings and existing workspace lease/release ports.
 * [OUTPUT]: Native System browser with keyed fixed preview identity, keyboard close, locale/theme and child cleanup.
 * [POS]: Shared Theme read-only dialog; no model, source mutation or live System lookup.
 */
import {useState} from "react";
import type {WorkspaceRead} from "@ai-chat/cloud-protocol/artifacts/design/model";
import type {ArtifactHost} from "../../../context";
import {Dialog,DialogContent,DialogTitle} from "@ai-chat/ui/components/ui/dialog";
import {ReadOnlySystemPreview} from "./preview";
import type {NativeInputPort} from "../../../native/input";
import {ThemeBinding,savedBindingDraft} from "./binding";
import {systemBrowserCopy} from "./copy";
export function SystemBrowser({host,state,viewId,open,onOpenChange,input,flushSource,onBound}:{host:ArtifactHost;state:WorkspaceRead;viewId?:string;open:boolean;onOpenChange(open:boolean):void;input():NativeInputPort|null;flushSource():Promise<void>;onBound():Promise<void>}){
  const copy=systemBrowserCopy(host.locale),bindings=state.manifest.systems??[],[systemId,setSystemId]=useState(bindings[0]?.documentId??"");
  const [failed,setFailed]=useState(false);
  const [manage,setManage]=useState(()=>Boolean(savedBindingDraft(input())?.request));
  const changeOpen=(next:boolean)=>{
    const port=input(),draft=savedBindingDraft(port);
    if(!next&&port&&draft&&!draft.request){void port.update({...port.current.current,pending:undefined}).then(()=>onOpenChange(false)).catch(()=>setFailed(true));return}
    onOpenChange(next);
  };
  return <Dialog open={open} onOpenChange={changeOpen}><DialogContent data-system-browser="" className="flex h-[85vh] max-h-[920px] w-[95vw] max-w-[1200px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1200px]">
    <header className="flex min-h-14 shrink-0 items-center gap-3 border-b px-4 pr-12"><DialogTitle className="text-sm">{copy.title}</DialogTitle><span className="text-xs text-muted-foreground">{manage?copy.chooseVersion:copy.readonly}</span>
      {bindings.length>1?<select aria-label={copy.choose} value={systemId} onChange={event=>setSystemId(event.target.value)} className="ml-auto min-h-11 max-w-[45%] rounded-md border bg-background px-2 text-sm">{bindings.map(binding=><option key={binding.documentId} value={binding.documentId}>{binding.documentId} · v{binding.revision}</option>)}</select>:<span className="ml-auto truncate text-xs text-muted-foreground">{systemId} · v{bindings[0]?.revision}</span>}
      <button type="button" className="min-h-11 shrink-0 rounded-md border px-3 text-xs" onClick={()=>setManage(value=>!value)}>{manage?copy.browse:copy.chooseVersion}</button>
    </header>
    {manage?<ThemeBinding state={state} viewId={viewId} input={input} flushSource={flushSource} onBound={onBound}/>:failed?<p role="alert" className="p-5 text-sm">{copy.failed}</p>:!bindings.length?<p className="p-5 text-sm">{copy.empty}</p>:open?<ReadOnlySystemPreview key={JSON.stringify([systemId,state.fence?.id,state.revision,state.generation,viewId])} host={host} state={state} viewId={viewId} systemId={systemId}/>:null}
  </DialogContent></Dialog>;
}
