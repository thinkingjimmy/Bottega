/**
 * [INPUT]: Depends on isolated Electron IPC and bounded conversion contracts.
 * [OUTPUT]: Exposes review and keep-original actions without credentials, raw operations or arbitrary channels.
 * [POS]: Cloud-only conversion preload leaf for the trusted main window.
 */
import { contextBridge, ipcRenderer } from "electron";
import { CONVERSION_CHANNEL, conversionRequestSchema, conversionReviewSchema, projectPromotionReviewSchema, projectRescueRequestSchema, projectRescueReviewSchema, keepOriginalSchema, type CloudConversionBridge } from "../../../shared/cloud/conversion/model";
export function installCloudConversionBridge() {
  contextBridge.exposeInMainWorld("cloudConversion", {
    rescueReview: async input => projectRescueReviewSchema.nullable().parse(await ipcRenderer.invoke(CONVERSION_CHANNEL.rescueReview, projectRescueRequestSchema.parse(input))),
    keepRescueOriginal: input => ipcRenderer.invoke(CONVERSION_CHANNEL.keepRescueOriginal, keepOriginalSchema.parse(input)),
    projectReview: async input => projectPromotionReviewSchema.nullable().parse(await ipcRenderer.invoke(CONVERSION_CHANNEL.projectReview, conversionRequestSchema.parse(input))),
    keepProjectOriginal: input => ipcRenderer.invoke(CONVERSION_CHANNEL.keepProjectOriginal, keepOriginalSchema.parse(input)),
    review: async input => conversionReviewSchema.nullable().parse(await ipcRenderer.invoke(CONVERSION_CHANNEL.review, conversionRequestSchema.parse(input))),
    keepOriginal: input => ipcRenderer.invoke(CONVERSION_CHANNEL.keepOriginal, keepOriginalSchema.parse(input)),
  } satisfies CloudConversionBridge);
}
