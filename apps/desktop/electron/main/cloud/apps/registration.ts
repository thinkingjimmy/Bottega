/**
 * [INPUT]: Depends on trusted main-frame IPC and closed cloud App request schemas.
 * [OUTPUT]: Registers fixed catalog/source facts, consent, local removal, all-device deletion, retained-file reveal and original recovery actions.
 * [POS]: Electron cloud App boundary; App windows cannot install or manage account content.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { rendererIpc } from "../../ipc-registrar";
import { CLOUD_APPS_CHANNEL, cloudAppsAccountSchema, cloudAppRequestSchema, cloudAppTokenSchema, cloudAppConfirmSchema, cloudAppRemoveLocalSchema, cloudAppDeleteConfirmSchema } from "../../../../shared/cloud/apps/model";
import type { CloudAppsService } from "./service";
export function registerCloudApps(service: CloudAppsService, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "App synchronization access denied").roles("main");
  ipc.handle(CLOUD_APPS_CHANNEL.catalog, (...args) => service.catalog(z.tuple([cloudAppsAccountSchema]).parse(args)[0].expectedUserId));
  ipc.handle(CLOUD_APPS_CHANNEL.origin, (...args) => { const input = z.tuple([cloudAppRequestSchema]).parse(args)[0]; return service.origin(input.expectedUserId, input.appId); });
  ipc.handle(CLOUD_APPS_CHANNEL.review, (...args) => { const input = z.tuple([cloudAppRequestSchema]).parse(args)[0]; return service.review(input.expectedUserId, input.appId); });
  ipc.handle(CLOUD_APPS_CHANNEL.confirm, (...args) => service.confirm(z.tuple([cloudAppConfirmSchema]).parse(args)[0]));
  ipc.handle(CLOUD_APPS_CHANNEL.removeLocal, (...args) => service.removeLocal(z.tuple([cloudAppRemoveLocalSchema]).parse(args)[0]));
  ipc.handle(CLOUD_APPS_CHANNEL.reviewDeletion, (...args) => { const input = z.tuple([cloudAppRequestSchema]).parse(args)[0]; return service.reviewDeletion(input.expectedUserId, input.appId); });
  ipc.handle(CLOUD_APPS_CHANNEL.confirmDeletion, (...args) => service.confirmDeletion(z.tuple([cloudAppDeleteConfirmSchema]).parse(args)[0]));
  ipc.handle(CLOUD_APPS_CHANNEL.openRetained, (...args) => { const input = z.tuple([cloudAppRequestSchema]).parse(args)[0]; return service.openRetained(input.expectedUserId, input.appId); });
  for (const action of ["discard", "retry", "cancel", "retryRemoval", "retryDeletion", "discardDeletion", "dismissDeletion"] as const) ipc.handle(CLOUD_APPS_CHANNEL[action], (...args) => {
    const input = z.tuple([cloudAppTokenSchema]).parse(args)[0]; return service[action](input.expectedUserId, input.requestId);
  });
  const unsubscribe = service.subscribe(() => { if (!window.isDestroyed()) window.webContents.send(CLOUD_APPS_CHANNEL.changed); });
  window.webContents.once("destroyed", unsubscribe);
}
