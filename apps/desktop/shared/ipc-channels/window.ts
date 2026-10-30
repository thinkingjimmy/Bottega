/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides the window-surface launch arguments and listener-readiness channels, personalization channels and the Dock settings channel. Includes the main-window App pin command.
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

const DOCK_SETTINGS_METHODS = {
  widgetInstallReview:"widget-install-review",
  confirmWidgetInstall:"confirm-widget-install",
  widgetInstallOperation:"widget-install-operation",
  retryWidgetInstall:"retry-widget-install",
  cancelWidgetInstall:"cancel-widget-install",
  widgetLifecycleControl:"widget-lifecycle-control",
  widgetDeliveryControl:"widget-delivery-control",
  widgetPreviewControl:'widget-preview-control',
  widgetPreviewChanged:'widget-preview-changed',
  widgetSnapshot: "widgets",
  widgetHealth:'widget-health',
  widgetApiControl: "system-dock-settings:widget-api-control",
  widgetBaseDirectory:'widget-base-directory',
  revokeWidgetBaseAccess:'revoke-widget-base-access',
  widgetUpdateReview:'widget-update-review',
  widgetUpdateForm:'widget-update-form',
  stageWidgetUpdate:'stage-widget-update',
  newWidget: "new-widget",
  editWidget: "edit-widget",
  forkWidget:'fork-widget',
  buildWidget: "build-widget",
  instancePreview:'instance-preview',
  savedWidgetPreview:'saved-widget-preview',
  submitWidgetInstance:'submit-widget-instance',
  officialWidgetPreview:'official-widget-preview',
  submitOfficialWidget:'submit-official-widget',
  setWidgetPaused:'set-widget-paused',
  removeWidgetInstance:'remove-widget-instance',
  applyWidget:"apply-widget",
  widgetOperation:"widget-operation",
  widgetPreview: "widget-preview",
  widgetVersions:'widget-versions',
  previewWidgetVersion:'preview-widget-version',
  widgetsChanged: "widgets-changed",
  snapshot: "snapshot",
  changed: "changed",
  beginSetup: "begin-setup",
  confirmSetup: "confirm-setup",
  cancelSetup: "cancel-setup",
  importCandidates: "import-candidates",
  confirmImport: "confirm-import",
  setAppPinned: "set-app-pinned",
  setPreference: "set-preference",
  setMode: "set-mode",
  disable: "disable",
  restoreSystemDock: "restore",
  resume: "resume",
  resetLayout: "reset-layout",
  resolveConflict: "resolve-conflict",
  openRecoverySettings: "open-recovery-settings",
} as const;

export const SYSTEM_DOCK_SETTINGS_CHANNEL=/* @__PURE__ */ (()=>Object.fromEntries(Object.entries(DOCK_SETTINGS_METHODS).map(([method,suffix])=>[method,`system-dock-settings:${suffix}`])))() as {readonly [K in keyof typeof DOCK_SETTINGS_METHODS]:`system-dock-settings:${typeof DOCK_SETTINGS_METHODS[K]}`};
