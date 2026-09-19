/**
 * [INPUT]: Depends on trusted main-frame IPC and closed Base review/decision schemas.
 * [OUTPUT]: Registers fixed Base synchronization inspection, candidate decisions and copy requests with bounded change notifications.
 * [POS]: Electron boundary; App windows and child frames receive no synchronization management authority.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { rendererIpc } from "../../ipc-registrar";
import { BASE_SYNC_CHANNEL, baseSyncReviewRequestSchema, baseCandidateRequestSchema, baseCandidateDecisionSchema, baseCandidateCopySchema } from "../../../../shared/cloud/base";
import type { CloudBaseReview } from "./review";
export function registerCloudBaseReview(service: CloudBaseReview, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "Base synchronization access denied").roles("main");
  ipc.handle(BASE_SYNC_CHANNEL.review, (...args) => service.review(z.tuple([baseSyncReviewRequestSchema]).parse(args)[0]));
  ipc.handle(BASE_SYNC_CHANNEL.detail, (...args) => service.detail(z.tuple([baseCandidateRequestSchema]).parse(args)[0]));
  ipc.handle(BASE_SYNC_CHANNEL.decide, (...args) => service.decide(z.tuple([baseCandidateDecisionSchema]).parse(args)[0]));
  ipc.handle(BASE_SYNC_CHANNEL.copy, (...args) => service.copy(z.tuple([baseCandidateCopySchema]).parse(args)[0]));
  const unsubscribe = service.subscribe(() => { if (!window.isDestroyed()) window.webContents.send(BASE_SYNC_CHANNEL.changed); });
  window.webContents.once("destroyed", unsubscribe);
}
