/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides the window-surface launch arguments and listener-readiness channels, personalization channels and the Dock settings channel.
 * [POS]: Zod-free IPC channel names (OPT-34): preload imports these so no schema module enters its bundle; the owning contract modules re-export them unchanged.
 */
export const WINDOW_ROLE_ARGUMENT = "--bottega-window-role=";

export const WINDOW_ID_ARGUMENT = "--bottega-window-id=";

export const WINDOW_APP_ID_ARGUMENT = "--bottega-app-id=";

export const WINDOW_SURFACES_CHANNEL = {
  residence: "window-surfaces:residence",
  navigationIntent: "window-surfaces:navigation-intent",
  show: "window-surfaces:show",
  openInWindow: "window-surfaces:open-in-window",
  reclaim: "window-surfaces:reclaim",
  syncUseChat: "window-surfaces:sync-use-chat",
  commandReady: "window-surfaces:command-ready",
  migrationReply: "window-surfaces:migration-reply",
  command: "window-surfaces:command",
} as const;

export const PERSONALIZATION_CHANNEL = {
  list: "personalization:list",
  save: "personalization:save",
  reveal: "personalization:reveal",
} as const;

export const PROJECT_PERSONALIZATION_CHANNEL = {
  list: "personalization:project:list",
  save: "personalization:project:save",
  reveal: "personalization:project:reveal",
} as const;

export const SYSTEM_DOCK_SETTINGS_CHANNEL = {
  snapshot: "system-dock-settings:snapshot",
  changed: "system-dock-settings:changed",
  beginSetup: "system-dock-settings:begin-setup",
  confirmSetup: "system-dock-settings:confirm-setup",
  cancelSetup: "system-dock-settings:cancel-setup",
  importCandidates: "system-dock-settings:import-candidates",
  confirmImport: "system-dock-settings:confirm-import",
  setPreference: "system-dock-settings:set-preference",
  setMode: "system-dock-settings:set-mode",
  disable: "system-dock-settings:disable",
  restoreSystemDock: "system-dock-settings:restore",
  resume: "system-dock-settings:resume",
  resetLayout: "system-dock-settings:reset-layout",
  resolveConflict: "system-dock-settings:resolve-conflict",
  openRecoverySettings: "system-dock-settings:open-recovery-settings",
} as const;
