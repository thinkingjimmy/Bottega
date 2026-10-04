/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides the built-in browser and browser-import channel names.
 * [POS]: Zod-free IPC channel names (OPT-34): preload imports these so no schema module enters its bundle; the owning contract modules re-export them unchanged.
 */
export const BROWSER_CHANNEL = {
  createTab: "browser:create-tab",
  closeTab: "browser:close-tab",
  activateTab: "browser:activate-tab",
  navigate: "browser:navigate",
  goBack: "browser:go-back",
  goForward: "browser:go-forward",
  reload: "browser:reload",
  setViewport: "browser:set-viewport",
  setVisible: "browser:set-visible",
  stopAgentBatch: "browser:stop-agent-batch",
  tabsChanged: "browser:tabs-changed",
} as const;

export const BROWSER_IMPORT_CHANNEL = {
  availability: "browser-import:availability",
  detectProfiles: "browser-import:detect-profiles",
  previewCookieDomains: "browser-import:preview-cookie-domains",
  importCookies: "browser-import:import-cookies",
} as const;
