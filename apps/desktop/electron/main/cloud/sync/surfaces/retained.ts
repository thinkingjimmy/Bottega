/**
 * [INPUT]: Verified encrypted-file transfer, admitted crypto and immutable App/plugin source intents.
 * [OUTPUT]: Publication identity, authenticated retained-manifest comparison and fresh source-byte/authority verification.
 * [POS]: Shared desktop rollback verification; ciphertext descriptors remain immutable in remote custody.
 */
import { canonicalJson, hashBytes } from "@ai-chat/cloud-protocol";
import type { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted";
import { checkAppSurfaceManifest } from "@ai-chat/cloud-protocol/surfaces/encrypted";
import type { AppSurfaceHead } from "@ai-chat/cloud-protocol/surfaces/manifest";
import { checkPluginSurfaceManifest, type PluginSurfaceHead, type PluginSurfaceSubject } from "@ai-chat/cloud-protocol/surfaces/plugin/model";
import type { SurfaceIntent } from "./source";
type Compiled = Extract<SurfaceIntent,{kind:"compiled"}>;
export type PublishedSurface = Extract<AppSurfaceHead|PluginSurfaceHead,{state:"published"}>;
export function surfacePublicationIdentity(appId:string,intent:Compiled,subject?:PluginSurfaceSubject) {
  return canonicalJson({generationId:intent.generationId,artifactDigest:intent.artifactDigest,entry:"index.html",layout:"compiled-v3",
    ...(subject?{schema:"bottega.plugin-surface/v1",subject,plugin:intent.plugin}:{schema:"bottega.app-surface/v1",appId,
      sdkSlice:intent.sdkSlice,grantedCapabilities:intent.grantedCapabilities,hostActions:intent.hostActions}),
    files:intent.files.map(({path,mime,bytes,sha256})=>({path,mime,bytes,sha256}))});
}
export async function verifyRetainedSurface(head:PublishedSurface,identity:string,intent:Compiled,files:Pick<EncryptedBlobTransfer,"readFile">,
  crypto:FileCipherPort,signal:AbortSignal) {
  if(head.generationId!==intent.generationId || head.artifactDigest!==intent.artifactDigest)throw new Error("surface-generation-changed");
  const chunks:Uint8Array[]=[];
  const bytes=await files.readFile(head.manifest,crypto,{write:async chunk=>{chunks.push(chunk);},commit:async()=>{
    const result=new Uint8Array(chunks.reduce((n,chunk)=>n+chunk.length,0));let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
  },abort:async()=>{chunks.length=0;}},undefined,signal);
  const manifest="subject" in head?checkPluginSurfaceManifest(head,bytes):checkAppSurfaceManifest(head,bytes);
  const projection={...manifest,files:manifest.files.map(({path,mime,bytes,sha256})=>({path,mime,bytes,sha256}))};
  if(canonicalJson(projection)!==identity)throw new Error("surface-generation-changed");
  await verifySurfaceIntentFiles(intent,signal);
}
export async function verifySurfaceIntentFiles(intent:Compiled,signal:AbortSignal) {
  for(const file of intent.files){signal.throwIfAborted();const bytes=await file.read();signal.throwIfAborted();
    if(bytes.byteLength!==file.bytes || `sha256:${hashBytes(bytes)}`!==file.sha256)throw new Error("APP_SURFACE_SOURCE_CHANGED");}
}
