/**
 * [INPUT]: The startup-owned plugin Surface integration lifetime.
 * [OUTPUT]: Installed plugin integration for window security, workspace and scoped tool composition.
 * [POS]: Main-process composition cell; plugin frames never access this module.
 */
import type { PluginSurfaceIntegration } from './service';
let installed:PluginSurfaceIntegration|null=null;
export const pluginSurfaceIntegration=()=>installed;
export function installPluginSurfaceIntegration(value:PluginSurfaceIntegration|null){installed=value;}
