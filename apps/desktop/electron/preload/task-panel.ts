/**
 * [INPUT]: Depends on Electron contextBridge/ipcRenderer and the private panel channel contract.
 * [OUTPUT]: Provides only snapshot, bounded update subscription, and enumerated task-panel intents.
 * [POS]: Auxiliary preload; no product settings, file, shell, turn, or database bridge is exposed.
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { PANEL_CHANNEL, type TaskPanelBridge, type TaskPanelSnapshot } from "../../shared/presence-ipc";
if (process.isMainFrame) contextBridge.exposeInMainWorld("taskPanel", {
  snapshot: () => ipcRenderer.invoke(PANEL_CHANNEL.snapshot),
  intent: (intent) => ipcRenderer.invoke(PANEL_CHANNEL.intent, intent),
  onChanged(listener) {
    const receive = (_event: IpcRendererEvent, value: TaskPanelSnapshot) => listener(value);
    ipcRenderer.on(PANEL_CHANNEL.changed, receive);
    return () => { ipcRenderer.removeListener(PANEL_CHANNEL.changed, receive); };
  },
} satisfies TaskPanelBridge);
