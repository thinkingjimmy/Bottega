/**
 * [INPUT]: Depends on isolated Electron IPC and the fixed Base synchronization schemas.
 * [OUTPUT]: Exposes bounded status/comparison reads, reviewed candidate decisions/copies and change events.
 * [POS]: apps/desktop/electron/preload/cloud; Cloud-only main-frame bridge; no raw operations, storage state or credentials cross it.
 */
import { contextBridge, ipcRenderer } from "electron";
import { BASE_SYNC_CHANNEL } from "../../../shared/ipc-channels/cloud";
import { type CloudBaseBridge } from "../../../shared/cloud/base";
export function installCloudBaseBridge() {
  contextBridge.exposeInMainWorld("cloudBase", {
    review: input => ipcRenderer.invoke(BASE_SYNC_CHANNEL.review, input),
    detail: input => ipcRenderer.invoke(BASE_SYNC_CHANNEL.detail, input),
    decide: input => ipcRenderer.invoke(BASE_SYNC_CHANNEL.decide, input),
    copy: input => ipcRenderer.invoke(BASE_SYNC_CHANNEL.copy, input),
    onChanged: changed => {
      const receive = () => changed(); ipcRenderer.on(BASE_SYNC_CHANNEL.changed, receive);
      return () => { ipcRenderer.removeListener(BASE_SYNC_CHANNEL.changed, receive); };
    },
  } satisfies CloudBaseBridge);
}
