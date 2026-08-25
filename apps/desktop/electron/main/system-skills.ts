/**
 * [INPUT]: Depends on Electron app Packing mode, process.resourcesPath, bundle/source __dirname and Node path
 * [OUTPUT]: Provides dev/packaged Binary consistent product built-in skills Root path
 * [POS]: The main system resource location unit; Backend descriptor not guessing the resource path
 */

import { app } from "electron";
import { join } from "node:path";

export function systemSkillsPath() {
  return app.isPackaged
    ? join(process.resourcesPath, "skills")
    : join(__dirname, "..", "..", "resources", "skills");
}
