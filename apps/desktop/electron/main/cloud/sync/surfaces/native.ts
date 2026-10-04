/**
 * [INPUT]: Active account/key admission, encrypted file transport and authenticated Chat/Surface queries.
 * [OUTPUT]: NativePluginSurfaces opens remote generations and validates current remote draft ownership.
 * [POS]: Main-only Cloud adapter; source bytes never cross renderer IPC and local plugins are never consulted.
 */
import { protocolHeader, type CloudBuildConfig, type BlobTransferPorts } from "@ai-chat/cloud-protocol";
import { canonicalJson } from "@ai-chat/cloud-protocol";
import { openChatHeadForRequest } from "@ai-chat/cloud-protocol/chats/encrypted/client";
import { EncryptedBlobTransfer } from "@ai-chat/cloud-protocol/blobs/encrypted/transport";
import type { FileCipherPort } from "@ai-chat/cloud-protocol/blobs/encrypted/model";
import type { PluginSurfaceSubject } from "@ai-chat/cloud-protocol/surfaces/plugin/model";
import type { PluginDraftOwner } from "@bottega/contracts/plugins/surface/native";
import type { CloudTransport } from "../../runtime/transport/transport";
import { openPublishedPluginSurface } from "./remote";
type Ports={confirmedHead(chatId:string):Promise<import("@ai-chat/cloud-protocol/chats/model").CloudChatHead|null>;ownerDevice(id:string):boolean;config:CloudBuildConfig;crypto():FileCipherPort;current():void;transport:Pick<CloudTransport,"query"|"watchPluginSurface">;
  files(userId:string):BlobTransferPorts;own(activity:{close():Promise<void>}):()=>void;subscribe(listener:()=>void):()=>void};
export class NativePluginSurfaces{
  private readonly blankDrafts=new Set<string>();
  private draftAccount="";
  constructor(private readonly ports:Ports){}
  private admission(){
    this.ports.current();const crypto=this.ports.crypto(),key=canonicalJson([crypto.scope,crypto.session,crypto.keyPackageFingerprint]);
    const current=()=>{this.ports.current();const next=this.ports.crypto();if(key!==canonicalJson([next.scope,next.session,next.keyPackageFingerprint]))throw new Error("PLUGIN_ACCOUNT_CHANGED");};
    const header={...protocolHeader(this.ports.config),expectedUserId:crypto.session.userId,encryptedSpace:{scope:crypto.scope,keyPackageFingerprint:crypto.keyPackageFingerprint}};
    return{crypto,current,header};
  }
  async assertDraft(ownerDeviceId:string,owner:PluginDraftOwner){
    if(!/^[A-Za-z0-9_.:-]{1,128}$/.test(ownerDeviceId)||!/^[A-Za-z0-9_-]{1,128}$/.test(owner.chatId)||owner.incarnationId.length>128)throw new Error("PLUGIN_DRAFT_INVALID");
    const {crypto,current,header}=this.admission();
    if(!this.ports.ownerDevice(ownerDeviceId))throw new Error("PLUGIN_OWNER_UNAVAILABLE");
    const account=canonicalJson([crypto.scope,crypto.session,crypto.keyPackageFingerprint]);
    if(this.draftAccount!==account){this.blankDrafts.clear();this.draftAccount=account;}
    const key=canonicalJson([ownerDeviceId,owner.chatId]);
    let head=await this.ports.confirmedHead(owner.chatId);current();
    // Confirmed mirror facts are already authenticated by the Chat reader. A new local draft has no server Chat yet.
    if(!head && !(owner.incarnationId==="" && this.blankDrafts.has(key))){
      const raw=await this.ports.transport.query("chats/metadata:head",{...header,chatId:owner.chatId});current();
      head=raw?await openChatHeadForRequest(raw,owner.chatId,crypto):null;current();
    }
    if(head){
      this.blankDrafts.delete(key);
      if(head.ownerDeviceId!==ownerDeviceId||head.chat.incarnationId!==owner.incarnationId)throw new Error("PLUGIN_DRAFT_EXPIRED");
    }else{
      if(owner.incarnationId!==""||!owner.chatId.startsWith("c"))throw new Error("PLUGIN_DRAFT_EXPIRED");
      this.blankDrafts.add(key);while(this.blankDrafts.size>64)this.blankDrafts.delete(this.blankDrafts.values().next().value!);
    }
    return{accountId:crypto.session.userId,ownerDeviceId};
  }
  async open(subject:PluginSurfaceSubject,invalidated:()=>void){
    const {crypto,current,header}=this.admission(),transfer=new EncryptedBlobTransfer(this.ports.files(crypto.session.userId));
    let stopAccount=()=>{};
    try{
      const source=await openPublishedPluginSurface(subject,{
        current,head:value=>this.ports.transport.query("surfaces/plugins:head",{...header,subject:value}),
        watch:(value,changed,failed)=>this.ports.transport.watchPluginSurface({...header,subject:value},changed,failed),
        own:activity=>this.ports.own({close:async()=>{stopAccount();await activity.close();}}),
        read:(descriptor,signal)=>{const chunks:Uint8Array[]=[];
          return transfer.readFile(descriptor,crypto,{write:async bytes=>{chunks.push(bytes);},commit:async()=>{
            const bytes=new Uint8Array(chunks.reduce((sum,part)=>sum+part.length,0));let offset=0;
            for(const part of chunks){bytes.set(part,offset);offset+=part.length;}chunks.length=0;return bytes;
          },abort:async()=>{chunks.length=0;}},undefined,signal);
        },
      },()=>{stopAccount();invalidated();});
      stopAccount=this.ports.subscribe(()=>{source.isValid();});
      return{...source,close:()=>{stopAccount();source.close();}};
    }catch(error){stopAccount();throw error;}
  }
}
