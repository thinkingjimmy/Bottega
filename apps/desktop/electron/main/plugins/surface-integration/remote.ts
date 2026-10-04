/**
 * [INPUT]: Dynamic Cloud account, verified remote generations, trusted draft owner and native plugin gateway.
 * [OUTPUT]: RemotePluginSurfaces binds remote leases, recovery scopes and account erasure to native lifecycle.
 * [POS]: Main integration adapter; an owner-device ID is authenticated through Cloud before any local recovery access.
 */
import type { PluginDraftOwner } from "@bottega/contracts/plugins/surface/native";
import type { PluginSurfaceGateway } from "../surface-runtime/gateway";
import type { PluginRecoveryStore } from "../recovery/store";
export type PluginCloudRuntime=Pick<Awaited<ReturnType<typeof import("../../cloud/runtime/composition").createCloudRuntime>>,
 "openPluginSurface"|"assertPluginDraft"|"accountIdentity"|"subscribeIdentity">;
export class RemotePluginSurfaces{
 private cloud:PluginCloudRuntime|null=null;private stop=()=>{};
 private readonly leases=new Map<string,{windowId:number;close():void;timer:ReturnType<typeof setTimeout>}>();
 constructor(private readonly gateway:PluginSurfaceGateway,private readonly recovery:PluginRecoveryStore,private readonly changed:()=>void){}
 configure(cloud:PluginCloudRuntime){this.stop();this.cloud=cloud;let previous=cloud.accountIdentity().profile?.userId??null;
  this.stop=cloud.subscribeIdentity(()=>{const next=cloud.accountIdentity().profile?.userId??null;if(previous&&previous!==next){
    const account=previous;for(const [id,lease]of this.leases)this.release(id,lease.windowId);this.changed();
    void this.recovery.clearAccount(account).catch(error=>console.error("[plugin-recovery] account cleanup failed",error));
  }previous=next;});
 }
 scope(ownerDeviceId:string,owner:PluginDraftOwner){if(!this.cloud)throw new Error("PLUGIN_CLOUD_UNAVAILABLE");return this.cloud.assertPluginDraft(ownerDeviceId,owner);}
 async open(pluginId:string,ownerDeviceId:string,owner:PluginDraftOwner,windowId:number){
  const cloud=this.cloud;if(!cloud)throw new Error("PLUGIN_CLOUD_UNAVAILABLE");await cloud.assertPluginDraft(ownerDeviceId,owner);
  let leaseId:string|null=null;
  const source=await cloud.openPluginSurface({kind:"plugin",id:pluginId,ownerDeviceId},()=>{
    if(leaseId)this.release(leaseId,windowId);this.changed();
  });
  try{
   if(!source.isValid())throw new Error("PLUGIN_SURFACE_REVOKED");
   const view=await this.gateway.issuePublished({pluginId,generationId:source.manifest.generationId,artifactDigest:source.manifest.artifactDigest,
    files:source.files,sourceFormat:source.manifest.plugin.sourceFormat,operations:source.manifest.plugin.operations,isValid:source.isValid},windowId);
   leaseId=view.id;const timer=setTimeout(()=>{this.release(view.id,windowId);this.changed();},Math.max(0,view.expiresAt-Date.now()));timer.unref();
   this.leases.set(view.id,{windowId,close:source.close,timer});
   if(!source.isValid()){this.release(view.id,windowId);throw new Error("PLUGIN_SURFACE_REVOKED");}return view;
  }catch(error){source.close();throw error;}
 }
 release(id:string,windowId:number){const lease=this.leases.get(id);if(lease&&lease.windowId!==windowId)return;
  if(lease){this.leases.delete(id);clearTimeout(lease.timer);lease.close();}this.gateway.release(id,windowId);
 }
 releaseWindow(windowId:number){for(const[id,lease]of this.leases)if(lease.windowId===windowId)this.release(id,windowId);this.gateway.releaseWindow(windowId);}
 close(){this.stop();for(const[id,lease]of this.leases)this.release(id,lease.windowId);this.cloud=null;}
}
