/**
 * [INPUT]: Electron package identity, the local development catalog path and accepted revision receipts.
 * [OUTPUT]: Unpackaged-only Widget distribution admission and retirement of the legacy Weather runtime in that mode.
 * [POS]: Main-owned switch between the current production bundle and local distribution acceptance.
 */
import { app } from "electron";
import { isAbsolute } from "node:path";

export function developmentWidgetCatalogDirectory() {
  const directory = process.env.BOTTEGA_WIDGET_DEV_CATALOG;
  return !app.isPackaged && process.platform === "darwin" && process.arch === "arm64" &&
    directory && isAbsolute(directory) ? directory : null;
}
