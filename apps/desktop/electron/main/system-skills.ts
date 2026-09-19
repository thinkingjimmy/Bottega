/**
 * [INPUT]: Depends on Electron's app.isPackaged flag, process.resourcesPath, the bundle/source __dirname, and Node path
 * [OUTPUT]: Provides desktopDevelopmentRoot and systemSkillsPath for consistent resources across development entries and packaged binaries.
 * [POS]: Electron main's single resource-location helper; backend descriptors read this path instead of guessing resource locations
 */

import { app } from "electron";
import { join } from "node:path";

export function desktopDevelopmentRoot() {
  return join(__dirname, "..", "..");
}

export function systemSkillsPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(desktopDevelopmentRoot(), "resources", "skills");
}
