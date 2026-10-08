/**
 * [INPUT]: Depends on the trusted main-frame registrar, closed IPC schemas and account service.
 * [OUTPUT]: Registers offline-safe native diagnostic export and trusted account actions, closed review results, the pushed account computer list, front-window handshake re-checks, forwarded page online/offline changes (T20-2) and window-exit cancellation of unfinished password work.
 * [POS]: Electron IPC boundary; child frames and auxiliary windows receive no account authority.
 */
import { exportRecoveryDiagnostics } from "./diagnostics/export";
import type { BrowserWindow } from "electron";
import { z } from "zod";
import { CLOUD_CHANNEL, cloudAccountStateSchema, cloudComputerRenameResultSchema, cloudComputerRenameSchema, cloudComputersResultSchema, cloudDevicesPageSchema, cloudDevicesQuerySchema, cloudRenameSchema, cloudRevokeSchema, savedLoginDiscardResultSchema, savedLoginDiscardReviewSchema } from "../../../../shared/ipc/settings/cloud-ipc";
import { syncEncryptionStateSchema, syncSetupInputSchema, syncUnlockInputSchema } from "../../../../shared/cloud/encryption";
import { syncApprovalSchema, syncCleanupReviewSchema, syncReviewSchema } from "../../../../shared/cloud/sync";
import { rendererIpc } from "../../registration/ipc-registrar";
import { replying, sendParsed } from "../replies";
import { SavedLoginReviewExpired, type CloudAccountService } from "./service";
export function registerCloudAccount(service: CloudAccountService, window: BrowserWindow, rendererUrl: string) {
  const ipc = rendererIpc(rendererUrl, "Cloud account access denied").roles("main");
  const noArgs = z.tuple([]);
  ipc.handle(CLOUD_CHANNEL.exportSyncDiagnostics, (...args) => { noArgs.parse(args); return exportRecoveryDiagnostics(window, service); });
  /* Each reply leaves main in its contract's exact shape (OPT-34); actions without an entry reply with nothing the renderer reads. */
  const replies: Partial<Record<string, z.ZodType>> = {
    getAccountState: cloudAccountStateSchema, startLogin: cloudAccountStateSchema, cancelLogin: cloudAccountStateSchema, abandonLogin: cloudAccountStateSchema,
    reopenLogin: cloudAccountStateSchema, signOut: cloudAccountStateSchema, retryLoginSave: cloudAccountStateSchema, retryCredentialStorage: cloudAccountStateSchema,
    retryConnection: cloudAccountStateSchema, inspectSync: syncReviewSchema, inspectCleanup: syncCleanupReviewSchema.nullable(),
    inspectAccountSwitch: syncCleanupReviewSchema.nullable(), inspectSavedLoginDiscard: savedLoginDiscardReviewSchema, retryEncryption: syncEncryptionStateSchema,
  };
  for (const action of ["getAccountState", "startLogin", "cancelLogin", "abandonLogin", "reopenLogin", "signOut", "inspectSync", "cancelSyncReview", "retrySync", "inspectCleanup", "inspectAccountSwitch", "openAccountDeletion", "retryLoginSave", "retryCredentialStorage", "retryConnection", "inspectSavedLoginDiscard", "openCloudAccount", "retryEncryption", "cancelEncryption"] as const) {
    const handler = (...args: unknown[]) => {
      noArgs.parse(args);
      return action === "getAccountState" ? service.snapshot() : service[action]();
    };
    const reply = replies[action];
    ipc.handle(CLOUD_CHANNEL[action], reply ? replying(reply, handler) : handler);
  }
  for (const action of ["approveSync", "disableSync", "switchAccount"] as const) ipc.handle(CLOUD_CHANNEL[action], (...args) => {
    const [input] = z.tuple([syncApprovalSchema]).parse(args); return service[action](input.reviewId);
  });
  ipc.handle(CLOUD_CHANNEL.settingsOpened, (...args) => { noArgs.parse(args); service.settingsOpened(); });
  ipc.handle(CLOUD_CHANNEL.networkChanged, (...args) => { const [online] = z.tuple([z.boolean()]).parse(args); service.networkChanged(online); });
  ipc.handle(CLOUD_CHANNEL.setupEncryption, (...args) => { const [input] = z.tuple([syncSetupInputSchema]).parse(args); return service.setupEncryption(input); });
  ipc.handle(CLOUD_CHANNEL.unlockEncryption, (...args) => { const [input] = z.tuple([syncUnlockInputSchema]).parse(args); return service.unlockEncryption(input); });
  ipc.handle(CLOUD_CHANNEL.discardSavedLogin, replying(savedLoginDiscardResultSchema, async (...args) => {
    const [input] = z.tuple([savedLoginDiscardReviewSchema]).parse(args);
    try { await service.discardSavedLogin(input.reviewId); return { status: "discarded" }; }
    catch (error) { if (error instanceof SavedLoginReviewExpired) return { status: "review-expired" }; throw error; }
  }));
  ipc.handle(CLOUD_CHANNEL.listDevices, replying(cloudDevicesPageSchema, (...args) => {
    const [input] = z.tuple([cloudDevicesQuerySchema]).parse(args);
    return service.listDevices(input.cursor, input.state);
  }));
  ipc.handle(CLOUD_CHANNEL.renameDevice, (...args) => {
    const [input] = z.tuple([cloudRenameSchema]).parse(args); return service.renameDevice(input.deviceId, input.name);
  });
  ipc.handle(CLOUD_CHANNEL.revokeDevice, (...args) => {
    const [input] = z.tuple([cloudRevokeSchema]).parse(args); return service.revokeDevice(input.deviceId);
  });
  /* The computer list is main's subscription, not the renderer's: one per account generation, pushed like the
     account state itself, so a renderer that mounts late reads the current answer instead of opening a second one. */
  ipc.handle(CLOUD_CHANNEL.getComputers, replying(cloudComputersResultSchema, (...args) => { noArgs.parse(args); return service.computers(); }));
  ipc.handle(CLOUD_CHANNEL.renameComputer, replying(cloudComputerRenameResultSchema, (...args) => {
    const [input] = z.tuple([cloudComputerRenameSchema]).parse(args); return service.renameComputer(input.name);
  }));
  /* A pushed value that does not match its contract is dropped, exactly as preload used to drop it. */
  const stopComputers = service.subscribeComputers(value => sendParsed(window, CLOUD_CHANNEL.computersChanged, cloudComputersResultSchema, value));
  const unsubscribe = service.subscribe(state => sendParsed(window, CLOUD_CHANNEL.accountChanged, cloudAccountStateSchema, state));
  // A window returning to the front is the user looking at the banner; only a failing handshake is re-checked.
  const focused = () => service.recheckConnection();
  window.on("focus", focused);
  window.webContents.once("destroyed", () => {
    unsubscribe(); stopComputers(); window.off("focus", focused);
    // Closing a window may bypass React cleanup while the app remains in the background.
    void service.cancelEncryption().catch(() => {});
  });
}
