/**
 * [INPUT]: Depends on parse5 source spans, Electron BrowserWindow/CDP, an already authorized complete HTML canvas, a fixed viewport, AbortSignal, and an image byte target, and statusError from main/errors
 * [OUTPUT]: Hermetic live/static opaque srcdoc captures in two bounded in-memory profiles with optional hidden scrollbars, script-free static mode, bounded lifetime, teardown and exact-size PNG exports.
 * [POS]: Design's screenshot renderer; workspace authorization stays in the toolset and no renderer/user identity enters this process-owned window
 */

import { compositionOverrides } from "../../startup/boot/composition-hooks";
import { BrowserWindow } from "electron";
import { statusError } from "../../ipc/errors";
import { parse } from "parse5";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

export type DesignRenderViewport = keyof typeof VIEWPORTS;

type DesignRenderInput = Readonly<{
  html: Buffer | string;
  viewport: DesignRenderViewport;
  maxImageBytes: number;
  signal: AbortSignal;
  size?: Readonly<{ width: number; height: number }>;
  format?: "jpeg" | "png";
  static?: boolean;
  hideScrollbars?: boolean;
}>;

type DesignRenderWindow = Pick<BrowserWindow, "webContents" | "isDestroyed" | "destroy">;

export type DesignRenderRuntime = Readonly<{
  createWindow(
    options: ConstructorParameters<typeof BrowserWindow>[0]
  ): DesignRenderWindow;
}>;

const ELECTRON_RUNTIME: DesignRenderRuntime = {
  createWindow: (options) => new BrowserWindow(options),
};

export function captureDesignCanvas(input: DesignRenderInput) {
  return captureDesignCanvasWithRuntime({ ...input, signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]) }, ELECTRON_RUNTIME);
}

