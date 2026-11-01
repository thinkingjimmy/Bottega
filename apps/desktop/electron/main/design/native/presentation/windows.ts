/**
 * [INPUT]: Main-owned audience/notes bounds and the one allowed immutable audience origin.
 * [OUTPUT]: Separate sandboxed windows with no authored popup/navigation/permission/network authority and actual OS fullscreen admission.
 * [POS]: Native presentation window boundary; it does not alter app, shell or authored-content CSP.
 */
import { randomUUID } from "node:crypto";
import { BrowserWindow } from "electron";
export function nativePresentationWindow(title: string, origin?: string) {
  const window = new BrowserWindow({ title, show: false, fullscreen: false, fullscreenable: Boolean(origin), simpleFullscreen: false, width: origin ? 1280 : 800, height: origin ? 720 : 600, minWidth: 400, minHeight: 300,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: false, partition: "native-present-" + randomUUID() } });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", event => event.preventDefault());
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, reply) => reply(false));
  window.webContents.session.webRequest.onBeforeRequest({ urls: ["http://*/*", "https://*/*", "file://*/*", "ws://*/*", "wss://*/*", "ftp://*/*"] }, (request, reply) => reply({ cancel: !origin || new URL(request.url).origin !== origin }));
  return window;
}
export async function enterNativePresentationFullscreen(window: BrowserWindow) {
  await new Promise<void>((resolve, reject) => {
    const done = () => { clearTimeout(timer); window.removeListener("closed", closed); resolve(); };
    const closed = () => { clearTimeout(timer); window.removeListener("enter-full-screen", done); reject(new Error("The presentation window closed before fullscreen")); };
    const timer = setTimeout(() => { window.removeListener("enter-full-screen", done); window.removeListener("closed", closed); reject(new Error("The operating system did not enter fullscreen")); }, 8000);
    window.once("enter-full-screen", done); window.once("closed", closed); window.show(); window.setFullScreen(true);

  });
  if (window.isDestroyed() || !window.isFullScreen()) throw new Error("The operating system did not enter fullscreen");
}
export async function destroyNativePresentationWindow(window: BrowserWindow) {
  if (window.isDestroyed()) return;
  if (window.isFullScreen()) await new Promise<void>(resolve => {
    const done = () => { clearTimeout(timer); resolve(); }, timer = setTimeout(done, 2000);
    window.once("leave-full-screen", done); window.setFullScreen(false);
  });
  if (!window.isDestroyed()) window.destroy();
}

export function nativePresentationTask<T>(task: Promise<T>, signal: AbortSignal, timeout = 10000): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); };
    const abort = () => { cleanup(); reject(signal.reason ?? new Error("The presentation closed")); };
    const timer = setTimeout(() => { cleanup(); reject(new Error("The presentation window operation timed out")); }, timeout);
    signal.addEventListener("abort", abort, { once: true });
    task.then(value => { cleanup(); resolve(value); }, cause => { cleanup(); reject(cause); });
    if (signal.aborted) abort();
  });
}
