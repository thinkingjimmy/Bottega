/**
 * [INPUT]: Depends on isolated Electron IPC and the fixed Base synchronization schemas.
 * [OUTPUT]: Exposes bounded status/comparison reads, reviewed candidate decisions/copies and change events.
 * [POS]: Cloud-only main-frame bridge; no raw operations, storage state or credentials cross it.
 */
import { contextBridge, ipcRenderer } from "electron";
import { BASE_SYNC_CHANNEL, baseSyncReviewRequestSchema, baseCandidateRequestSchema, baseCandidateDecisionSchema,
  baseCandidateCopySchema, baseSyncIdentitySchema, baseSyncReviewSchema, baseCandidateDetailSchema, type CloudBaseBridge } from "../../shared/cloud/base";
export function installCloudBaseBridge() {
  contextBridge.exposeInMainWorld("cloudBase", {
    review: async input => baseSyncReviewSchema.nullable().parse(await ipcRenderer.invoke(BASE_SYNC_CHANNEL.review, baseSyncReviewRequestSchema.parse(input))),
    detail: async input => baseCandidateDetailSchema.parse(await ipcRenderer.invoke(BASE_SYNC_CHANNEL.detail, baseCandidateRequestSchema.parse(input))),
    decide: input => ipcRenderer.invoke(BASE_SYNC_CHANNEL.decide, baseCandidateDecisionSchema.parse(input)),
    copy: async input => baseSyncIdentitySchema.parse(await ipcRenderer.invoke(BASE_SYNC_CHANNEL.copy, baseCandidateCopySchema.parse(input))),
    onChanged: changed => {
      const receive = () => changed(); ipcRenderer.on(BASE_SYNC_CHANNEL.changed, receive);
      return () => { ipcRenderer.removeListener(BASE_SYNC_CHANNEL.changed, receive); };
    },
  } satisfies CloudBaseBridge);
}
