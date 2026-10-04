/**
 * [INPUT]: Electron contextBridge and ipcRenderer in the isolated top frame.
 * [OUTPUT]: A single desktopDialog.send intent channel without filesystem, product or diagnostic access.
 * [POS]: Self-contained sandbox preload for bundled recovery and quit windows.
 */
import { contextBridge, ipcRenderer } from "electron";

if (process.isMainFrame) contextBridge.exposeInMainWorld("desktopDialog", {
  send: (intent: unknown) => ipcRenderer.send("desktop-dialog:action", intent),
});
