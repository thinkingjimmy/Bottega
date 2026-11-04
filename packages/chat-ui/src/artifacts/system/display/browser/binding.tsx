/**
 * [INPUT]: Current native consumer and its single mounted-input recovery port.
 * [OUTPUT]: Existing fixed version picker with exact persisted binding requests and original-operation recovery.
 * [POS]: Theme write adaptation; it reuses the native checkpoint writer and existing System journal commands.
 */
import {useState} from "react";
import {systemCheckpointSchema} from "@ai-chat/cloud-protocol/artifacts/design/review";
import type {WorkspaceRead} from "@ai-chat/cloud-protocol/artifacts/design/model";
import type {NativeInputPort} from "../../../native/input";
import {DesignSystemView} from "../../view";
import {emptySystemDraft,type SystemDraft} from "../../model";
export function savedBindingDraft(port:NativeInputPort|null){
  const pending=port?.current.current.pending;if(!pending)return undefined;
  try{const value=JSON.parse(pending);if(value?.kind==="system-binding")return systemCheckpointSchema.parse(value.draft)}catch{/* Other retained operations keep their original recovery owner. */}
  return undefined;
}
export function ThemeBinding({state,viewId,input,flushSource,onBound}:{state:WorkspaceRead;viewId?:string;input():NativeInputPort|null;flushSource():Promise<void>;onBound():Promise<void>}){
  const [draft,setDraft]=useState<SystemDraft>(()=>savedBindingDraft(input())??emptySystemDraft());
  const port=input(),blocked=Boolean(port?.current.current.pending&&!savedBindingDraft(port));
  const save=async(next:SystemDraft)=>{
    const owner=input();if(!owner||owner.current.current.pending&&!savedBindingDraft(owner))throw new Error("Check the original native operation before changing the System");
    if(next.request)await flushSource();
    await owner.update({...owner.current.current,pending:JSON.stringify({kind:"system-binding",draft:next})});setDraft(next);
  };
  return <div className="min-h-0 flex-1 overflow-auto p-5"><DesignSystemView artifactId={state.fence!.id} state={{...state,editable:state.editable&&!blocked}} viewId={viewId} draft={draft} onDraft={save} onCommitted={onBound}/></div>;
}
