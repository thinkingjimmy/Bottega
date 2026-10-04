/**
 * [INPUT]: Depends on the isolated Electron bridge and the shared durable composer draft contract
 * [OUTPUT]: Exposes window.composerDrafts (load/save) for F-12 durable drafts
 * [POS]: Product-window preload bridge; main validates every request, binds it to the calling window and never accepts a path
 */
import { contextBridge, ipcRenderer } from "electron";
import { COMPOSER_DRAFTS_CHANNEL, type ComposerDraftsBridgeApi } from "../../shared/composer/drafts-ipc";

export function installComposerDraftsBridge() {
  contextBridge.exposeInMainWorld("composerDrafts", {
    load: (key) => ipcRenderer.invoke(COMPOSER_DRAFTS_CHANNEL.load, key),
    save: (input) => ipcRenderer.invoke(COMPOSER_DRAFTS_CHANNEL.save, input),
  } satisfies ComposerDraftsBridgeApi);
}
