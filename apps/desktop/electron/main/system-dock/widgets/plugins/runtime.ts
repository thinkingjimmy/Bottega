/**
 * [INPUT]: Depends only on the unified Dock owner type.
 * [OUTPUT]: Installs and reads the current unified Dock plugin owner for trusted native IPC.
 * [POS]: Late-bound lifetime seam between system-dock composition and its isolated windows.
 */
import type { PluginDockWidgets } from "./owner";
let installed: PluginDockWidgets | null = null;
export function installPluginDockWidgets(owner: PluginDockWidgets | null) { installed = owner; }
export const pluginDockWidgets = () => installed;
