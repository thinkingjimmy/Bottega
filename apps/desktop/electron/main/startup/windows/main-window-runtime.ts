/**
 * [INPUT]: Depends on the main-window combination parameters, Electron's Menu and the build-time developer-menu switch.
 * [OUTPUT]: Provides the main window launcher (which installs the application menu once and registers durable composer drafts) and applicationMenuTemplate.
 * [POS]: Startup composition for the main window launcher; the Browser/App/Design E2E drivers that used to live here are private (electron/main/e2e/app-drivers.ts, F-01).
 *        A production build replaces Electron's default menu with one that has no Reload, Force Reload or DevTools (S3 ruling):
 *        ⌘R would throw away the renderer's drafts and queue. Developer builds keep the default.
 */

import { Menu, type MenuItemConstructorOptions } from "electron";
import { createMainWindow } from "../../window/main-window";
import { composerDraftsRegistrar } from "../../composer/drafts/runtime";

/* Set from the checked-in build flavour (electron.vite.config): true for stable and staging, false for production. */
declare const __BOTTEGA_DEVELOPER_MENU__: boolean;

export function applicationMenuTemplate(platform: NodeJS.Platform, developer: boolean): MenuItemConstructorOptions[] | null {
  if (developer) return null;
  const view: MenuItemConstructorOptions = { label: "View", submenu: [
    { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" },
  ] };
  return platform === "darwin"
    ? [{ role: "appMenu" }, { role: "editMenu" }, view, { role: "windowMenu" }]
    : [{ role: "fileMenu" }, { role: "editMenu" }, view, { role: "windowMenu" }];
}

let menuInstalled = false;
export function createMainWindowLauncher(
  options: Parameters<typeof createMainWindow>[0]
) {
  if (!menuInstalled) {
    menuInstalled = true;
    const template = applicationMenuTemplate(process.platform, typeof __BOTTEGA_DEVELOPER_MENU__ === "undefined" || __BOTTEGA_DEVELOPER_MENU__);
    if (template) Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }
  // F-12: durable composer drafts, one process-wide store behind every product window.
  const drafts = composerDraftsRegistrar({ chats: options.chats, files: options.files, resolveWorkspace: options.resolveWorkspace,
    userId: () => options.cloud?.accountIdentity?.().profile?.userId ?? null });
  return () => createMainWindow({ ...options, registrars: [...(options.registrars ?? []), drafts] });
}
