/**
 * [INPUT]: One fixed System copy, original native owner and authenticated preview lease ports.
 * [OUTPUT]: ReadOnlySystemPreview owns one immutable child lease, App appearance and complete close cleanup.
 * [POS]: Keyed Theme browser child; source changes remount its read-only lifetime.
 */
import {useEffect,useRef,useState} from "react";
import type {WorkspaceRead} from "@ai-chat/cloud-protocol/artifacts/design/model";
import type {ArtifactHost,ArtifactLease} from "../../../context";
import {nativeThemedLease,useNativeTheme} from "../../../native/appearance";
import {systemBrowserCopy} from "./copy";
type Lease=ArtifactLease&{nativeToken:string};
export function ReadOnlySystemPreview({host,state,viewId,systemId}:{host:ArtifactHost;state:WorkspaceRead;viewId?:string;systemId:string}){
  const copy=systemBrowserCopy(host.locale),[lease,setLease]=useState<Lease|null>(null),[failed,setFailed]=useState(false),frame=useRef<HTMLIFrameElement>(null);
  const loaded=useNativeTheme(frame,lease),artifactId=state.fence!.id,{documentId,generation,revision}=state;
  useEffect(()=>{
    let active=true,owned:Lease|null=null;
    if(!host.workspace)return;
    void host.workspace({action:"preview",artifactId,documentId,viewId,generation,targetRevision:revision,systemId}).then(value=>{
      const result=value as Lease;if(!result?.nativeToken)throw new Error("A fixed System needs a read-only native lease");
      owned=result;if(!active){host.release(result);return}setLease(nativeThemedLease(result,host.locale));
    }).catch(()=>{if(active)setFailed(true)});
    return()=>{active=false;if(owned)host.release(owned)};
  },[host,artifactId,documentId,generation,revision,viewId,systemId]);
  if(failed)return <p role="alert" className="p-5 text-sm">{copy.failed}</p>;
  return lease?<iframe ref={frame} title={copy.title} src={lease.url} sandbox={lease.sandbox} referrerPolicy="no-referrer" className="min-h-0 w-full flex-1 border-0" onLoad={()=>{if(frame.current?.contentWindow)lease.mount?.(frame.current.contentWindow);loaded()}}/>:<p role="status" className="p-5 text-sm">…</p>;
}
