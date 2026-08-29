/**
 * [INPUT]: Depends on Electron BrowserWindow/CDP, an already authorized complete HTML canvas, a fixed viewport, AbortSignal, and an image byte target
 * [OUTPUT]: Provides a hermetic opaque-child JPEG capture with preflight cancellation, abort-raced liveness bounds, deterministic debugger/window teardown, and adaptive quality/scale budgeting
 * [POS]: Design's screenshot renderer; workspace authorization stays in the toolset and no renderer/user identity enters this process-owned window
 */

import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 820, height: 1180 },
  mobile: { width: 390, height: 844 },
} as const;

export type DesignRenderViewport = keyof typeof VIEWPORTS;

export type DesignRenderInput = Readonly<{
  html: Buffer | string;
  viewport: DesignRenderViewport;
  maxImageBytes: number;
  signal: AbortSignal;
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
  return captureDesignCanvasWithRuntime(input, ELECTRON_RUNTIME);
}

export async function captureDesignCanvasWithRuntime(
  input: DesignRenderInput,
  runtime: DesignRenderRuntime
) {
  throwIfAborted(input.signal);
  const trace = (stage: string) => {
    if (process.env.AI_CHAT_DESIGN_E2E === "1") {
      console.info(`[design-render] ${stage}`);
    }
  };
  trace("create-window");
  const size = VIEWPORTS[input.viewport];
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
      partition: `design-render-${randomUUID()}`,
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
  try {
    const source = Buffer.isBuffer(input.html) ? input.html.toString("utf8") : input.html;
    const authoredUrl = `data:text/html;base64,${Buffer.from(source).toString("base64")}`;
    const shell = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;width:100%;height:100%;border:0}</style><iframe id="canvas" title="Design canvas" sandbox="allow-scripts" src="${authoredUrl}" onload="this.dataset.ready='1'"></iframe>`;
    trace("load");
    // The process-owned top document remains stable while authored HTML runs in
    // an opaque sandboxed child, so `top` navigation cannot replace the capture.
    const domReady = waitForDomReady(contents, input.signal);
    void contents
      .loadURL(`data:text/html;base64,${Buffer.from(shell).toString("base64")}`)
      .catch(() => undefined);
    await domReady;
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
    contents.debugger.attach("1.3");
    const captured = await boundedCapture(
      contents.debugger,
      size,
      Math.max(8 * 1024, input.maxImageBytes),
      input.signal
    );
    trace(`captured:${captured.bytes}`);
    return { ...captured, viewport: input.viewport };
  } finally {
    trace("close");
    input.signal.removeEventListener("abort", abort);
    destroyWindow();
  }
}

async function boundedCapture(
  debuggerClient: BrowserWindow["webContents"]["debugger"],
  size: Readonly<{ width: number; height: number }>,
  maxImageBytes: number,
  signal: AbortSignal
) {
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
  throw Object.assign(new Error(`Design screenshot exceeds ${maxImageBytes} image bytes`), { status: 413 });
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
          () => reject(Object.assign(new Error(`${label} exceeded ${timeoutMs}ms`), { status: 504 })),
          timeoutMs
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener("abort", onAbort);
  }
}
