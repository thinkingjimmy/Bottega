/**
 * [INPUT]: Depends on Electron app/dialog, trusted renderer IPC with its window/incarnation context, i18n and the Electron-free maintenance actions.
 * [OUTPUT]: Provides createProfileMaintenance: the registrar for "move the Bottega folder" and "erase all data"; it binds the actions to renderer IPC and the folder picker, and restarts the app once a request is recorded (development builds served by the renderer dev server only quit).
 * [POS]: Settings' only path to actions that must run before any store opens; the running app validates and records, the next launch performs.
 */
import { app, dialog, type BrowserWindow } from "electron";
import { devRendererUrl } from "../window/security/frame-guard";
import { dirname } from "node:path";
import { SETTINGS_CHANNEL, type LibraryMovePlan } from "../../../shared/ipc/settings/settings-ipc";
import { translate } from "../../../shared/i18n/native";
import { rendererIpc } from "../registration/ipc-registrar";
import { createMaintenanceActions, type ProfileMaintenancePorts } from "./actions";

export type { ProfileMaintenancePorts } from "./actions";

export function createProfileMaintenance(ports: ProfileMaintenancePorts) {
  const actions = createMaintenanceActions({ ...ports, restart: () => {
    /* Under `pnpm dev` the renderer server exits with this process, so a relaunch would open a window
       onto a dead URL. Quitting is enough there: the request runs on the next `pnpm dev`. */
    if (!devRendererUrl(app.isPackaged)) app.relaunch();
    else console.info("[profile-maintenance] quitting without relaunch in development; run `pnpm dev` again to continue");
    app.quit();
  } });

  return {
    register(window: BrowserWindow, rendererUrl: string) {
      rendererIpc(rendererUrl, "拒绝非驻留窗口的设置请求")
        .handleWithContext(SETTINGS_CHANNEL.planLibraryMove, async (context): Promise<LibraryMovePlan | null> => {
          const picked = await dialog.showOpenDialog(window, {
            title: translate(ports.locale(), "settings.native.libraryMovePick"),
            buttonLabel: translate(ports.locale(), "settings.native.libraryMovePickButton"),
            defaultPath: dirname(actions.root()), properties: ["openDirectory", "createDirectory"],
          });
          const parent = picked.filePaths[0];
          if (picked.canceled || !parent) return null;
          return actions.planMove(context, parent);
        })
        .handleWithContext(SETTINGS_CHANNEL.commitLibraryMove, (context, planId) => actions.commitMove(context, planId))
        .handleWithContext(SETTINGS_CHANNEL.inspectEraseFolder, (context) => actions.inspectErase(context))
        .handleWithContext(SETTINGS_CHANNEL.eraseAllData, (context, raw) => actions.eraseAll(context, raw));
    },
  };
}
