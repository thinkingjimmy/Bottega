/**
 * [INPUT]: Exact prepared board bytes, fixed viewport, selected paper and bounded signal.
 * [OUTPUT]: Offline native PDF bytes with fixed single-page or actual flow pagination.
 * [POS]: Export-only opaque data renderer; no preload, credentials, file or network access.
 */
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
import { DESIGN_FRAME_CSP } from "@ai-chat/cloud-protocol/artifacts/design/frame";
export const guardDesignExportHtml = (html: string) => `<!doctype html><meta http-equiv="Content-Security-Policy" content="${DESIGN_FRAME_CSP}"><script>for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','Worker','SharedWorker']){try{Object.defineProperty(window,name,{value:undefined,writable:false,configurable:false});}catch{}}window.open=()=>null;</script>` + html.replace(/<!doctype[^>]*>/i, "");
export async function printDesignBoard(html: string, size: { width: number; height: number }, flow: boolean, paper: "a4" | "letter", signal: AbortSignal) {
  signal.throwIfAborted();
  const window = new BrowserWindow({ show: false, width: size.width, height: size.height, useContentSize: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, partition: "design-export-" + randomUUID() } });
  const contents = window.webContents, errors: string[] = [];
  const destroy = () => { if (!window.isDestroyed()) window.destroy(); };
  signal.addEventListener("abort", destroy, { once: true });
  contents.setWindowOpenHandler(() => ({ action: "deny" })); contents.on("will-navigate", event => event.preventDefault());
  contents.session.setPermissionCheckHandler(() => false); contents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  contents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "file://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"] }, (_request, reply) => reply({ cancel: true }));
  contents.on("console-message", details => { if (details.level === "error" && errors.length < 8) errors.push(details.message.slice(0, 300)); });
  const bounded = <T>(task: Promise<T>) => new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason); signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
  try {
    await bounded(contents.loadURL("data:text/html;charset=utf-8;base64," + Buffer.from(guardDesignExportHtml(html)).toString("base64")));
    await bounded(contents.executeJavaScript("Promise.all([document.fonts.ready, ...Array.from(document.images).map(image=>image.complete?Promise.resolve():new Promise(resolve=>{image.addEventListener('load',resolve,{once:true});image.addEventListener('error',resolve,{once:true});}))]).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))"));
    signal.throwIfAborted();
    const bytes = await bounded(contents.printToPDF({ printBackground: true, displayHeaderFooter: false, scale: 1,
      pageSize: flow ? paper === "a4" ? "A4" : "Letter" : { width: size.width / 96, height: size.height / 96 },
      margins: { top: flow ? .4 : 0, bottom: flow ? .4 : 0, left: flow ? .4 : 0, right: flow ? .4 : 0 },
      preferCSSPageSize: false, ...(flow ? {} : { pageRanges: "1" }), generateTaggedPDF: true }));
    if (errors.length) throw new Error("PDF render failed: " + errors.join("; "));
    return bytes;
  } finally { signal.removeEventListener("abort", destroy); destroy(); }
}
