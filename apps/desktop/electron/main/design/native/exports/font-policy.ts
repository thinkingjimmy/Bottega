/**
 * [INPUT]: Exact immutable native source/font identities and a main-issued read-only lease URL.
 * [OUTPUT]: Strict Canvas font-source CSP, pre-author paused-frame descendant FontFace guard and a bounded main-owned policy receipt.
 * [POS]: Original strict export protection; source JS cannot authorize alternate font bytes through a reported hash or fresh realm.
 */
import type { WebContents } from "electron";
import { designDigest } from "../../documents/model";
import type { NativeExportSnapshot } from "./plan";
export function nativeCanvasFontPolicy(snapshot: NativeExportSnapshot, leaseUrl: string, fixedDigests: readonly string[]) {
  const project = new URL("./project/", leaseUrl), source = snapshot.files.filter(file => /\.(?:ttf|otf|woff2?)$/i.test(file.path))
    .map(file => ({ file, digest: designDigest(file.data) })).filter(value => fixedDigests.includes(value.digest));
  if (source.length > 64) throw new Error("Native fixed font sources exceed their budget");
  const urls = new Set<string>();
  for (const { file } of source) {
    urls.add(new URL(file.path.split("/").map(encodeURIComponent).join("/"), project).href);
    const asset = /^assets\/([a-f0-9]{32})\.[a-z0-9]+$/.exec(file.path);
    if (asset) { urls.add(new URL("./_blob/" + asset[1], leaseUrl).href); urls.add(new URL("/_blob/" + asset[1], leaseUrl).href); }
  }
  const allowed = [...urls].sort();
  const receipt = { id: "native-font-source/v1" as const, sourceDigests: [...new Set(source.map(value => value.digest))].sort(),
    sourceFiles: source.length, bufferFontFaces: false, localFontFaces: false, intrinsicsCaptured: true };
  const script = String.raw`(()=>{
    'use strict';
    if(globalThis===globalThis.top)return;
    const allowed=new Set(${JSON.stringify(allowed)}),Native=globalThis.FontFace,construct=Reflect.construct,NativeURL=URL;
    const allowedHas=Set.prototype.has.bind(allowed),href=Object.getOwnPropertyDescriptor(NativeURL.prototype,'href').get,apply=Reflect.apply;
    if(typeof Native!=='function')throw new Error('Native export fonts are unavailable');
    const refuse=()=>{throw new Error('Native export fonts require an exact captured URL source')};
    const Wrapped=new Proxy(Native,{construct(target,args,newTarget){
      if(typeof args[1]!=='string')refuse();
      const match=/^\s*url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)\s*(?:format\([^)]*\)\s*)?$/.exec(args[1]);
      if(!match)refuse();
      let url;try{url=apply(href,new NativeURL((match[1]??match[2]??match[3]??'').trim(),document.baseURI),[])}catch{refuse()}
      if(!allowedHas(url))refuse();
      return construct(target,args,newTarget);
    }});
    Object.defineProperty(Native.prototype,'constructor',{value:Wrapped,writable:false,configurable:false});
    Object.defineProperty(globalThis,'FontFace',{value:Wrapped,writable:false,configurable:false});
    Object.defineProperty(globalThis,'__bottegaNativeFontPolicy',{value:Object.freeze(${JSON.stringify(receipt)}),writable:false,configurable:false});
  })()`;
  return { receipt, script, csp: "font-src " + (allowed.length ? allowed.join(" ") : "'none'") };
}

export async function installNativeFontPolicy(contents: WebContents, policy: ReturnType<typeof nativeCanvasFontPolicy>) {
  const client = contents.debugger, sessions = new Map<string, Promise<void>>(); let failure: Error | undefined;
  const listener: Parameters<typeof client.on>[1] = (_event, method, parameters) => {
    if (method === "Target.detachedFromTarget") { sessions.delete(parameters.sessionId as string); return; }
    if (method !== "Target.attachedToTarget") return;
    const id = parameters.sessionId as string;
    if (parameters.targetInfo?.type !== "iframe") { void client.sendCommand("Runtime.runIfWaitingForDebugger", {}, id).catch(() => {}); return; }
    const ready = (async () => {
      if (sessions.size >= 32) throw new Error("Native export font frame budget exceeded");
      await client.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: policy.script, runImmediately: true }, id);
      await client.sendCommand("DOM.enable", {}, id); await client.sendCommand("CSS.enable", {}, id);
      await client.sendCommand("CSS.setLocalFontsEnabled", { enabled: false }, id);
      await client.sendCommand("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }, id);
      await client.sendCommand("Runtime.runIfWaitingForDebugger", {}, id);
    })();
    sessions.set(id, ready); void ready.catch(cause => { failure = cause instanceof Error ? cause : new Error(String(cause)); if (!contents.isDestroyed()) contents.close(); });
  };
  client.on("message", listener);
  try {
    await client.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: policy.script, runImmediately: true });
    await client.sendCommand("DOM.enable"); await client.sendCommand("CSS.enable");
    await client.sendCommand("CSS.setLocalFontsEnabled", { enabled: false });
    await client.sendCommand("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
  } catch (cause) { client.removeListener("message", listener); throw cause; }
  return { sessions, guard() { if (failure) throw failure; }, close() { client.removeListener("message", listener); } };
}
