/**
 * [INPUT]: No dependencies.
 * [OUTPUT]: Unified native plugin IPC channel names without schema/runtime dependencies.
 * [POS]: Preload-safe channel leaf; validation stays in the platform schema boundary.
 */
export const PLUGIN_PLATFORM_CHANNEL = Object.freeze({
  sharingStatus: "plugin-platform:sharing-status",
  reviewUpdate: "plugin-platform:review-update", acceptUpdate: "plugin-platform:accept-update", dismissUpdate: "plugin-platform:dismiss-update",
  updateProgress: "plugin-platform:update-progress", cancelUpdate: "plugin-platform:cancel-update", publishPlugin: "plugin-platform:publish-package",
  list: "plugin-platform:list", get: "plugin-platform:get", install: "plugin-platform:install",
  setEnabled: "plugin-platform:set-enabled", revisions: "plugin-platform:revisions", restore: "plugin-platform:restore",
  remove: "plugin-platform:remove", changed: "plugin-platform:changed", openFolder: "plugin-platform:open-folder",
  prepareAuthoring: "plugin-platform:prepare-authoring", modes: "plugin-platform:modes", inspect: "plugin-platform:inspect",
  openSurface: "plugin-platform:open-surface", call: "plugin-platform:call", releaseSurface: "plugin-platform:release-surface",
} as const);
