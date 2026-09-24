/**
 * [INPUT]: Depends on Electron IPC, the Settings → Dock channel contract, and the top-frame subscription adapter.
 * [OUTPUT]: Installs `window.systemDockSettings`: snapshot/change subscription plus fixed-purpose setup, import, preference, mode, recovery, layout-reset, conflict-resolution and login-item-settings commands.
 * [POS]: Settings preload leaf beside bridge.ts; the composition root only calls it for the main window on macOS, so other platforms never show a Dock page.
 */
import { contextBridge, ipcRenderer } from "electron";
import { SYSTEM_DOCK_SETTINGS_CHANNEL as CHANNEL, type DockSettingsSnapshot, type SystemDockSettingsBridge } from "../../../shared/system-dock/ipc";

export function installSystemDockSettingsBridge(subscribe: <T>(channel: string) => (callback: (value: T) => void) => () => void) {
  contextBridge.exposeInMainWorld("systemDockSettings", {
    snapshot: () => ipcRenderer.invoke(CHANNEL.snapshot),
    onChanged: subscribe<DockSettingsSnapshot>(CHANNEL.changed),
    beginSetup: (mode) => ipcRenderer.invoke(CHANNEL.beginSetup, mode),
    confirmSetup: (input) => ipcRenderer.invoke(CHANNEL.confirmSetup, input),
    cancelSetup: (sessionId) => ipcRenderer.invoke(CHANNEL.cancelSetup, sessionId),
    importCandidates: () => ipcRenderer.invoke(CHANNEL.importCandidates),
    confirmImport: (input) => ipcRenderer.invoke(CHANNEL.confirmImport, input),
    setPreference: (patch) => ipcRenderer.invoke(CHANNEL.setPreference, patch),
    setMode: (mode) => ipcRenderer.invoke(CHANNEL.setMode, mode),
    disable: () => ipcRenderer.invoke(CHANNEL.disable),
    restoreSystemDock: () => ipcRenderer.invoke(CHANNEL.restoreSystemDock),
    resume: () => ipcRenderer.invoke(CHANNEL.resume),
    resetLayout: () => ipcRenderer.invoke(CHANNEL.resetLayout),
    resolveConflict: (choice) => ipcRenderer.invoke(CHANNEL.resolveConflict, choice),
    openRecoverySettings: () => ipcRenderer.invoke(CHANNEL.openRecoverySettings),
  } satisfies SystemDockSettingsBridge);
}
