/**
 * [INPUT]: Depends on trusted main-frame IPC and closed cloud App request schemas.
 * [OUTPUT]: Registers fixed catalog/source facts, consent, local removal, all-device deletion, retained-file reveal and original recovery actions.
 * [POS]: Electron cloud App boundary; App windows cannot install or manage account content.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { rendererIpc } from "../../registration/ipc-registrar";
import { CLOUD_APPS_CHANNEL, cloudAppsAccountSchema, cloudAppRequestSchema, cloudAppTokenSchema, cloudAppConfirmSchema, cloudAppRemoveLocalSchema, cloudAppDeleteConfirmSchema, cloudAppCatalogSchema, cloudAppOriginSchema, cloudAppDeleteReviewSchema, cloudAppDeleteResultSchema } from "../../../../shared/cloud/apps/model";
import { replying } from "../replies";
import type { CloudAppsService } from "./service";
export function registerCloudApps(service: CloudAppsService, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "App synchronization access denied").roles("main");
  ipc.handle(CLOUD_APPS_CHANNEL.catalog, replying(cloudAppCatalogSchema, (...args) => service.catalog(z.tuple([cloudAppsAccountSchema]).parse(args)[0].expectedUserId)));
  ipc.handle(CLOUD_APPS_CHANNEL.origin, replying(cloudAppOriginSchema, (...args) => { const input = z.tuple([cloudAppRequestSchema]).parse(args)[0]; return service.origin(input.expectedUserId, input.appId); }));
  ipc.handle(CLOUD_APPS_CHANNEL.review, (...args) => { const input = z.tuple([cloudAppRequestSchema]).parse(args)[0]; return service.review(input.expectedUserId, input.appId); });
  ipc.handle(CLOUD_APPS_CHANNEL.confirm, (...args) => service.confirm(z.tuple([cloudAppConfirmSchema]).parse(args)[0]));
  ipc.handle(CLOUD_APPS_CHANNEL.removeLocal, (...args) => service.removeLocal(z.tuple([cloudAppRemoveLocalSchema]).parse(args)[0]));
  ipc.handle(CLOUD_APPS_CHANNEL.reviewDeletion, replying(cloudAppDeleteReviewSchema, (...args) => { const input = z.tuple([cloudAppRequestSchema]).parse(args)[0]; return service.reviewDeletion(input.expectedUserId, input.appId); }));
  ipc.handle(CLOUD_APPS_CHANNEL.confirmDeletion, replying(cloudAppDeleteResultSchema, (...args) => service.confirmDeletion(z.tuple([cloudAppDeleteConfirmSchema]).parse(args)[0])));
  ipc.handle(CLOUD_APPS_CHANNEL.openRetained, (...args) => { const input = z.tuple([cloudAppRequestSchema]).parse(args)[0]; return service.openRetained(input.expectedUserId, input.appId); });
  for (const action of ["discard", "retry", "cancel", "retryRemoval", "retryDeletion", "discardDeletion", "dismissDeletion"] as const) {
    const handler = (...args: unknown[]) => { const input = z.tuple([cloudAppTokenSchema]).parse(args)[0]; return service[action](input.expectedUserId, input.requestId); };
    // Only retryDeletion answers with a value the renderer reads; it leaves main in the contract's shape (OPT-34).
    ipc.handle(CLOUD_APPS_CHANNEL[action], action === "retryDeletion" ? replying(cloudAppDeleteResultSchema, handler) : handler);
  }
  const unsubscribe = service.subscribe(() => { if (!window.isDestroyed()) window.webContents.send(CLOUD_APPS_CHANNEL.changed); });
  window.webContents.once("destroyed", unsubscribe);
}
