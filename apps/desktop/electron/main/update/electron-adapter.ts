/**
 * [INPUT]: Depends on electron-updater autoUpdater and its six lifecycle events
 * [OUTPUT]: Provides createElectronUpdateAdapter with manual download and coordinated-install defaults
 * [POS]: The only module allowed to import electron-updater; UpdateService consumes the narrow adapter instead
 */

import { autoUpdater } from "electron-updater";
import type {
  UpdateAdapter,
  UpdateAdapterEvents,
} from "./adapter";

export function createElectronUpdateAdapter(): UpdateAdapter {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;
  autoUpdater.allowPrerelease = false;
  autoUpdater.disableWebInstaller = true;
  return {
    on(event, listener) {
      autoUpdater.on(event, listener as never);
    },
    off(event, listener) {
      autoUpdater.off(event, listener as never);
    },
    async checkForUpdates() {
      await autoUpdater.checkForUpdates();
    },
    async downloadUpdate() {
      await autoUpdater.downloadUpdate();
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall(false, true);
    },
  } satisfies UpdateAdapter;
}

export type { UpdateAdapterEvents };
