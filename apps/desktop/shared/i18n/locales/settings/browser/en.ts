/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides settingsBrowserEn — Settings › Browser text for Chrome sign-in detection, profile/domain import preview, and failure states — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/settings/browser; Chrome profile, domain name and underlying diagnostic source remain untranslated
 */

export const settingsBrowserEn = {
  sectionTitle: "Import sign-in state from Chrome",
  loginState: "Chrome sign-in state",
  detecting: "Detecting Chrome…",
  detectingAria: "Detecting Chrome",
  readyDescription:
    "Choose a profile and domains before importing. Chrome data is read-only and will not be modified.",
  noProfiles: "Google Chrome or a usable profile was not found.",
  detectFailed: "Could not detect Chrome profiles.",
  platformUnavailable: "Chrome sign-in import is not available in this preview build.",
  startImport: "Start import",
  startImportAria: "Start importing Chrome sign-in state",
  learnMore: "Learn more",
  capability: {
    persistentTitle: "Sign in once and keep the session",
    persistentDetail:
      "You can sign in directly in the embedded Browser even if you skip import. Cookies persist across tabs and app restarts, and the Agent inherits the same session.",
    limitedTitle: "Passwords, extensions, and bookmarks are not imported",
    limitedDetail:
      "Electron does not expose Chrome's password manager or full extension APIs, and bookmarks are not used for Agent browsing. This avoids moving sensitive data without a practical benefit.",
  },
  result: "Imported {{imported}} / skipped {{skipped}} / failed {{failed}}",
  resultFallback:
    "Some sites could not be imported. Sign in once in Browser to keep the session and share it with the Agent.",
  dialogTitle: "Import sign-in state from Chrome",
  dialogDescription:
    "Choose a profile and the domains to import. All domains are selected by default and can be cleared individually. Chrome data is read-only and will not be modified.",
  profile: "Chrome profile",
  cookieDomains: "Cookie domains",
  selectedDomains:
    "{{domains}} domains selected, about {{cookies}} persistent cookies",
  selectAll: "Select all",
  deselectAll: "Deselect all",
  loadingDomains: "Reading domains…",
  previewUnknown: "Unknown error",
  previewFailed: "Could not read Cookie domains from this profile.",
  previewFailureTruth:
    "This profile's Cookies could not be read—it does not mean the profile has no sign-in state.",
  noCookies: "This profile has no persistent Cookies available to import.",
  keychainNotice:
    "After you continue, macOS will request access to “Chrome Safe Storage”. Decryption and import happen only on this Mac; Cookies are never uploaded. Denying access does not affect Chrome.",
  importAction: "Import sign-in state",
  importFailed:
    "Sign-in state import failed. You can still sign in once in Browser and keep the session.",
};
