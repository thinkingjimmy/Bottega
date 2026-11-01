/**
 * [INPUT]: Main-owned fixed page notes, bounded abortable window initialization and nonce-bound exact-session navigation callbacks.
 * [OUTPUT]: One independent read-only notes window with private main updates and no audience-readable note resource.
 * [POS]: Trusted speaker surface; authored source cannot open it, inject script or read its document/controls.
 */
import { randomUUID } from "node:crypto";
import type { BrowserWindow } from "electron";
import type { NativePresentationPage } from "./source";
import { nativePresentationWindow, nativePresentationTask } from "./windows";
export async function createNativeNotesWindow(control: (action: "navigate" | "exit", slideId?: string) => Promise<unknown>, signal: AbortSignal, created: (window: BrowserWindow) => void) {
  signal.throwIfAborted();
  const nonce = randomUUID(), binding = "__notes_" + nonce.replaceAll("-", ""), window = nativePresentationWindow("Speaker notes");
  created(window);
  const abort = () => { if (!window.isDestroyed()) window.destroy(); };
  signal.addEventListener("abort", abort, { once: true }); window.once("closed", () => signal.removeEventListener("abort", abort));
  try {
    await nativePresentationTask(window.loadURL("about:blank"), signal);
    const client = window.webContents.debugger; client.attach("1.3"); let contextId: number | undefined;
    client.on("message", (_event, method, value) => {
      if (method === "Runtime.executionContextCreated" && value.context.auxData?.isDefault) contextId = value.context.id;
      if (method !== "Runtime.bindingCalled" || value.name !== binding || value.executionContextId !== contextId || typeof value.payload !== "string" || value.payload.length > 512) return;
      try { const input = JSON.parse(value.payload); if (input.nonce !== nonce || !["navigate", "exit"].includes(input.action) || Object.keys(input).some(key => !["nonce", "action", "slideId"].includes(key))) return;
        void control(input.action, input.slideId).catch(() => {}); } catch { /* A malformed control grants no window operation. */ }
    });
    await nativePresentationTask(client.sendCommand("Runtime.enable"), signal); await nativePresentationTask(client.sendCommand("Runtime.addBinding", { name: binding }), signal);
    const script = `const nonce=${JSON.stringify(nonce)};let state;window.__bottegaNotesRender=(proof,value)=>{if(proof!==nonce)return;state=value;document.querySelector('h1').textContent=value.title;document.querySelector('textarea').value=value.notes;document.querySelector('[data-page]').textContent=value.position;document.querySelector('[data-prev]').disabled=!value.previous;document.querySelector('[data-next]').disabled=!value.next};for(const key of ['prev','next'])document.querySelector('[data-'+key+']').onclick=()=>{const slideId=state?.[key==='prev'?'previous':'next'];if(slideId)window[${JSON.stringify(binding)}](JSON.stringify({nonce,action:'navigate',slideId}))};document.querySelector('[data-exit]').onclick=()=>window[${JSON.stringify(binding)}](JSON.stringify({nonce,action:'exit'}));`;
    const html = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; style-src &#39;unsafe-inline&#39;; script-src &#39;nonce-' + nonce + '&#39;; frame-src &#39;none&#39;; connect-src &#39;none&#39;; base-uri &#39;none&#39;"><title>Speaker notes</title><style>html{color-scheme:light dark}body{font:16px/1.5 system-ui;margin:24px;display:flex;flex-direction:column;height:calc(100vh - 48px);box-sizing:border-box}h1{font-size:20px;margin:0}textarea{flex:1;resize:none;white-space:pre-wrap;font:20px/1.6 system-ui;margin:16px 0;padding:16px;border:1px solid #8886;border-radius:8px}button{font:inherit;padding:8px 16px;margin-right:8px}</style></head><body><h1>Speaker notes</h1><p data-page></p><textarea aria-label="Speaker notes" readonly></textarea><nav><button data-prev>Previous slide</button><button data-next>Next slide</button><button data-exit>End presentation</button></nav><script nonce="' + nonce + '">' + script + '</script></body></html>';
    await nativePresentationTask(window.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html)), signal);
    return { window, async render(pages: readonly NativePresentationPage[], slideId: string) {
      if (window.isDestroyed()) return; const index = pages.findIndex(page => page.id === slideId), page = pages[index]; if (!page) throw new Error("The notes page belongs to another presentation");
      await nativePresentationTask(window.webContents.executeJavaScript("window.__bottegaNotesRender(" + JSON.stringify(nonce) + "," + JSON.stringify({ title: page.title, notes: page.notes,
        position: "Slide " + (index + 1) + " of " + pages.length, previous: pages[index - 1]?.id, next: pages[index + 1]?.id }) + ")"), signal);
    } };
  } catch (cause) { abort(); throw cause; }
}
