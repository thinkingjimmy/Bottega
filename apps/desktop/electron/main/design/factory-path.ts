/**
 * [INPUT]: Depends on Electron packaged mode, process.resourcesPath, source __dirname, and Node path
 * [OUTPUT]: Provides designFactoryPayloadPath for the same immutable factory bytes in development and packaged applications
 * [POS]: Design resource locator; provisioning consumes the returned root without guessing build layout
 */

import { app } from "electron";
import { join } from "node:path";

export function designFactoryPayloadPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "factory-apps", "design-canvas")
    : join(__dirname, "..", "..", "resources", "apps", "Bottega-app-design-canvas");
}
