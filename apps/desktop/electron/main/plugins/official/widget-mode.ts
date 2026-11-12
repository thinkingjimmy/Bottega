/**
 * [INPUT]: Electron package identity and the local development catalog path.
 * [OUTPUT]: Allows local archive distribution only for unpackaged Apple silicon macOS builds.
 * [POS]: Main-owned switch between the current production bundle and local distribution acceptance.
 */
import { app } from "electron";
import { isAbsolute } from "node:path";

export function developmentWidgetCatalogDirectory() {
  const directory = process.env.BOTTEGA_WIDGET_DEV_CATALOG;
  return !app.isPackaged && process.platform === "darwin" && process.arch === "arm64" &&
    directory && isAbsolute(directory) ? directory : null;
}
