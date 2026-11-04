/**
 * [INPUT]: Exact native token, ./copy locale text, module-owned HTTP and the checkpointed comment bridge.
 * [OUTPUT]: Original System file/asset capabilities, authenticated source flush and nearby comment targeting.
 * [POS]: Trusted source-built System host; authored components receive no host capability.
 */
import { installProjectExport } from "../../canvas-runtime/build/projects/ui";
import { nativeDownloads } from "../../canvas-runtime/build/downloads";
import { nativeBase, nativeFetch } from "../../canvas-runtime/build/transport";
import { installNativeComments } from "../../canvas-runtime/build/comments";
import { createHttpBackend } from "../../canvas-runtime/.build/source/packages/slides/src/editor/editor-host";
import type { PublishBatch } from "../../canvas-runtime/.build/source/packages/slides/src/file-protocol";
import { installAssetReplacement } from "./replace";
import { unverifiedComponentCopy } from "./copy";
import { installSystemAnnotations } from "./comments";
export function installSystemHost() {
  const base = nativeBase(), token = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content;
  const readonly = Boolean(document.querySelector('meta[name="bottega-native-readonly"]'));
  Object.defineProperty(window,"__bottegaSystemEmptyPreview",{value:()=>unverifiedComponentCopy(document.documentElement.lang||new URL(location.href).searchParams.get("lang")||"en")});
  if (!token) throw new Error("The System host requires its original native lease");
  let activeRequest: string | undefined, finalFlushNonce: string | undefined, publishing: Promise<unknown> = Promise.resolve();
  const requests = new Map<string, string>();
  const backend = createHttpBackend(base, async (input, init) => {
    if (init?.method !== "POST") return nativeFetch(input, init);
    const body = init.body instanceof Blob ? await init.body.arrayBuffer() : init.body;
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body as ArrayBuffer;
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map(value => value.toString(16).padStart(2, "0")).join("");
    const key = String(input) + digest, id = activeRequest ? "native-" + activeRequest : requests.get(key) ?? "native-" + crypto.randomUUID();
    if (!requests.has(key) && requests.size >= 8) throw new Error("Query the previous System save before retrying"); requests.set(key, id);
    const headers = new Headers(init.headers); headers.set("X-Bottega-Native", token); headers.set("X-Bottega-Request", id);
    if (finalFlushNonce) headers.set("X-Bottega-Final-Flush", finalFlushNonce);
    const response = await nativeFetch(input, { ...init, headers });
    if (response.ok) { requests.delete(key); window.parent.postMessage({ type: "bottega:native:saved", token, result: await response.clone().json() }, "*"); }
    return response;
  });
  let acceptHot: ((update: { from: { ver: string }; to: { ver: string }; required: string; changed: null }) => unknown) | undefined;
  const hot = { accept(handler: typeof acceptHot) { acceptHot = handler; } };
  const publish = (batch: PublishBatch, requestId?: string) => {
    const next = publishing.catch(() => {}).then(async () => {
      const before = await (await nativeFetch(base + "_files.json", { cache: "no-store" })).json();
      activeRequest = requestId;
      try { const result = await backend.publish(batch); if (before.ver !== result.version) setTimeout(() => { void Promise.resolve(acceptHot?.({ from: { ver: before.ver }, to: { ver: result.version }, required: "none", changed: null })).catch(() => {}); }, 0); return result; }
      finally { activeRequest = undefined; }
    });
    publishing = next; return next;
  };
  if (!readonly) { installNativeComments({ base, token, publish }); installSystemAnnotations(token); }
  const canEdit = async () => { try { const result = await nativeFetch(base + "__deck/session", { cache: "no-store" }); return result.ok && (await result.json()).canEdit === true; } catch { return false; } };
  const filePublish = async (entries: Record<string, string | Blob | { content: string | Blob; contentType: string } | null>, conditions?: { ifMatch?: Record<string, string | null> }) => {
    const batch: PublishBatch = {};
    for (const [path, entry] of Object.entries(entries)) {
      const ifMatch = conditions?.ifMatch?.[path];
      batch[path] = entry === null ? { delete: true, ...(typeof ifMatch === "string" ? { ifMatch } : {}) } : { ...(typeof entry === "string" || entry instanceof Blob ? { content: entry, contentType: entry instanceof Blob ? entry.type : "text/plain" } : entry), ...(ifMatch !== undefined ? { ifMatch } : {}) };
    }
    return { ...await publish(batch), ok: true };
  };
  if (!readonly) installAssetReplacement({canEdit,idle:async()=>{await publishing;await backend.idle()},upload:(file,options)=>backend.upload(file,options),publish:filePublish});
  Object.assign(window, { designSystemHost: { hot, artifact: { publish: filePublish }, self: { publish: filePublish },
    user: { id: async () => "local", name: async () => "You", isOwner: async () => true, canEdit, can: canEdit },
    assets: { upload: (file: Blob, options?: { type?: string }) => backend.upload(file, options) } }, __FRAME_PREAMBLE: { trustParent: true } });
  if (!readonly) installProjectExport(nativeDownloads(base, token, async () => {
    const deadline = Date.now() + 8000, dirty = () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    while (dirty() && Date.now() < deadline) { await publishing.catch(() => {}); await backend.idle(); await new Promise(resolve => setTimeout(resolve, 50)); }
    if (dirty()) throw new Error("Save the current System before exporting");
  }), token);
  let contentReady = false;
  window.addEventListener("bottega:system-ready", () => { contentReady = true; window.parent.postMessage({ type: "bottega:native:content-ready", token, file: "tokens.json", generation: 1 }, "*"); });
  const theme = new URL(location.href).searchParams.get("theme"); if (["light", "dark"].includes(theme ?? "")) document.documentElement.setAttribute("data-theme", theme!);
  window.addEventListener("message", async event => {
    if (!event.isTrusted || event.source !== window.parent || event.data?.token !== token) return;
    const message = event.data;
    if (message.type === "bottega:native:theme") { if (["light", "dark"].includes(message.theme)) document.documentElement.setAttribute("data-theme", message.theme); return; }
    if (message.type === "bottega:native:get-content-ready" && contentReady) { window.parent.postMessage({ type: "bottega:native:content-ready", token, file: "tokens.json", generation: 1 }, "*"); return; }
    if (message.type !== "editor:flush") return;
    const inert = document.body.inert; finalFlushNonce = typeof message.nonce === "string" ? message.nonce : undefined;
    if (finalFlushNonce) document.body.inert = true;
    try {
      const deadline = Date.now() + 8000, dirty = () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
      while (dirty() && Date.now() < deadline) { await publishing.catch(() => {}); await backend.idle(); await new Promise(resolve => setTimeout(resolve, 50)); }
      window.parent.postMessage({ type: "editor:flushed", requestId: message.requestId, saved: !dirty() }, "*");
    } finally { finalFlushNonce = undefined; document.body.inert = inert; }
  });
}
