/**
 * [INPUT]: Authenticated plugin head subscription, verified encrypted-file reader and current account/key admission.
 * [OUTPUT]: Verified bytes pinned after admission until the existing gateway deadline; authority loss still revokes immediately.
 * [POS]: Remote native Surface admission; never resolves plugin IDs through the local plugin runtime.
 */
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { pluginSurfaceSubjectSchema, type PluginSurfaceHead, type PluginSurfaceSubject } from "@ai-chat/cloud-protocol/surfaces/plugin/model";
import { loadSurfaceGeneration, type SurfaceFileReader } from "@ai-chat/cloud-protocol/surfaces/plugin/loading";
export type RemoteSurfacePorts = {
  head(subject:PluginSurfaceSubject):Promise<PluginSurfaceHead|null>;
  watch(subject:PluginSurfaceSubject,changed:(head:PluginSurfaceHead|null)=>void,failed:(error:unknown)=>void):()=>void;
  read:SurfaceFileReader; current():void; own(activity:{close():Promise<void>}):()=>void;
};
export async function openPublishedPluginSurface(raw:PluginSurfaceSubject,ports:RemoteSurfacePorts,invalidated:()=>void){
  const subject=pluginSurfaceSubjectSchema.parse(raw),abort=new AbortController();
  let closed=false,ready=false,stopWatch=()=>{},releaseOwner=()=>{};
  const close=()=>{if(closed)return;closed=true;abort.abort();stopWatch();releaseOwner();};
  const revoke=()=>{if(closed)return;close();invalidated();};
  const current=()=>{abort.signal.throwIfAborted();ports.current();};
  try{
    current();releaseOwner=ports.own({close:async()=>revoke()});
    const head=await ports.head(subject);current();
    if(!head||canonicalJson(head.subject)!==canonicalJson(subject))throw new Error("surface-subject-mismatch");
    if(head.state!=="published")throw new Error("surface-revoked");
    const matches=(value:PluginSurfaceHead|null)=>value?.state==="published" && canonicalJson(value.subject)===canonicalJson(subject) &&
      value.generationId===head.generationId && value.artifactDigest===head.artifactDigest && value.revision===head.revision;
    const admissible=(value:PluginSurfaceHead|null)=>value?.state==="published" && canonicalJson(value.subject)===canonicalJson(subject) &&
      (value.generationId!==head.generationId || value.artifactDigest===head.artifactDigest);
    stopWatch=ports.watch(subject,value=>{if(!(ready?admissible(value):matches(value)))revoke();},revoke);
    if(closed)stopWatch();
    const loaded=await loadSurfaceGeneration(head,ports.read,abort.signal);current();
    if(!matches(await ports.head(subject)))throw new Error("surface-generation-changed");current();
    ready=true;
    return {...loaded,files:loaded.files.map((file,index)=>({...file,sha256:loaded.manifest.files[index]!.sha256})),
      isValid:()=>{if(closed)return false;try{current();return true;}catch{revoke();return false;}},close};
  }catch(error){close();throw error;}
}
