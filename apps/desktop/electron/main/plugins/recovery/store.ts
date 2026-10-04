/**
 * [INPUT]: Trusted current-Chat scope resolution, Electron safeStorage and durable atomic file replacement.
 * [OUTPUT]: PluginRecoveryStore, identity-bound encrypted local source recovery with serialized writes and an encrypted null fallback when deletion fails.
 * [POS]: Native plugin recovery boundary; the renderer supplies no account, owner computer or filesystem path.
 */
import { safeStorage } from "electron";
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, unlink, readdir, lstat } from "node:fs/promises";
import { join } from "node:path";
import { pluginSourceSchema, type PluginSource } from "@bottega/contracts/plugins/surface/source";
import { durableReplaceFile } from "../../persistence/durable-json";
export type NativePluginRecoveryRequest={chatId:string;incarnationId:string;pluginId:string;ownerDeviceId?:string;attachmentId?:string};
export type NativePluginRecoveryScope=NativePluginRecoveryRequest & {accountId:string;ownerDeviceId:string};
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const BUDGET=32*1024*1024;
function checked(source:PluginSource,pluginId:string){const result=pluginSourceSchema.parse(source),bytes=Buffer.from(result.bytes,"base64");
  if(result.pluginId!==pluginId || bytes.length!==result.byteLength || bytes.toString("base64")!==result.bytes)throw new Error("PLUGIN_RECOVERY_INVALID");
  if(createHash("sha256").update(bytes).digest("hex")!==result.sha256)throw new Error("PLUGIN_RECOVERY_INTEGRITY");return result;
}
export class PluginRecoveryStore{
  private tail:Promise<unknown>=Promise.resolve();
  constructor(private readonly options:{root:string;scope(request:NativePluginRecoveryRequest):Promise<NativePluginRecoveryScope>}){}
  private async identity(request:NativePluginRecoveryRequest){const scope=await this.options.scope(request);
    if(scope.chatId!==request.chatId || scope.incarnationId!==request.incarnationId || scope.pluginId!==request.pluginId || scope.attachmentId!==request.attachmentId || (request.ownerDeviceId!==undefined && scope.ownerDeviceId!==request.ownerDeviceId))throw new Error("PLUGIN_RECOVERY_SCOPE");
    const key=hash(JSON.stringify([scope.accountId,scope.ownerDeviceId,scope.chatId,scope.incarnationId,scope.pluginId,scope.attachmentId??null]));return{scope,key,path:join(this.options.root,hash(scope.accountId),key+".json")};}
  private available(){if(!safeStorage.isEncryptionAvailable() || (process.platform==="linux" && safeStorage.getSelectedStorageBackend()==="basic_text"))throw new Error("PLUGIN_RECOVERY_ENCRYPTION_UNAVAILABLE");}
  read(request:NativePluginRecoveryRequest){return this.serial(async()=>{
    const identity=await this.identity(request);this.available();
    const size=await stat(identity.path).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});if(!size)return null;
    if(!size.isFile()||size.size>BUDGET)throw new Error("PLUGIN_RECOVERY_INVALID");
    const raw=await readFile(identity.path,"utf8"),stored=JSON.parse(safeStorage.decryptString(Buffer.from(raw,"base64")));
    if(stored.key!==identity.key)throw new Error("PLUGIN_RECOVERY_SCOPE");
    if((await this.identity(request)).key!==identity.key)throw new Error("PLUGIN_RECOVERY_SCOPE");return stored.source===null?null:checked(stored.source,request.pluginId);
  });}
  write(request:NativePluginRecoveryRequest,source:PluginSource){return this.serial(async()=>{
    const identity=await this.identity(request),value=checked(source,request.pluginId);this.available();
    const cipher=safeStorage.encryptString(JSON.stringify({key:identity.key,source:value})).toString("base64");if(Buffer.byteLength(cipher)>BUDGET)throw new Error("PLUGIN_RECOVERY_LIMIT");
    await mkdir(join(this.options.root,hash(identity.scope.accountId)),{recursive:true,mode:0o700});
    if((await this.identity(request)).key!==identity.key)throw new Error("PLUGIN_RECOVERY_SCOPE");await durableReplaceFile(identity.path,cipher);
  });}
  remove(request:NativePluginRecoveryRequest){return this.serial(async()=>{
    const identity=await this.identity(request);
    try{await unlink(identity.path);}catch(error){
      if((error as NodeJS.ErrnoException).code==="ENOENT")return;
      // A delete-only failure must not resurrect a terminal editor after reopening the store.
      this.available();
      const tombstone=safeStorage.encryptString(JSON.stringify({key:identity.key,source:null})).toString("base64");
      if((await this.identity(request)).key!==identity.key)throw new Error("PLUGIN_RECOVERY_SCOPE");
      await durableReplaceFile(identity.path,tombstone);
    }
  });}
  /** Logout erases only generated recovery records; never recursively removes directories or unrelated files. */
  clearAccount(accountId:string){return this.serial(async()=>{
    const directory=join(this.options.root,hash(accountId));
    const state=await lstat(directory).catch((error:NodeJS.ErrnoException)=>{if(error.code==="ENOENT")return null;throw error;});
    if(!state)return;if(!state.isDirectory()||state.isSymbolicLink())throw new Error("PLUGIN_RECOVERY_SCOPE");
    for(const entry of await readdir(directory,{withFileTypes:true})){
      if(entry.isFile() && /^[a-f0-9]{64}\.json$/.test(entry.name))await unlink(join(directory,entry.name));
    }
  });}
  private serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.tail.then(work);this.tail=next.catch(()=>{});return next;}
}
