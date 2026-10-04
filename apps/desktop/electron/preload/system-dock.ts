/**
 * [INPUT]: Depends on Electron contextBridge/ipcRenderer, the launch argument naming this window's role, and (type-only) the isolated Bottega Dock channel contract.
 * [OUTPUT]: Exposes `window.systemDock` (role, snapshot, enumerated intents, icon lookup, bounded change subscription) to the bar or panel main frame only.
 * [POS]: Auxiliary preload beside task-panel.ts; no product settings, file, shell, account, AX, or Apple Event bridge is reachable from here (INV-13).
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { DockBarSnapshot, PanelSnapshot, SystemDockBridge, SYSTEM_DOCK_CHANNEL } from "../../shared/system-dock/ipc";

/* The contract module also carries the zod intent validators main needs; importing its value
   here would bundle ~470 KB of zod into a preload that lives in every Dock renderer. The
   literal types of `typeof SYSTEM_DOCK_CHANNEL` still make any drift a compile error. */
const CHANNEL: typeof SYSTEM_DOCK_CHANNEL = {
  snapshot: "system-dock:snapshot",
  changed: "system-dock:changed",
  intent: "system-dock:intent",
  icons: "system-dock:icons",
};
const ROLE_ARGUMENT = "--system-dock-role=";
const role = process.argv.find((argument) => argument.startsWith(ROLE_ARGUMENT))?.slice(ROLE_ARGUMENT.length);
/* Fail closed: a window launched without a known role gets no bridge at all rather than a guessed one. */
if (process.isMainFrame && (role === "bar" || role === "panel")) contextBridge.exposeInMainWorld("systemDock", {
  role,
  snapshot: () => ipcRenderer.invoke(CHANNEL.snapshot),
  intent: (intent) => ipcRenderer.invoke(CHANNEL.intent, intent),
  icons: (keys) => ipcRenderer.invoke(CHANNEL.icons, [...keys]),
  onChanged(listener) {
    const receive = (_event: IpcRendererEvent, value: DockBarSnapshot | PanelSnapshot) => listener(value);
    ipcRenderer.on(CHANNEL.changed, receive);
    return () => { ipcRenderer.removeListener(CHANNEL.changed, receive); };
  },
} satisfies SystemDockBridge);
