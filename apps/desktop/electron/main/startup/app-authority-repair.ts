/**
 * [INPUT]: Depends on Electron's native dialog/application lifecycle, AppStore explicit repair, and the shared locale catalog
 * [OUTPUT]: Provides the restricted pre-Project App authority repair prompt with receipt-gated repair-and-restart or safe quit outcomes
 * [POS]: Startup fail-closed escape hatch; no Project, renderer, gateway, or App recovery service is opened while authority is unknown
 */

import { app, dialog, type MessageBoxOptions } from "electron";
import type { AppLocale } from "../../../shared/i18n/locale";
import { translate } from "../../../shared/i18n/runtime";
import type { AppStore } from "../apps/app-store";

type RepairPromptPorts = Readonly<{
  show(options: MessageBoxOptions): Promise<{ response: number }>;
  restart(): void;
  quit(): void;
}>;

const nativePorts: RepairPromptPorts = {
  show: (options) => dialog.showMessageBox(options),
  restart: () => {
    app.relaunch();
    app.exit(0);
  },
  quit: () => app.quit(),
};

export async function presentAppAuthorityRepair(
  store: AppStore,
  locale: AppLocale,
  ports: RepairPromptPorts = nativePorts
) {
  const result = await ports.show({
    type: "warning",
    title: translate(locale, "settings.native.appAuthorityRepairTitle"),
    message: translate(locale, "settings.native.appAuthorityRepairMessage"),
    buttons: [
      translate(locale, "settings.native.appAuthorityRepairAction"),
      translate(locale, "settings.native.appAuthorityRepairQuit"),
    ],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
  });
  if (result.response !== 0) {
    ports.quit();
    return "quit" as const;
  }
  await store.repairAuthority();
  ports.restart();
  return "restarted" as const;
}
