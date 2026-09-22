/**
 * [INPUT]: Depends on Electron's isolated bridge and closed cloud account IPC contracts.
 * [OUTPUT]: Installs validated credential-free progress, the account computer subscription and discard/expiry results alongside fixed account/content/remote bridges.
 * [POS]: Cloud preload surface; callers cannot choose endpoints, IPC channels or browser URLs.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CLOUD_CHANNEL, cloudAccountStateSchema, cloudComputerRenameResultSchema, cloudComputerRenameSchema, cloudComputersResultSchema, cloudDevicesPageSchema, cloudDevicesQuerySchema, cloudRenameSchema, cloudRevokeSchema, savedLoginDiscardReviewSchema, savedLoginDiscardResultSchema, type CloudBridgeApi, type CloudComputersResult } from "../../shared/cloud-ipc";
import { syncSetupInputSchema, syncUnlockInputSchema, syncEncryptionStateSchema } from "../../shared/cloud/encryption";
import { syncApprovalSchema, syncCleanupReviewSchema, syncReviewSchema } from "../../shared/cloud/sync";
import { installCloudChatBridge } from "./cloud-chat";
import { installCloudRemoteBridge } from "./remote";
import { installCloudBaseBridge } from "./cloud-base";
import { installCloudConversionBridge } from "./conversion";
import { installCloudAppsBridge } from "./apps";
export function installCloudBridge() {
  installCloudChatBridge();
  installCloudRemoteBridge();
  installCloudBaseBridge();
  installCloudConversionBridge();
  installCloudAppsBridge();
  const account = async (action: "getAccountState" | "startLogin" | "cancelLogin" | "abandonLogin" | "reopenLogin" | "signOut" | "retryLoginSave" | "retryCredentialStorage" | "retryConnection") =>
    cloudAccountStateSchema.parse(await ipcRenderer.invoke(CLOUD_CHANNEL[action]));
  contextBridge.exposeInMainWorld("cloud", {
    getAccountState: () => account("getAccountState"), startLogin: () => account("startLogin"), cancelLogin: () => account("cancelLogin"),
    abandonLogin: () => account("abandonLogin"),
    reopenLogin: () => account("reopenLogin"), signOut: () => account("signOut"),
    retryLoginSave: () => account("retryLoginSave"), retryCredentialStorage: () => account("retryCredentialStorage"),
    retryConnection: () => account("retryConnection"),
    inspectSavedLoginDiscard: async () => savedLoginDiscardReviewSchema.parse(await ipcRenderer.invoke(CLOUD_CHANNEL.inspectSavedLoginDiscard)),
    discardSavedLogin: input => ipcRenderer.invoke(CLOUD_CHANNEL.discardSavedLogin, savedLoginDiscardReviewSchema.parse(input))
      .then(value => savedLoginDiscardResultSchema.parse(value)),
    openCloudAccount: () => ipcRenderer.invoke(CLOUD_CHANNEL.openCloudAccount),
    openAccountDeletion: () => ipcRenderer.invoke(CLOUD_CHANNEL.openAccountDeletion),
    setupEncryption: input => ipcRenderer.invoke(CLOUD_CHANNEL.setupEncryption, syncSetupInputSchema.parse(input)),
    unlockEncryption: input => ipcRenderer.invoke(CLOUD_CHANNEL.unlockEncryption, syncUnlockInputSchema.parse(input)),
    retryEncryption: async () => syncEncryptionStateSchema.parse(await ipcRenderer.invoke(CLOUD_CHANNEL.retryEncryption)),
    cancelEncryption: () => ipcRenderer.invoke(CLOUD_CHANNEL.cancelEncryption),
    inspectSync: async () => syncReviewSchema.parse(await ipcRenderer.invoke(CLOUD_CHANNEL.inspectSync)),
    cancelSyncReview: () => ipcRenderer.invoke(CLOUD_CHANNEL.cancelSyncReview),
    approveSync: input => ipcRenderer.invoke(CLOUD_CHANNEL.approveSync, syncApprovalSchema.parse(input)),
    retrySync: () => ipcRenderer.invoke(CLOUD_CHANNEL.retrySync),
    inspectCleanup: async () => syncCleanupReviewSchema.nullable().parse(await ipcRenderer.invoke(CLOUD_CHANNEL.inspectCleanup)),
    disableSync: input => ipcRenderer.invoke(CLOUD_CHANNEL.disableSync, syncApprovalSchema.parse(input)),
    inspectAccountSwitch: async () => syncCleanupReviewSchema.nullable().parse(await ipcRenderer.invoke(CLOUD_CHANNEL.inspectAccountSwitch)),
    switchAccount: input => ipcRenderer.invoke(CLOUD_CHANNEL.switchAccount, syncApprovalSchema.parse(input)),
    listDevices: async input => cloudDevicesPageSchema.parse(await ipcRenderer.invoke(CLOUD_CHANNEL.listDevices, cloudDevicesQuerySchema.parse(input))),
    renameDevice: input => ipcRenderer.invoke(CLOUD_CHANNEL.renameDevice, cloudRenameSchema.parse(input)),
    revokeDevice: input => ipcRenderer.invoke(CLOUD_CHANNEL.revokeDevice, cloudRevokeSchema.parse(input)),
    getComputers: async () => cloudComputersResultSchema.parse(await ipcRenderer.invoke(CLOUD_CHANNEL.getComputers)),
    renameComputer: input => ipcRenderer.invoke(CLOUD_CHANNEL.renameComputer, cloudComputerRenameSchema.parse(input))
      .then(value => cloudComputerRenameResultSchema.parse(value)),
    onComputersChanged: (listener: (value: CloudComputersResult) => void) => {
      const receive = (_event: IpcRendererEvent, value: unknown) => {
        const parsed = cloudComputersResultSchema.safeParse(value); if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(CLOUD_CHANNEL.computersChanged, receive); return () => { ipcRenderer.removeListener(CLOUD_CHANNEL.computersChanged, receive); };
    },
    onAccountChanged: listener => {
      const receive = (_event: IpcRendererEvent, value: unknown) => {
        const parsed = cloudAccountStateSchema.safeParse(value); if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(CLOUD_CHANNEL.accountChanged, receive); return () => { ipcRenderer.removeListener(CLOUD_CHANNEL.accountChanged, receive); };
    },
  } satisfies CloudBridgeApi);
}
