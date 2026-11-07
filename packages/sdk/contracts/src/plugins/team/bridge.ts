/**
 * [INPUT]: Erased public team bridge types only.
 * [OUTPUT]: Preload-safe persistent team IPC channel names and bridge type.
 * [POS]: Team transport leaf; snapshot/task/message validation remains in the schema module.
 */
export const PLUGIN_TEAM_CHANNEL = Object.freeze({
  list: "plugin-team:list", get: "plugin-team:get", createTask: "plugin-team:create-task", stopMember: "plugin-team:stop-member",
  openMember: "plugin-team:open-member", changed: "plugin-team:changed",
});
export type { PluginTeamBridge } from "./index";
