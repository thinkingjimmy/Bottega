/**
 * [INPUT]: Depends on the loopback gateway, verified plugin bytes, CSP policy and synchronous/asynchronous lease admission.
 * [OUTPUT]: Provides opaque composer/Dock leases with immutable files, strict role/window validation, shared CSP and revocation.
 * [POS]: Native isolated Surface transport shared by authored plugins and host-package record actions.
 */
import { randomUUID, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { PluginSurfaceRuntime } from "./service";
import { sha256 } from "../../apps/support";
import { pluginSurfaceDefinitionSchema } from "@ai-chat/cloud-protocol/surfaces/plugin/model";
import type { PluginSurfaceDescriptor } from "@bottega/contracts/plugins/surface/native";
import {DOCK_OPERATIONS,DOCK_SESSION_TIMING,type DockOperation} from '@bottega/contracts/plugins/dock/session/protocol';
import {WIDGET_PACKAGE_BUDGET} from '@bottega/contracts/plugins/dock/packages';
export type PluginSurfaceLease = PluginSurfaceDescriptor;
export type DockSurfaceLease=Readonly<{kind:'dock';id:string;definitionId:string;generationId:string;origin:string;url:string;expiresAt:number;sandbox:'allow-scripts';operations:readonly DockOperation[]}>;
type PublishedInput={generationId:string;artifactDigest:string;files:readonly {path:string;mime:string;bytes:Uint8Array;sha256:string}[];isValid():boolean;validate?():Promise<void>};
type Lease = {view:PluginSurfaceLease|DockSurfaceLease;windowId:number;retainedBytes:number;available():boolean;validate():Promise<void>;release():void;files:Map<string,{mime:string;read():Promise<Uint8Array>}>};
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors file: http://localhost:*";
export class PluginSurfaceGateway {
  private origin:((id:string)=>string)|null=null;
  private readonly leases=new Map<string,Lease>();
  constructor(private readonly runtime:PluginSurfaceRuntime) {}
  configure(origin:(id:string)=>string) {this.origin=origin;}
  private drop(id:string){const lease=this.leases.get(id);if(!lease)return;this.leases.delete(id);lease.release();}
  private purge() {for(const [id,lease] of this.leases)if(lease.view.expiresAt<=Date.now())this.drop(id);}
  async issue(pluginId:string,windowId:number):Promise<PluginSurfaceLease> {
    this.purge();if(!this.origin||this.leases.size>=16)throw new Error("Plugin surface lease budget exceeded");
    const expiresAt=Date.now()+30*60_000,pin=await this.runtime.pinIntent(pluginId,expiresAt);
    try{
      const intent=pin.intent;
      const bytes=intent.files.reduce((sum,file)=>sum+file.bytes,0);
      if(bytes>50_000_000||intent.files.length>512)throw new Error("Plugin interface exceeds its budget");
      if(!intent.files.some(file=>file.path==="index.html"))throw new Error("Plugin interface entry is missing");
      const id=randomUUID(),origin=this.origin(`plugin-${id}`);
      const view:PluginSurfaceLease={id,pluginId,generationId:intent.generationId,origin,url:`${origin}/_plugin/${id}/index.html`,expiresAt,
        readyNonce:randomBytes(24).toString("base64url"),sandbox:"allow-scripts",sourceFormat:intent.plugin.sourceFormat,operations:intent.plugin.operations};
      if(this.leases.size>=16||!pin.available())throw new Error("Plugin surface lease budget exceeded");
      this.leases.set(id,{view,windowId,retainedBytes:0,available:pin.available,validate:pin.validate,release:pin.release,
        files:new Map(intent.files.map(file=>[file.path,{mime:file.mime,read:file.read}]))});return structuredClone(view);
    }catch(cause){pin.release();throw cause;}
  }
  issuePublished(input:{pluginId:string;generationId:string;artifactDigest:string;files:readonly {path:string;mime:string;bytes:Uint8Array;sha256:string}[];
    sourceFormat:{id:string;version:number;readableVersions:readonly number[]};operations:readonly string[];isValid():boolean;validate?():Promise<void>},windowId:number):PluginSurfaceLease {
    if(!input.pluginId)throw new Error('Published plugin is unavailable');
    const {id,origin,files,total}=this.publishedFiles(input,{files:512,bytes:50_000_000});
    const view:PluginSurfaceLease={id,pluginId:input.pluginId,generationId:input.generationId,origin,url:`${origin}/_plugin/${id}/index.html`,expiresAt:Date.now()+30*60_000,
      readyNonce:randomBytes(24).toString("base64url"),sandbox:"allow-scripts",...pluginSurfaceDefinitionSchema.parse({sourceFormat:input.sourceFormat,operations:input.operations})};
    this.leases.set(id,{view,windowId,retainedBytes:total,release:()=>{},available:input.isValid,validate:async()=>{if(!input.isValid())throw new Error("Published plugin generation is unavailable");await input.validate?.();},files});
    return structuredClone(view);
  }
  issueDock(input:PublishedInput&{definitionId:string;operations:readonly string[]},windowId:number):DockSurfaceLease{
    if(!/^[a-z][a-z0-9.-]{0,119}$/.test(input.definitionId)||!/^plugin-[a-f0-9-]{36}$/.test(input.generationId))throw new Error('Dock surface identity is invalid');
    const operations=input.operations.map(operation=>{if(!DOCK_OPERATIONS.includes(operation as DockOperation))throw new Error('Dock operation is invalid');return operation as DockOperation;});
    if(!operations.includes('dock.open')||!operations.includes('dock.heartbeat')||new Set(operations).size!==operations.length)throw new Error('Dock bootstrap operations are required');
    const {id,origin,files,total}=this.publishedFiles(input,{files:WIDGET_PACKAGE_BUDGET.files,bytes:WIDGET_PACKAGE_BUDGET.packageBytes});
    const view:DockSurfaceLease={kind:'dock',id,definitionId:input.definitionId,generationId:input.generationId,origin,url:`${origin}/_plugin/${id}/index.html`,expiresAt:Date.now()+DOCK_SESSION_TIMING.leaseMs,sandbox:'allow-scripts',operations};
    this.leases.set(id,{view,windowId,retainedBytes:total,release:()=>{},available:input.isValid,validate:async()=>{if(!input.isValid())throw new Error('Dock surface scope is unavailable');await input.validate?.();},files});return structuredClone(view);
  }
  private publishedFiles(input:PublishedInput,budget:{files:number;bytes:number}){
    this.purge();const total=input.files.reduce((sum,file)=>sum+file.bytes.byteLength,0),held=[...this.leases.values()].reduce((sum,lease)=>sum+lease.retainedBytes,0);
    if(!this.origin||this.leases.size>=16||input.files.length>budget.files||total>budget.bytes||held+total>128*1024*1024)throw new Error('Plugin surface lease budget exceeded');
    if(!input.isValid()||!/^sha256:[a-f0-9]{64}$/.test(input.artifactDigest)||!input.generationId)throw new Error('Published plugin is unavailable');
    const files=new Map<string,{mime:string;read():Promise<Uint8Array>}>();
    for(const file of input.files){
      if(file.path.startsWith('/')||file.path.includes('\\')||file.path.split('/').some(part=>!part||part==='.'||part==='..')||files.has(file.path)||sha256(file.bytes)!==file.sha256)throw new Error('Invalid published plugin file');
      const bytes=Uint8Array.from(file.bytes);files.set(file.path,{mime:file.mime,read:async()=>bytes});
    }
    if(!files.has('index.html'))throw new Error('Plugin interface entry is missing');const id=randomUUID(),origin=this.origin(`plugin-${id}`);return{id,origin,files,total};
  }
  release(id:string,windowId:number) {if(this.leases.get(id)?.windowId===windowId)this.drop(id);}
  releaseWindow(windowId:number) {for(const [id,lease] of this.leases)if(lease.windowId===windowId)this.drop(id);}
  ownsOrigin(value:string) {this.purge();try{const origin=new URL(value).origin;return [...this.leases.values()].some(lease=>lease.view.origin===origin);}catch{return false;}}
  allowsDocument(value:string,windowId?:number) {
    this.purge();try {
      const url=new URL(value),id=url.pathname.split("/")[2],lease=id?this.leases.get(id):null;
      if(!lease||(windowId!==undefined&&lease.windowId!==windowId)||url.origin!==lease.view.origin||url.pathname!==new URL(lease.view.url).pathname||url.search)return false;
      if(!lease.available()){this.drop(id!);return false;}return true;
    }catch{return false;}
  }
  async validate(id:string,windowId:number):Promise<PluginSurfaceLease>{
    const view=await this.validateLease(id,windowId);if('kind'in view&&view.kind==='dock')throw new Error('Dock leases require Dock validation');return view as PluginSurfaceLease;
  }
  async validateDock(id:string,windowId:number):Promise<DockSurfaceLease>{
    const view=await this.validateLease(id,windowId);if(!('kind'in view)||view.kind!=='dock')throw new Error('A Dock lease is required');return view;
  }
  private async validateLease(id:string,windowId:number) {
    this.purge();const lease=this.leases.get(id);if(!lease||lease.windowId!==windowId)throw new Error("Plugin surface lease is unavailable");
    try{
      if(!lease.available())throw new Error("Plugin surface lease is unavailable");
      await lease.validate();
      if(lease.view.expiresAt<=Date.now()||this.leases.get(id)!==lease||!lease.available())throw new Error("Plugin surface lease is unavailable");
      return structuredClone(lease.view);
    }catch(cause){this.drop(id);throw cause;}
  }
  async handle(request:IncomingMessage,response:ServerResponse):Promise<boolean> {
    if(!/^plugin-[a-f0-9-]{36}\.localhost:\d+$/.test(request.headers.host??""))return false;
    this.purge();
    const deny=(status:number)=>{response.writeHead(status,{"Cache-Control":"no-store"});response.end();return true;};
    if(!["GET","HEAD"].includes(request.method??""))return deny(405);
    let url:URL,path:string;
    try{url=new URL(request.url??"/",`http://${request.headers.host}`);path=decodeURIComponent(url.pathname);}catch{return deny(400);}
    const [,prefix,id,...segments]=path.split("/"),lease=id?this.leases.get(id):null;
    if(prefix!=="_plugin"||!lease||url.origin!==lease.view.origin||url.search||path.includes("\\")||segments.some(part=>!part||part==="."||part===".."))return deny(404);
    try{await this.validateLease(id!,lease.windowId);}catch{return deny(410);}
    const file=lease.files.get(segments.join("/"));if(!file)return deny(404);
    let bytes:Uint8Array;try{bytes=await file.read();await this.validateLease(id!,lease.windowId);}catch{this.drop(id!);return deny(410);}
    const headers:Record<string,string>={"Content-Type":file.mime,"Content-Length":String(bytes.byteLength),"Cache-Control":"no-store","Content-Security-Policy":CSP,
      "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","Permissions-Policy":"camera=(), microphone=(), geolocation=(), display-capture=(), usb=(), payment=()"};
    // The sandbox has an opaque origin; module scripts need this read-only CORS response.
    if(request.headers.origin==="null")headers["Access-Control-Allow-Origin"]="null";
    response.writeHead(200,headers);response.end(request.method==="HEAD"?undefined:bytes);return true;
  }
}
