/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides settingsBrowserEn — Settings › Browser text for the setup guide, Chrome sign-in detection, profile/domain import preview, and failure states — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/settings/browser; Chrome profile, domain name and underlying diagnostic source remain untranslated
 */

export const settingsBrowserEn = {
  detecting: "Detecting Chrome…",
  noProfiles: "Google Chrome or a usable profile was not found.",
  detectFailed: "Could not detect Chrome profiles.",
  platformUnavailable: "Chrome sign-in import is not available in this preview build.",
  guideTitle: "Use your Chrome sign-ins in Bottega",
  guideDescription:
    "Import the sign-in state of chosen sites so Agents can browse as you. You pick the profile and the sites before anything is imported.",
  guideAction: "Import from Chrome…",
  facts: {
    readOnlyTitle: "Read-only",
    readOnlyDetail: "Chrome is not modified.",
    localTitle: "Stays on this Mac",
    localDetail: "Cookies are never uploaded.",
    keychainTitle: "Keychain access",
    keychainDetail: "macOS asks once; denying does not affect Chrome.",
  },
  lastImport: "Last import",
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
