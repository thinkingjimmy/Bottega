/**
 * [INPUT]: Depends on isolated Electron IPC and fixed cloud App contracts.
 * [OUTPUT]: Exposes fixed account-fenced catalog, disclosure, install/removal/deletion, retained-file reveal and original recovery actions.
 * [POS]: Cloud-only trusted main-window bridge; no source files or network authority reach the renderer.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CLOUD_APPS_CHANNEL } from "../../../shared/ipc-channels/cloud";
import { type CloudAppsBridge } from "../../../shared/cloud/apps/model";
export function installCloudAppsBridge() {
  contextBridge.exposeInMainWorld("cloudApps", {
    catalog: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.catalog, input),
    origin: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.origin, input),
    review: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.review, input),
    confirm: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.confirm, input),
    discard: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.discard, input),
    retry: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.retry, input),
    cancel: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.cancel, input),
    removeLocal: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.removeLocal, input),
    retryRemoval: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.retryRemoval, input),
    openRetained: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.openRetained, input),
    reviewDeletion: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.reviewDeletion, input),
    confirmDeletion: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.confirmDeletion, input),
    retryDeletion: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.retryDeletion, input),
    discardDeletion: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.discardDeletion, input),
    dismissDeletion: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.dismissDeletion, input),
    onChanged: listener => { const receive = () => listener(); ipcRenderer.on(CLOUD_APPS_CHANNEL.changed, receive);
      return () => { ipcRenderer.removeListener(CLOUD_APPS_CHANNEL.changed, receive); }; },
  } satisfies CloudAppsBridge);
}
