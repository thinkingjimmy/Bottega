/**
 * [INPUT]: Depends on interpolation facts from main-owned App compatibility and update contracts.
 * [OUTPUT]: Provides localized minimum-host installation and updater guidance.
 * [POS]: App host-version locale leaf, assembled by its matching top-level catalog.
 */

export const appHostEn = {
  "title": "Update Bottega first",
  "invalidTitle": "App release information needs attention",
  "APP_HOST_UPDATE_REQUIRED": "Installing {{name}} requires Bottega {{minimum}} or later. You are running {{current}}.",
  "APP_COMPATIBILITY_MISSING": "This App is missing its required release information. Check again or contact the author.",
  "APP_COMPATIBILITY_INVALID": "This App’s release information is invalid. Check again or contact the author.",
  "APP_COMPATIBILITY_SCHEMA_UNSUPPORTED": "This version of Bottega cannot read this App’s release information.",
  "APP_HOST_VERSION_UNAVAILABLE": "The running Bottega version could not be verified. Check again.",
  "oldVersionUsable": "The currently installed App remains available.",
  "upgrade": "Update Bottega",
  "cancel": "Not now",
  "recheck": "Check again",
  "waitingLabel": "Bottega update required",
  "resume": "Continue installation",
  "requiredContext": "{{name}} requires Bottega {{minimum}}. You are running {{current}}.",
  "waitingDownload": "The current download will finish before checking the required version.",
  "checking": "Checking for the required Bottega version…",
  "unavailable": "No Bottega release meeting this App’s requirement was found in this check.",
  "installBusy": "An update is being prepared for installation. Its version cannot be changed yet.",
  "retryError": "The update could not complete. Check again to retry.",
  "returnToApp": "Return to App",
  "dismiss": "Close update guidance",
  "candidateUnavailable": "The original App candidate is no longer available or allowed. Check the latest candidate and review it again.",
  "checkLatest": "Check latest candidate"
};
