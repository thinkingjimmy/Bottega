/**
 * [INPUT]: Dependency-free channels and erased platform bridge types.
 * [OUTPUT]: Preload-safe unified plugin channels and bridge/action types.
 * [POS]: Runtime-safe native bridge entry; importing it never constructs a schema.
 */
export { PLUGIN_PLATFORM_CHANNEL } from "./channels";
export type { UnifiedPluginBridge, UnifiedPluginHostImpact, PluginModeSelection, PluginPrepareAuthoringInput, PluginPrepareAuthoringResult,
  UnifiedPluginInstallInput, UnifiedPluginRestoreInput, UnifiedPluginMode } from "../bridge";