export async function captureDesignCanvasWithRuntime(
  input: DesignRenderInput,
  runtime: DesignRenderRuntime
) {
  throwIfAborted(input.signal);
  const trace = (stage: string) => compositionOverrides.designRenderTrace?.(stage);
  trace("create-window");
  const size = input.size ?? VIEWPORTS[input.viewport];
  const window = runtime.createWindow({
    show: false,
    width: size.width,
    height: size.height,
    useContentSize: true,
    webPreferences: {
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      partition: input.static ? "design-render-static" : "design-render-scripted",
    },
  });
  const contents = window.webContents;
  let destroyed = false;
  let debuggerDetached = false;
  const detachDebugger = () => {
    if (debuggerDetached) return;
    try {
      if (!contents.debugger.isAttached()) return;
      contents.debugger.detach();
      debuggerDetached = true;
    } catch { /* Window teardown already won. */ }
  };
  const destroyWindow = () => {
    if (destroyed) return;
    detachDebugger();
    destroyed = true;
    if (!window.isDestroyed()) window.destroy();
  };
  const abort = () => destroyWindow();
  input.signal.addEventListener("abort", abort, { once: true });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.session.setPermissionCheckHandler(() => false);
  contents.session.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  contents.session.webRequest.onBeforeRequest({
    urls: [
      "http://*/*",
      "https://*/*",
      "ws://*/*",
      "wss://*/*",
      "ftp://*/*",
      "file://*/*",
    ],
  }, (_details, callback) => callback({ cancel: true }));
  const runtimeErrors: string[] = [];
  const rememberError = (value: string) => { if (runtimeErrors.length < 8) runtimeErrors.push(value.slice(0, 300)); };
  const consoleError = (details: { level: string; message: string }) => {
    if (details.level === "error") rememberError(details.message);
  };
  contents.on("console-message", consoleError);
  try {
    const raw = Buffer.isBuffer(input.html) ? input.html.toString("utf8") : input.html;
    const source = input.static ? staticHtml(raw) : raw;
    const policy = "default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data: blob:; img-src data: blob:; font-src data: blob:; media-src data: blob:; connect-src data: blob:; frame-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'";
    // Install policy and the UDP-network backstop before any authored script, including scripts outside head.
    const guard = "for(const name of ['RTCPeerConnection','webkitRTCPeerConnection','RTCIceGatherer']){try{Object.defineProperty(globalThis,name,{value:undefined,writable:false,configurable:false})}catch{}}";
    // Apply thumbnail presentation inside the opaque child, not the capture shell.
    const scrollbars = input.hideScrollbars ? "<style>*{scrollbar-width:none!important}::-webkit-scrollbar{display:none!important}</style>" : "";
    const guarded = source.replace(/<html\b[^>]*>/i, value => `${value}<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}">${scrollbars}${input.static ? "" : `<script>${guard}</script>`}</head>`);
    const shell = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><body></body>`;
    trace("load");
    // The process-owned top document remains stable while authored HTML runs in
    // an opaque sandboxed child, so `top` navigation cannot replace the capture.
    // srcdoc keeps large embedded resources out of the child navigation URL.
    const domReady = waitForDomReady(contents, input.signal);
    void contents
      .loadURL(`data:text/html;base64,${Buffer.from(shell).toString("base64")}`)
      .catch(() => undefined);
    await domReady;
    contents.debugger.attach("1.3");
    await within(contents.debugger.sendCommand("Page.addScriptToEvaluateOnNewDocument", { source: guard }),
      2_000, "Design network isolation", input.signal);
    await within(contents.executeJavaScript(
      `const frame=document.createElement('iframe');frame.id='canvas';frame.title='Design canvas';frame.setAttribute('sandbox',${JSON.stringify(input.static ? "" : "allow-scripts")});frame.onload=()=>{frame.dataset.ready='1'};frame.srcdoc=${JSON.stringify(guarded)};document.body.append(frame);`, true
    ), 2_000, "Design child creation", input.signal);
    trace("settle");
    await within(
      contents.executeJavaScript(
        "new Promise(r=>{const f=document.getElementById('canvas');if(f.dataset.ready==='1')r();else f.addEventListener('load',r,{once:true})}).then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))",
        true
      ),
      5_000,
      "Design canvas visual settle",
      input.signal
    );
    // Authored async fetch/XHR/media may remain pending after its document load;
    // those requests cannot own tool liveness once the visual settle point exists.
    contents.stop();
    throwIfAborted(input.signal);
    trace("attach-debugger");
    await within(contents.debugger.sendCommand("Runtime.enable"), 2_000, "Design runtime diagnostics", input.signal);
    const captured = await boundedCapture(
      contents.debugger,
      size,
      Math.max(8 * 1024, input.maxImageBytes),
      input.signal, input.format
    );
    trace(`captured:${captured.bytes}`);
    if (runtimeErrors.length) throw statusError(422, `Design render failed: ${runtimeErrors.join("; ")}`);
    return { ...captured, viewport: input.viewport };
  } finally {
    trace("close");
    input.signal.removeEventListener("abort", abort);
    contents.removeListener("console-message", consoleError);
    destroyWindow();
  }
}

function staticHtml(html: string) {
  const spans: { startOffset: number; endOffset: number }[] = [];
  type Node = { tagName?: string; sourceCodeLocation?: { startOffset: number; endOffset: number; attrs?: Record<string, { startOffset: number; endOffset: number }> } | null; childNodes?: Node[]; content?: Node };
  const visit = (node: Node): void => {
    if (node.tagName === "script" && node.sourceCodeLocation) spans.push(node.sourceCodeLocation);
    else {
      for (const [name, location] of Object.entries(node.sourceCodeLocation?.attrs ?? {})) if (/^on/i.test(name)) spans.push(location);
      for (const child of node.childNodes ?? []) visit(child); if (node.content) visit(node.content);
    }
  };
  visit(parse(html, { sourceCodeLocationInfo: true }) as Node);
  for (const span of spans.sort((a, b) => b.startOffset - a.startOffset)) html = html.slice(0, span.startOffset) + html.slice(span.endOffset);
  return html;
}

async function boundedCapture(
  debuggerClient: BrowserWindow["webContents"]["debugger"],
  size: Readonly<{ width: number; height: number }>,
  maxImageBytes: number,
  signal: AbortSignal,
  format: "jpeg" | "png" = "jpeg"
) {
  if (format === "png") {
    const result = await within(debuggerClient.sendCommand("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false,
      clip: { x: 0, y: 0, width: size.width, height: size.height, scale: 1 } }), 10_000, "Design PNG capture", signal) as { data: string };
    const bytes = Buffer.byteLength(result.data, "base64");
    if (bytes > maxImageBytes) throw statusError(413, "PNG exceeds the complete export budget");
    return { data: result.data, bytes, width: size.width, height: size.height, quality: 100 };
  }
  const qualities = [82, 68, 52, 38, 26, 18];
  const scales = [1, 0.75, 0.5, 0.375, 0.25];
  let smallest: Readonly<{ data: string; bytes: number; width: number; height: number; quality: number }> | null = null;
  for (const scale of scales) {
    for (const quality of qualities) {
      const result = await within(
        debuggerClient.sendCommand("Page.captureScreenshot", {
          format: "jpeg",
          quality,
          fromSurface: true,
          captureBeyondViewport: false,
          clip: { x: 0, y: 0, width: size.width, height: size.height, scale },
        }) as Promise<{ data: string }>,
        8_000,
        "Design screenshot capture",
        signal
      );
      const candidate = {
        data: result.data,
        bytes: Buffer.byteLength(result.data, "base64"),
        width: Math.round(size.width * scale),
        height: Math.round(size.height * scale),
        quality,
      };
      if (!smallest || candidate.bytes < smallest.bytes) smallest = candidate;
      if (candidate.bytes <= maxImageBytes) return candidate;
    }
  }
  if (smallest && smallest.bytes <= maxImageBytes) return smallest;
  throw statusError(413, `Design screenshot exceeds ${maxImageBytes} image bytes`);
}

function abortError() {
  return new DOMException("Design render check cancelled", "AbortError");
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

async function waitForDomReady(
  contents: BrowserWindow["webContents"],
  signal: AbortSignal
) {
  let onReady: () => void = () => undefined;
  const operation = new Promise<void>((resolve) => {
    onReady = resolve;
    contents.once("dom-ready", onReady);
  });
  try {
    await within(operation, 10_000, "Design canvas DOM load", signal);
  } finally {
    contents.removeListener("dom-ready", onReady);
  }
}

async function within<T>(
  operation: Promise<T>,
  timeoutMs: number,
  label: string,
  signal: AbortSignal
) {
  throwIfAborted(signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([
      operation,
      aborted,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(statusError(504, `${label} exceeded ${timeoutMs}ms`)),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
