/**
 * [INPUT]: Depends on Electron BrowserWindow/nativeTheme with sandboxed all-frame preload execution, Settings/Apps navigation security, shared startup arguments, renderer identity, and WindowRegistry
 * [OUTPUT]: Provides createAppWindow, a hidden same-bundle App-detail window registered before renderer load; its route loads only through the returned load(),
 *           which the controller calls once the move has made the window resident, and it is shown only after migration hydrate
 * [POS]: Window surfaces App-window factory; it creates presentation only and never re-registers process-global domain IPC
 */

import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, nativeTheme } from "electron";
import { devRendererUrl } from "../security/frame-guard";
import {
  INITIAL_DARK_ARGUMENT,
  INITIAL_LANGUAGE_ARGUMENT,
} from "../../../../shared/ipc/settings/settings-ipc";
import { resolveAppLocale } from "@ai-chat/ui/lib/locale";
import {
  WINDOW_APP_ID_ARGUMENT,
  WINDOW_ID_ARGUMENT,
  WINDOW_ROLE_ARGUMENT,
} from "../../../../shared/ipc/settings/window-surfaces-ipc";
import type { AppsService } from "../../apps/apps-service";
import type { SettingsStore } from "../../settings/settings-store";
import { resolveAppIconPath } from "../app-icon";
import { bindWindowTheme, windowBackgroundColor } from "../native-theme";
import { bindRendererIdentity } from "../security/renderer-identity";
import { lockNavigation } from "../security/security";
import {
  type ProductWindowRecord,
  type WindowRegistry,
  windowRegistry,
} from "./window-registry";

export type CreateAppWindowOptions = Readonly<{
  mainDirectory: string;
  apps: AppsService;
  settings: SettingsStore;
  appId: string;
  windowId: string;
  route: string;
  registry?: WindowRegistry;
}>;

export async function createAppWindow({
  mainDirectory,
  apps,
  settings,
  appId,
  windowId,
  route,
  registry = windowRegistry,
}: CreateAppWindowOptions): Promise<Readonly<{ record: ProductWindowRecord; load(): Promise<void> }>> {
  const preload = join(mainDirectory, "../preload/index.js");
  const productionEntry = join(mainDirectory, "../renderer/index.html");
  const rendererUrl =
    devRendererUrl(app.isPackaged) ?? pathToFileURL(productionEntry).href;
  const locale = () =>
    resolveAppLocale(
      settings.get().language,
      app.getPreferredSystemLanguages()
    );
  const window = new BrowserWindow({
    icon: resolveAppIconPath(),
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: windowBackgroundColor(),
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 16 },
        }
      : {}),
    webPreferences: {
      preload,
      contextIsolation: true,
      sandbox: true,
      nodeIntegrationInSubFrames: true,
      additionalArguments: [
        `${INITIAL_DARK_ARGUMENT}${nativeTheme.shouldUseDarkColors}`,
        `${INITIAL_LANGUAGE_ARGUMENT}${locale()}`,
        `${WINDOW_ROLE_ARGUMENT}app-window`,
        `${WINDOW_ID_ARGUMENT}${windowId}`,
        `${WINDOW_APP_ID_ARGUMENT}${appId}`,
      ],
    },
  });
  window.setMaxListeners(20);
  bindRendererIdentity(window.webContents);
  const record = registry.register({
    windowId,
    role: "app-window",
    appId,
    rendererUrl,
    window,
  });
  bindWindowTheme(window);
  lockNavigation(window, rendererUrl, apps);

  /* Loading waits for the move's claim (the controller calls it from hydrate): a renderer loaded earlier would query its App Studio
     while the window is still nonresident, be refused, and leave the page empty. */
  const load = async () => {
    const loaded = new Promise<void>((resolve, reject) => {
      window.webContents.once("did-finish-load", () => resolve());
      window.webContents.once(
        "did-fail-load",
        (_event, code, description) =>
          reject(new Error(`App window load failed (${code}): ${description}`))
      );
    });
    try {
      const devUrl = devRendererUrl(app.isPackaged);
      if (devUrl) {
        const entry = new URL(devUrl);
        entry.hash = route;
        void window.loadURL(entry.href);
      } else {
        void window.loadFile(productionEntry, { hash: route });
      }
      await loaded;
    } catch (cause) {
      if (!window.isDestroyed()) window.destroy();
      throw cause;
    }
  };
  return { record, load };
}
