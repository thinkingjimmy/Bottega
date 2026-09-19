/**
 * [INPUT]: Depends on the trusted main-frame registrar, closed IPC schemas and account service.
 * [OUTPUT]: Registers trusted account actions, closed review results, front-window handshake re-checks and window-exit cancellation of unfinished password work.
 * [POS]: Electron IPC boundary; child frames and auxiliary windows receive no account authority.
 */
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { CLOUD_CHANNEL, cloudDevicesQuerySchema, cloudRenameSchema, cloudRevokeSchema, savedLoginDiscardReviewSchema } from "../../../../shared/cloud-ipc";
import { syncSetupInputSchema, syncUnlockInputSchema } from "../../../../shared/cloud/encryption";
import { syncApprovalSchema, syncPauseSchema } from "../../../../shared/cloud/sync";
import { rendererIpc } from "../../ipc-registrar";
import { SavedLoginReviewExpired, type CloudAccountService } from "./service";
export function registerCloudAccount(service: CloudAccountService, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "Cloud account access denied").roles("main");
  const noArgs = z.tuple([]);
  for (const action of ["getAccountState", "startLogin", "cancelLogin", "abandonLogin", "reopenLogin", "signOut", "inspectSync", "cancelSyncReview", "retrySync", "inspectCleanup", "inspectAccountSwitch", "openAccountDeletion", "retryLoginSave", "retryCredentialStorage", "retryConnection", "inspectSavedLoginDiscard", "openCloudAccount", "retryEncryption", "cancelEncryption"] as const) {
    ipc.handle(CLOUD_CHANNEL[action], (...args) => {
      noArgs.parse(args);
      return action === "getAccountState" ? service.snapshot() : service[action]();
    });
  }
  for (const action of ["approveSync", "disableSync", "switchAccount"] as const) ipc.handle(CLOUD_CHANNEL[action], (...args) => {
    const [input] = z.tuple([syncApprovalSchema]).parse(args); return service[action](input.reviewId);
  });
  ipc.handle(CLOUD_CHANNEL.setupEncryption, (...args) => { const [input] = z.tuple([syncSetupInputSchema]).parse(args); return service.setupEncryption(input); });
  ipc.handle(CLOUD_CHANNEL.unlockEncryption, (...args) => { const [input] = z.tuple([syncUnlockInputSchema]).parse(args); return service.unlockEncryption(input); });
  ipc.handle(CLOUD_CHANNEL.discardSavedLogin, async (...args) => {
    const [input] = z.tuple([savedLoginDiscardReviewSchema]).parse(args);
    try { await service.discardSavedLogin(input.reviewId); return { status: "discarded" }; }
    catch (error) { if (error instanceof SavedLoginReviewExpired) return { status: "review-expired" }; throw error; }
  });
  ipc.handle(CLOUD_CHANNEL.pauseSync, (...args) => { const [input] = z.tuple([syncPauseSchema]).parse(args); return service.pauseSync(input.paused); });
  ipc.handle(CLOUD_CHANNEL.listDevices, (...args) => {
    const [input] = z.tuple([cloudDevicesQuerySchema]).parse(args);
    return service.listDevices(input.cursor, input.state);
  });
  ipc.handle(CLOUD_CHANNEL.renameDevice, (...args) => {
    const [input] = z.tuple([cloudRenameSchema]).parse(args); return service.renameDevice(input.deviceId, input.name);
  });
  ipc.handle(CLOUD_CHANNEL.revokeDevice, (...args) => {
    const [input] = z.tuple([cloudRevokeSchema]).parse(args); return service.revokeDevice(input.deviceId);
  });
  const unsubscribe = service.subscribe(state => { if (!window.isDestroyed()) window.webContents.send(CLOUD_CHANNEL.accountChanged, state); });
  // A window returning to the front is the user looking at the banner; only a failing handshake is re-checked.
  const focused = () => service.recheckConnection();
  window.on("focus", focused);
  window.webContents.once("destroyed", () => {
    unsubscribe(); window.off("focus", focused);
    // Closing a window may bypass React cleanup while the app remains in the background.
    void service.cancelEncryption().catch(() => {});
  });
}
