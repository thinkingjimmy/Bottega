/**
 * [INPUT]: Depends on Electron IPC, typed Settings channels and the top-frame subscription adapter.
 * [OUTPUT]: Installs fixed-purpose settings controls, the dialog-free folder retry, folder move and profile erase requests, synchronous appearance facts and folder-progress events.
 * [POS]: Settings preload leaf; the composition root admits the frame before exposing this bridge.
 */
import { contextBridge, ipcRenderer } from "electron";
import { INITIAL_DARK_ARGUMENT, SETTINGS_CHANNEL, type ChatHomeStatus, type SettingsBridgeApi, type SettingsEnvelope } from "../../../shared/settings-ipc";
import type { AppLocale } from "@ai-chat/ui/lib/locale";
export function installSettingsBridge(initialLanguage: AppLocale, subscribe: <T>(channel: string) => (callback: (value: T) => void) => () => void) {
contextBridge.exposeInMainWorld("settings", {
  // Startup arguments arrive before paint; asynchronous IPC would flash the wrong theme.
  initialDark: process.argv.some(
    (argument) => argument === `${INITIAL_DARK_ARGUMENT}true`
  ),
  initialLanguage,
  onThemeResolved: subscribe<boolean>(SETTINGS_CHANNEL.themeResolved),
  get: () => ipcRenderer.invoke(SETTINGS_CHANNEL.get),
  set: (patch) => ipcRenderer.invoke(SETTINGS_CHANNEL.set, patch),
  mutateMemory: (mutation) =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.mutateMemory, mutation),
  onChanged: subscribe<SettingsEnvelope>(SETTINGS_CHANNEL.changed),
  onChatHomeStatus: subscribe<ChatHomeStatus>(SETTINGS_CHANNEL.chatHomeChanged),
  getChatHomeStatus: () =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.getChatHomeStatus),
  chooseChatHomesRoot: () =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.chooseChatHomesRoot),
  retryLibrary: () => ipcRenderer.invoke(SETTINGS_CHANNEL.retryLibrary),
  revealLibrary: () => ipcRenderer.invoke(SETTINGS_CHANNEL.revealLibrary),
  planLibraryMove: () => ipcRenderer.invoke(SETTINGS_CHANNEL.planLibraryMove),
  commitLibraryMove: (to: string) => ipcRenderer.invoke(SETTINGS_CHANNEL.commitLibraryMove, to),
  eraseAllData: (options: { trashFolder: boolean }) => ipcRenderer.invoke(SETTINGS_CHANNEL.eraseAllData, options),
  acknowledgeFullAccess: () =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.acknowledgeFullAccess),
  listBackends: () => ipcRenderer.invoke(SETTINGS_CHANNEL.listBackends),
  listModels: (backend, scope) =>
    ipcRenderer.invoke(SETTINGS_CHANNEL.listModels, backend, scope),
  getBackendDefaults: (backend) => ipcRenderer.invoke(SETTINGS_CHANNEL.getBackendDefaults, backend),
  rememberChatDefaults: (options) => ipcRenderer.invoke(SETTINGS_CHANNEL.rememberChatDefaults, options),
  patchChatOptions: (input, reset) => ipcRenderer.invoke(SETTINGS_CHANNEL.patchChatOptions, input, reset),
} satisfies SettingsBridgeApi);
}
