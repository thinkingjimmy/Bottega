/**
 * [INPUT]: Depends on isolated Electron IPC and fixed cloud App contracts.
 * [OUTPUT]: Exposes fixed account-fenced catalog, disclosure, install/removal/deletion, retained-file reveal and original recovery actions.
 * [POS]: Cloud-only trusted main-window bridge; no source files or network authority reach the renderer.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CLOUD_APPS_CHANNEL, cloudAppsAccountSchema, cloudAppRequestSchema, cloudAppTokenSchema, cloudAppConfirmSchema, cloudAppRemoveLocalSchema,
  cloudAppCatalogSchema, cloudAppDeleteConfirmSchema, cloudAppDeleteReviewSchema, cloudAppDeleteResultSchema, cloudAppOriginSchema, type CloudAppsBridge } from "../../../shared/cloud/apps/model";
export function installCloudAppsBridge() {
  contextBridge.exposeInMainWorld("cloudApps", {
    catalog: async input => cloudAppCatalogSchema.parse(await ipcRenderer.invoke(CLOUD_APPS_CHANNEL.catalog, cloudAppsAccountSchema.parse(input))),
    origin: async input => cloudAppOriginSchema.parse(await ipcRenderer.invoke(CLOUD_APPS_CHANNEL.origin, cloudAppRequestSchema.parse(input))),
    review: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.review, cloudAppRequestSchema.parse(input)),
    confirm: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.confirm, cloudAppConfirmSchema.parse(input)),
    discard: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.discard, cloudAppTokenSchema.parse(input)),
    retry: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.retry, cloudAppTokenSchema.parse(input)),
    cancel: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.cancel, cloudAppTokenSchema.parse(input)),
    removeLocal: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.removeLocal, cloudAppRemoveLocalSchema.parse(input)),
    retryRemoval: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.retryRemoval, cloudAppTokenSchema.parse(input)),
    openRetained: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.openRetained, cloudAppRequestSchema.parse(input)),
    reviewDeletion: async input => cloudAppDeleteReviewSchema.parse(await ipcRenderer.invoke(CLOUD_APPS_CHANNEL.reviewDeletion, cloudAppRequestSchema.parse(input))),
    confirmDeletion: async input => cloudAppDeleteResultSchema.parse(await ipcRenderer.invoke(CLOUD_APPS_CHANNEL.confirmDeletion, cloudAppDeleteConfirmSchema.parse(input))),
    retryDeletion: async input => cloudAppDeleteResultSchema.parse(await ipcRenderer.invoke(CLOUD_APPS_CHANNEL.retryDeletion, cloudAppTokenSchema.parse(input))),
    discardDeletion: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.discardDeletion, cloudAppTokenSchema.parse(input)),
    dismissDeletion: input => ipcRenderer.invoke(CLOUD_APPS_CHANNEL.dismissDeletion, cloudAppTokenSchema.parse(input)),
    onChanged: listener => { const receive = () => listener(); ipcRenderer.on(CLOUD_APPS_CHANNEL.changed, receive);
      return () => { ipcRenderer.removeListener(CLOUD_APPS_CHANNEL.changed, receive); }; },
  } satisfies CloudAppsBridge);
}
