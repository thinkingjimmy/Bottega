/**
 * [INPUT]: Upstream file backend, declared original extra-format flags, native comment/chat/download bridges and the trusted editor parent.
 * [OUTPUT]: Installs the selected native editor host with theme continuity, main-frozen original export jobs and authenticated private downloads, coalesced fail-closed permission reads and nonce-bound closing flush replies and authenticated successful artboard readiness.
 * [POS]: Trusted editor entry; authored opaque frames never receive this host capability.
 */
import { nativeFetch, nativeBase } from "./transport";
import { nativeDownloads } from "./downloads";
import { installNativeComments } from "./comments";
import type { PublishBatch } from "../.build/source/packages/slides/src/file-protocol";
import { createEditorHost, createHttpBackend } from "../.build/source/packages/slides/src/editor/editor-host";
import { createCommentsBridge, domPinLayer, windowParentLink } from "../.build/source/packages/slides/src/editor/comments-bridge";
import { createChatBridge } from "../.build/source/packages/slides/src/editor/chat-bridge";
import { createBrowserDownloads } from "../.build/source/packages/design/src/editor/downloads-bridge";
export function installDesignEditorHost(kind: "canvas" | "slides" = "canvas") {
  if (kind === "slides") Object.assign(globalThis, { __appifact_flags: {
    version: "appifact-flags:v1", ready: async () => true,
    get: (key: string, fallback: unknown) => key === "appifact_extra_export_formats" ? true : fallback,
    all: () => ({ appifact_extra_export_formats: true }),
  } });
  const base = nativeBase();
  const token = document.querySelector<HTMLMetaElement>('meta[name="bottega-native-token"]')?.content;
  const initialTheme = new URL(location.href).searchParams.get("theme");
  if (initialTheme === "light" || initialTheme === "dark") document.documentElement.setAttribute("data-theme", initialTheme);
  const report = () => { if (token) window.parent.postMessage({ type: "bottega:native:error", token }, "*"); };
  window.addEventListener("error", report); window.addEventListener("unhandledrejection", report);
  const contentReady = new Map<string, number>();
  Object.assign(window, { __bottegaNativeReady(file: string, generation: number) {
    const path = file.replace(/^project\//, ""); contentReady.set(path, generation);
    if (token) window.parent.postMessage({ type: "bottega:native:content-ready", token, file: path, generation }, "*");
  } });
  window.addEventListener("message", event => {
    if (!event.isTrusted || event.source !== window.parent || !token || event.data?.token !== token || !(["bottega:native:get-content-ready", "bottega:native:theme"].includes(event.data.type))) return;
    if (event.data.type === "bottega:native:theme") { if (["light", "dark"].includes(event.data.theme)) document.documentElement.setAttribute("data-theme", event.data.theme); return; }
    for (const [file, generation] of contentReady) window.parent.postMessage({ type: "bottega:native:content-ready", token, file, generation }, "*");
  });
  const requests = new Map<string, string>();
  let activeRequest: string | undefined, finalFlushNonce: string | undefined;
  const rawBackend = createHttpBackend(base, async (input, init) => {
    if (init?.method !== "POST" || !token) return nativeFetch(input, init);
    const body = init.body instanceof Blob ? await init.body.arrayBuffer() : init.body;
    const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body as ArrayBuffer;
    const bodyDigest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(byte => byte.toString(16).padStart(2, "0")).join("");
    const digest = JSON.stringify([String(input), new Headers(init.headers).get("content-type"), bodyDigest]);
    let requestId = activeRequest ? "native-" + activeRequest : requests.get(digest);
    if (!requestId) { if (requests.size >= 8) throw new Error("A previous native save needs its original result"); requestId = "native-" + crypto.randomUUID(); requests.set(digest, requestId); }
    const headers = new Headers(init.headers); headers.set("X-Bottega-Native", token); headers.set("X-Bottega-Request", requestId); if (finalFlushNonce) headers.set("X-Bottega-Final-Flush", finalFlushNonce);
    const response = await nativeFetch(input, { ...init, headers });
    if (response.ok) {
      const result = await response.clone().json(); requests.delete(digest);
      window.parent.postMessage({ type: "bottega:native:saved", token, result }, "*");
    }
    return response;
  });
  let publishing: Promise<unknown> = Promise.resolve();
  const publish = (batch: PublishBatch, requestId?: string) => {
    const result = publishing.catch(() => {}).then(async () => {
      activeRequest = requestId;
      try { return await rawBackend.publish(batch); } finally { activeRequest = undefined; }
    });
    publishing = result; return result;
  };
  const backend = { ...rawBackend, publish: (batch: PublishBatch) => publish(batch), idle: async () => { await publishing.catch(() => {}); await rawBackend.idle(); } };
  installNativeComments({ base, token, publish });
  let permissionFlight: Promise<boolean> | undefined;
  const canEdit = () => {
    if (permissionFlight) return permissionFlight;
    const flight = (async () => {
      try { const response = await nativeFetch(base + "__deck/session", { cache: "no-store", ...(finalFlushNonce && token ? { headers: { "X-Bottega-Native": token, "X-Bottega-Final-Flush": finalFlushNonce } } : {}) });
        return response.ok && (await response.json()).canEdit === true;
      } catch { return false; }
    })();
    permissionFlight = flight;
    void flight.finally(() => { if (permissionFlight === flight) permissionFlight = undefined; });
    return flight;
  };
  const link = windowParentLink(window);
  const comments = link ? createCommentsBridge(link, domPinLayer(document)) : null;
  const chat = link ? createChatBridge(link) : null;
  const host = createEditorHost(backend, { canEdit, ...(comments ? { comments: comments.capability } : {}), ...(chat ? { chat: chat.capability } : {}) });
  const beforeExport = async () => {
    const deadline = Date.now() + 8000, dirty = () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
    while (dirty() && Date.now() < deadline) { await backend.idle(); await new Promise(resolve => setTimeout(resolve, 50)); }
    if (dirty()) throw new Error("Save the current native source before exporting");
  };
  const downloads = nativeDownloads(base, token, beforeExport);
  if (token) Object.defineProperty(window, "__bottegaNativeBeforeExport", { value: beforeExport });
  if (token && link) Object.defineProperty(window, "__bottegaNativeExportJob", { value: downloads.produce });
  Object.assign(window, { [kind === "slides" ? "slidesHost" : "designHost"]: { ...host, downloads: link ? downloads : createBrowserDownloads(window) },
    __FRAME_PREAMBLE: { trustParent: Boolean(link) } });
  if (link) {
    window.addEventListener("message", async event => {
      if (!event.isTrusted || event.source !== window.parent || !token || event.data?.token !== token) return;
      const message = event.data;
      if (message.type !== "editor:flush" || typeof message.requestId !== "string") return;
      const inert = document.body.inert;
      finalFlushNonce = typeof message.nonce === "string" ? message.nonce : undefined;
      if (finalFlushNonce) document.body.inert = true;
      try {
        const deadline = Date.now() + 8000;
        const dirty = () => !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
        while (dirty() && Date.now() < deadline) {
          await Promise.race([backend.idle(), new Promise(resolve => setTimeout(resolve, 100))]);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        link.post({ type: "editor:flushed", requestId: message.requestId, saved: !dirty() });
      } finally { finalFlushNonce = undefined; document.body.inert = inert; }
    });
    void canEdit().then(canEdit => link.post({ type: "editor:ready", canEdit }));
  }
}
