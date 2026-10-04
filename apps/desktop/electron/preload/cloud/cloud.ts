/**
 * [INPUT]: Depends on Electron's isolated bridge and closed cloud account IPC contracts.
 * [OUTPUT]: Installs credential-free progress, the account computer subscription and discard/expiry results alongside fixed account/content/remote bridges.
 * [POS]: apps/desktop/electron/preload/cloud; Cloud preload surface; callers cannot choose endpoints, IPC channels or browser URLs. It carries no schemas (OPT-34): main parses every request and sends every reply and event in its contract's exact shape, dropping pushed values that do not match.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { CLOUD_CHANNEL } from "../../../shared/ipc-channels/cloud";
import { type CloudAccountState, type CloudBridgeApi, type CloudComputersResult } from "../../../shared/ipc/settings/cloud-ipc";
import { installCloudChatBridge } from "./cloud-chat";
import { installCloudRemoteBridge } from "../remote";
import { installCloudBaseBridge } from "./cloud-base";
import { installCloudConversionBridge } from "../conversion";
import { installCloudAppsBridge } from "../apps";
export function installCloudBridge() {
  installCloudChatBridge();
  installCloudRemoteBridge();
  installCloudBaseBridge();
  installCloudConversionBridge();
  installCloudAppsBridge();
  const account = async (action: "getAccountState" | "startLogin" | "cancelLogin" | "abandonLogin" | "reopenLogin" | "signOut" | "retryLoginSave" | "retryCredentialStorage" | "retryConnection") =>
    ipcRenderer.invoke(CLOUD_CHANNEL[action]);
  contextBridge.exposeInMainWorld("cloud", {
    getAccountState: () => account("getAccountState"), startLogin: () => account("startLogin"), cancelLogin: () => account("cancelLogin"),
    abandonLogin: () => account("abandonLogin"),
    reopenLogin: () => account("reopenLogin"), signOut: () => account("signOut"),
    retryLoginSave: () => account("retryLoginSave"), retryCredentialStorage: () => account("retryCredentialStorage"),
    retryConnection: () => account("retryConnection"),
    settingsOpened: () => ipcRenderer.invoke(CLOUD_CHANNEL.settingsOpened).then(() => undefined),
    networkChanged: (online: boolean) => ipcRenderer.invoke(CLOUD_CHANNEL.networkChanged, online).then(() => undefined),
    inspectSavedLoginDiscard: async () => ipcRenderer.invoke(CLOUD_CHANNEL.inspectSavedLoginDiscard),
    discardSavedLogin: input => ipcRenderer.invoke(CLOUD_CHANNEL.discardSavedLogin, input),
    openCloudAccount: () => ipcRenderer.invoke(CLOUD_CHANNEL.openCloudAccount),
    openAccountDeletion: () => ipcRenderer.invoke(CLOUD_CHANNEL.openAccountDeletion),
    setupEncryption: input => ipcRenderer.invoke(CLOUD_CHANNEL.setupEncryption, input),
    unlockEncryption: input => ipcRenderer.invoke(CLOUD_CHANNEL.unlockEncryption, input),
    retryEncryption: async () => ipcRenderer.invoke(CLOUD_CHANNEL.retryEncryption),
    cancelEncryption: () => ipcRenderer.invoke(CLOUD_CHANNEL.cancelEncryption),
    inspectSync: async () => ipcRenderer.invoke(CLOUD_CHANNEL.inspectSync),
    cancelSyncReview: () => ipcRenderer.invoke(CLOUD_CHANNEL.cancelSyncReview),
    approveSync: input => ipcRenderer.invoke(CLOUD_CHANNEL.approveSync, input),
    retrySync: () => ipcRenderer.invoke(CLOUD_CHANNEL.retrySync),
    inspectCleanup: async () => ipcRenderer.invoke(CLOUD_CHANNEL.inspectCleanup),
    disableSync: input => ipcRenderer.invoke(CLOUD_CHANNEL.disableSync, input),
    inspectAccountSwitch: async () => ipcRenderer.invoke(CLOUD_CHANNEL.inspectAccountSwitch),
    switchAccount: input => ipcRenderer.invoke(CLOUD_CHANNEL.switchAccount, input),
    listDevices: input => ipcRenderer.invoke(CLOUD_CHANNEL.listDevices, input),
    renameDevice: input => ipcRenderer.invoke(CLOUD_CHANNEL.renameDevice, input),
    revokeDevice: input => ipcRenderer.invoke(CLOUD_CHANNEL.revokeDevice, input),
    getComputers: async () => ipcRenderer.invoke(CLOUD_CHANNEL.getComputers),
    renameComputer: input => ipcRenderer.invoke(CLOUD_CHANNEL.renameComputer, input),
    onComputersChanged: (listener: (value: CloudComputersResult) => void) => {
      const receive = (_event: IpcRendererEvent, value: CloudComputersResult) => listener(value);
      ipcRenderer.on(CLOUD_CHANNEL.computersChanged, receive); return () => { ipcRenderer.removeListener(CLOUD_CHANNEL.computersChanged, receive); };
    },
    onAccountChanged: listener => {
      const receive = (_event: IpcRendererEvent, value: CloudAccountState) => listener(value);
      ipcRenderer.on(CLOUD_CHANNEL.accountChanged, receive); return () => { ipcRenderer.removeListener(CLOUD_CHANNEL.accountChanged, receive); };
    },
  } satisfies CloudBridgeApi);
}
