/**
 * [INPUT]: Electron's isolated native window, minimal preload IPC, bundled HTML and typed presentation/action models.
 * [OUTPUT]: A main-owned desktop dialog with revision-checked actions, native close, bounded sizing and local copy feedback.
 * [POS]: Shared recovery/quit surface available before the workspace or development server starts.
 */
import { randomBytes } from "node:crypto";
import { app, BrowserWindow, ipcMain, screen, type IpcMainEvent } from "electron";
import { join } from "node:path";
import { windowBackgroundColor } from "../../../window/native-theme";
import { dialogDocument, dialogMarkup } from "./document";
import type { DesktopDialogAction, DesktopDialogModel } from "./types";

export type DesktopDialog = {
  window: BrowserWindow;
  closed: Promise<void>;
  update(model: DesktopDialogModel): Promise<void>;
  label(action: string, text: string): Promise<void>;
  close(): void;
};

export async function openDesktopDialog(input: { locale: string; model: DesktopDialogModel;
  onAction(action: DesktopDialogAction): void; onClose?(): void }): Promise<DesktopDialog> {
  const token = randomBytes(24).toString("hex"), nonce = randomBytes(24).toString("hex");
  let current = input.model, revision = 0, closing = false, resolveClosed!: () => void;
  const closed = new Promise<void>(resolve => { resolveClosed = resolve; });
  const window = new BrowserWindow({ width:600, height:260, minWidth:400, useContentSize:true, show:false,
    title:app.getName(), frame:true, resizable:true, minimizable:false, maximizable:false, fullscreenable:false,
    autoHideMenuBar:true, backgroundColor:windowBackgroundColor(),
    webPreferences:{ preload:join(__dirname, "../preload/desktop-dialog.js"), contextIsolation:true, sandbox:true, nodeIntegration:false, devTools:false, navigateOnDragDrop:false } });
  window.setMenu(null);
  window.webContents.setWindowOpenHandler(() => ({ action:"deny" }));
  window.webContents.on("will-attach-webview", event => event.preventDefault());
  window.webContents.on("will-navigate", event => event.preventDefault());
  const receive = (event:IpcMainEvent, intent:unknown) => {
    if (closing || current.busy || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return;
    if (!intent || typeof intent !== "object") return;
    const value = intent as Record<string, unknown>;
    if (value.token !== token || value.revision !== revision || typeof value.action !== "string"
      || (value.selection !== undefined && typeof value.selection !== "string")) return;
    const id = value.action, selection = value.selection as string | undefined;
    if (selection && !current.candidates?.some(item => item.id === selection)) return;
    if (id === "select" && selection) {
      current = { ...current, selection };
      input.onAction({ id, selection });
      return;
    }
    const button = [...current.actions, ...(current.support ?? [])].find(item => item.id === id);
    if (button ? button.disabled || (button.requiresSelection && !selection) : !(id === "search" && current.retry) && !(id === "cancel-new" && current.cancelNew)) return;
    input.onAction({ id, selection });
  };
  ipcMain.on("desktop-dialog:action", receive);
  window.on("closed", () => { closing = true; ipcMain.removeListener("desktop-dialog:action", receive); input.onClose?.(); resolveClosed(); });
  const size = async () => {
    if (window.isDestroyed()) return;
    const height = await window.webContents.executeJavaScript("document.querySelector('main').scrollHeight");
    if (window.isDestroyed()) return;
    const available = screen.getDisplayMatching(window.getBounds()).workAreaSize.height - 100;
    window.setContentSize(window.getContentSize()[0], Math.min(Math.max(200, Math.ceil(height)), Math.max(200, available)));
  };
  const focus = async (action?: string) => {
    if (!action || window.isDestroyed()) return;
    await window.webContents.executeJavaScript(`document.querySelector('[data-action='+${JSON.stringify(action)}+']')?.focus()`);
  };
  try {
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(dialogDocument({ locale:input.locale, name:app.getName(), nonce, token, model:current }))}`);
    if (!window.isDestroyed()) { await size(); await focus(current.defaultAction); window.show(); }
  } catch (error) { if (!window.isDestroyed()) window.destroy(); throw error; }
  return {
    window, closed,
    async update(model) {
      if (closing || window.isDestroyed()) return;
      current = model; revision++;
      const html = dialogMarkup(model, revision);
      await window.webContents.executeJavaScript(`(() => {
        const active = document.activeElement, action = active?.dataset.action, selection = active?.value;
        document.querySelector('main').outerHTML = ${JSON.stringify(html)};
        const target = action ? [...document.querySelectorAll('[data-action]')].find(item => item.dataset.action === action)
          : [...document.querySelectorAll('input')].find(item => item.value === selection);
        if (target && !target.disabled) target.focus();
      })()`);
      await size();
    },
    async label(action, text) {
      if (closing || window.isDestroyed()) return;
      await window.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('[data-action]')].find(item => item.dataset.action === ${JSON.stringify(action)});
        if (button) { button.style.minWidth = button.getBoundingClientRect().width + 'px'; button.textContent = ${JSON.stringify(text)}; } })()`);
    },
    close() { if (!window.isDestroyed()) window.close(); },
  };
}
