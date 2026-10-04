/**
 * [INPUT]: Depends on native source selection, current scope authority and the existing host-package preflight.
 * [OUTPUT]: Provides pathless local preflight with authority checks around the chooser; the trusted Plugins entry can enable packaged selection.
 * [POS]: Main-owned acquisition only; cancellation never stages bytes and selection never confirms installation.
 */
import { assertProductResourceScope } from "../../../../shared/product/product-resource-scope";
import type { ExtensionLocalPreflightInput } from "../../../../shared/ipc/settings/extensions-ipc";

export async function preflightLocalFromDialog<T>(raw:unknown,ports:{
  isPackaged:boolean;
  allowPackaged?:boolean;
  chooseDirectory():Promise<string|null>;
  assertAuthority(input:ExtensionLocalPreflightInput):void;
  preflight(input:ExtensionLocalPreflightInput & {path:string}):Promise<T>;
}):Promise<T|null> {
  if(ports.isPackaged&&!ports.allowPackaged)throw new Error("Local package installation is available from Plugins only");
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw new Error("Invalid local preflight request");
  const value=raw as Record<string,unknown>;
  if(Object.keys(value).some(key=>!["scope","expectedProjectLifecycleRevision","expectedScopeRevision"].includes(key)))throw new Error("Unknown local preflight field");
  const revision=(value:unknown):value is number=>typeof value==="number"&&Number.isSafeInteger(value)&&value>=0;
  if(!revision(value.expectedScopeRevision)||(value.expectedProjectLifecycleRevision!==null&&!revision(value.expectedProjectLifecycleRevision)))throw new Error("Invalid local preflight revision");
  const input:ExtensionLocalPreflightInput={scope:assertProductResourceScope(value.scope),expectedScopeRevision:value.expectedScopeRevision,expectedProjectLifecycleRevision:value.expectedProjectLifecycleRevision};
  ports.assertAuthority(input);
  const path=await ports.chooseDirectory();
  if(path===null)return null;
  ports.assertAuthority(input);
  return ports.preflight({...input,path});
}
