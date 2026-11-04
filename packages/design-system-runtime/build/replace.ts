/**
 * [INPUT]: Original selected image record, native upload/publication capabilities and exact projected-file CAS hashes.
 * [OUTPUT]: Explicit same-path image replacement through the existing System source journal.
 * [POS]: Trusted original context-menu extension; authored opaque components receive no capability.
 */
import {nativeBase,nativeFetch} from "../../canvas-runtime/build/transport";
import {assetReplacementCopy} from "./copy";
type Asset={name:string;group:string;path:string};
type Record={name:string;blob:string;size:number;type:string;sha256?:string};
type Index={assetGroups:globalThis.Record<string,{name:string;files:globalThis.Record<string,Record>}>};
type Ports={canEdit():Promise<boolean>;idle():Promise<void>;upload(file:Blob,options?:{type?:string}):Promise<{id:string;sizeBytes?:number}>;publish(entries:globalThis.Record<string,string>,conditions:{ifMatch:globalThis.Record<string,string>}):Promise<unknown>};
const copy=()=>assetReplacementCopy(document.documentElement.lang||new URL(location.href).searchParams.get("lang")||"en");
export function installAssetReplacement(ports:Ports){
  const style=document.createElement("style");style.textContent='dialog[data-native-asset-replace]{position:fixed;inset:0;margin:auto;width:min(420px,calc(100vw - 24px));max-height:calc(100vh - 24px);padding:20px;border:1px solid var(--color-border-line,#e9e7e2);border-radius:16px;background:var(--color-bg-primary,#fff);color:var(--color-fg-primary,#1a1915);box-shadow:0 16px 48px #14120e29;font:14px/1.5 system-ui,sans-serif}dialog[data-native-asset-replace]::backdrop{background:#0004}dialog[data-native-asset-replace] h2{margin:0;font-size:16px;font-weight:600}dialog[data-native-asset-replace] p{margin:16px 0;overflow-wrap:anywhere}dialog[data-native-asset-replace] button{min-height:36px;padding:6px 12px;border:1px solid var(--color-border-line,#e9e7e2);border-radius:8px;background:transparent;font:inherit;color:inherit}dialog[data-native-asset-replace] button:disabled{opacity:.5}html[data-theme=dark] dialog[data-native-asset-replace]{background:var(--color-bg-primary,#262624);color:var(--color-fg-primary,#f3f2ef);border-color:var(--color-border-line,#3a3936)}';document.head.append(style);
  let active=false;
  const replace=(asset:Asset)=>{
    if(active)return;const picker=document.createElement("input");picker.type="file";picker.accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
    picker.onchange=()=>{const file=picker.files?.[0];if(!file)return;active=true;
      const dialog=document.createElement("dialog"),title=document.createElement("h2"),message=document.createElement("p"),close=document.createElement("button");
      dialog.setAttribute("data-native-asset-replace","");title.textContent=copy().replace+" "+asset.name;message.textContent=copy().saving;message.setAttribute("role","status");close.type="button";close.textContent=copy().close;close.disabled=true;
      dialog.className="rounded-xl border border-border-line bg-bg-primary p-5 text-fg-primary shadow-xl";dialog.style.maxWidth="min(420px,calc(100vw - 24px))";dialog.setAttribute("aria-label",title.textContent);dialog.append(title,message,close);
      const end=()=>{dialog.remove();active=false};close.onclick=end;dialog.addEventListener("cancel",event=>{event.preventDefault();if(!close.disabled)end()});document.body.append(dialog);dialog.showModal();
      void(async()=>{
        await ports.idle();if(!await ports.canEdit())throw new Error(copy().unavailable);
        if(!file.size||file.size>8*1024*1024)throw new Error(copy().invalidFile);
        const base=nativeBase(),read=async()=>{const response=await nativeFetch(base+"project/design-system.json",{cache:"no-store"});if(!response.ok)throw new Error(copy().sourceUnavailable);const text=await response.text(),bytes=new TextEncoder().encode(text),hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(value=>value.toString(16).padStart(2,"0")).join("");return {index:JSON.parse(text) as Index,hash}};
        const find=(index:Index)=>Object.values(index.assetGroups??{}).filter(group=>group.name===asset.group).flatMap(group=>Object.entries(group.files).filter(([,record])=>record.name===asset.name).map(([key,record])=>({group,key,record})));
        const before=find((await read()).index);if(before.length!==1)throw new Error(copy().selectionChanged);
        const expected=JSON.stringify(before[0]!.record);if(file.type!==before[0]!.record.type)throw new Error(copy().typeMismatch);
        const bytes=new Uint8Array(await file.arrayBuffer()),digest=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))).map(value=>value.toString(16).padStart(2,"0")).join("");
        const uploaded=await ports.upload(file,{type:file.type});if(uploaded.id!==digest.slice(0,32))throw new Error(copy().uploadedChanged);
        const captured=await read(),index=captured.index,current=find(index);if(current.length!==1||JSON.stringify(current[0]!.record)!==expected)throw new Error(copy().changedDuringUpload);
        const hash=captured.hash;
        current[0]!.group.files[current[0]!.key]={...current[0]!.record,blob:uploaded.id,size:bytes.length,type:file.type,sha256:digest};
        await ports.publish({"project/design-system.json":JSON.stringify(index,null,2)+"\n"},{ifMatch:{"project/design-system.json":hash}});end();
      })().catch(error=>{message.textContent=String(error?.message??error);message.setAttribute("role","alert");close.disabled=false;close.focus()});
    };picker.click();
  };
  Object.defineProperty(window,"__bottegaSystemReplaceAsset",{value:Object.assign(replace,{label:()=>copy().replace})});
}
