/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides settingsUpdatesEn — Settings › Updates page, provider CLI row, platform-support, and updater-state copy — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/settings/updates; the Updates feature catalog
 */


export const settingsUpdatesEn = {
  title: "Updates",
  description: "Manage Bottega and provider CLI updates.",
  updateAll: "Update all",
  updateOne: "Update {{name}}",
  upToDate: "{{name}} is up to date",
  updating: "Updating {{name}}…",
  latestUnknown: "Latest version unknown",
  cliFailed: "Update failed",
  cliUnchanged: "The updater finished, but the version didn't change. Try updating in Terminal.",
  cliTimeout: "The update took too long and was stopped.",
  cliUnavailable: "This CLI can't be updated from here.",
  retry: "Retry",
  log: "Log",
  terminal: "Update in Terminal",
  empty: "No provider CLI is installed yet.",
  checking: "Checking for updates…",
  current: "Up to date{{checkedAt}}",
  available: "Version {{version}} is available",
  downloading: "Downloading version {{version}}",
  installing: "Update downloaded · restarting to install",
  failed: "Update failed: {{message}}",
  failedUnknown: "The update failed for an unknown reason.",
  failedFallback:
    "Update could not be installed automatically. Open the Releases page to download version {{version}}.",
  failedResolution:
    "Download the new version from the Releases page, or report the problem on GitHub.",
  backgroundFailed: "The last automatic check failed",
  backgroundFailedOpen: "Automatic update checks are failing; open Updates for details",
  check: "Check for updates",
  upgrade: "Update now",
  manualUpgrade: "Open download page",
  unavailable: "Update service is available in packaged builds",
  platformSupport: "Platform support",
  preview: "{{platform}} preview",
  previewDescription:
    "Packaging, launch, and updates are supported. These capabilities stay disabled until their OS custody and sandbox contracts are complete:",
  features: {
    agentTurns: "Agent conversations",
    headlessSandbox: "headless Agent tasks",
    ownedGitMutation: "managed Git mutations",
    serverApps: "server Apps",
    chromeImport: "Chrome sign-in import",
    memory: "managed Memory",
  },
};
