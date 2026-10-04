/**
 * [INPUT]: Depends on isolated Electron IPC and bounded conversion contracts.
 * [OUTPUT]: Exposes review and keep-original actions without credentials, raw operations or arbitrary channels.
 * [POS]: Cloud-only conversion preload leaf for the trusted main window.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CONVERSION_CHANNEL } from "../../../shared/ipc-channels/cloud";
import { type CloudConversionBridge } from "../../../shared/cloud/conversion/model";
export function installCloudConversionBridge() {
  contextBridge.exposeInMainWorld("cloudConversion", {
    rescueReview: input => ipcRenderer.invoke(CONVERSION_CHANNEL.rescueReview, input),
    keepRescueOriginal: input => ipcRenderer.invoke(CONVERSION_CHANNEL.keepRescueOriginal, input),
    projectReview: input => ipcRenderer.invoke(CONVERSION_CHANNEL.projectReview, input),
    keepProjectOriginal: input => ipcRenderer.invoke(CONVERSION_CHANNEL.keepProjectOriginal, input),
    review: input => ipcRenderer.invoke(CONVERSION_CHANNEL.review, input),
    keepOriginal: input => ipcRenderer.invoke(CONVERSION_CHANNEL.keepOriginal, input),
  } satisfies CloudConversionBridge);
}
