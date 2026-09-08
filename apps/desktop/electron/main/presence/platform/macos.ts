/**
 * [INPUT]: Depends on Electron app login APIs and explicit darwin/agentTurns capability facts.
 * [OUTPUT]: Provides the fixed macOS login adapter and presence platform support gate.
 * [POS]: Production platform composition; no environment-based adapter selection.
 */

import { app } from "electron";
import { resolvePlatformCapabilities } from "../../../../shared/platform-capabilities";
import { selectLoginItem } from "./login-item";
export const supportsPresence = process.platform === "darwin" && resolvePlatformCapabilities(process.platform).capabilities.agentTurns;
export function createLoginItem() {
  return selectLoginItem({ supported: supportsPresence, packaged: app.isPackaged,
    real: () => ({
      read() { const fact = app.getLoginItemSettings(); return { enabled: fact.openAtLogin && fact.status === "enabled", wasOpenedAtLogin: fact.wasOpenedAtLogin, approval: fact.status === "requires-approval" }; },
      write(enabled) { app.setLoginItemSettings({ openAtLogin: enabled }); },
    }) });
}
