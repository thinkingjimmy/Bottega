/**
 * [INPUT]: Depends on Electron's app.isPackaged flag, process.resourcesPath, the bundle/source __dirname, and Node path
 * [OUTPUT]: Provides systemSkillsPath, resolving the built-in skills root consistently across dev and packaged binaries
 * [POS]: Electron main's single resource-location helper; backend descriptors read this path instead of guessing resource locations
 */

import { app } from "electron";
import { join } from "node:path";

export function systemSkillsPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(__dirname, "..", "..", "resources", "skills");
}
