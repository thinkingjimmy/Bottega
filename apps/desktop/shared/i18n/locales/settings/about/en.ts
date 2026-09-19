/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides settingsAboutEn — Settings › About identity, licence, links, diagnostics-copy, platform-support, and updater-state copy — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/settings/about; the About and updater feature catalog
 */

/* 段标题只剩 links 一个：产品事实退回身份块的一行，协议成为那行里可点的
   一个词，更新状态贴在同一行右端。于是 product / developer / copyright /
   license / licenseDescription / updates / electron / idle 八个键随它们的
   板块一起消失——键活着而没有渲染点，下一个人就会以为那块界面还在。 */

export const settingsAboutEn = {
  title: "About",
  tagline: "The macOS Agent workspace",
  version: "Version {{version}}",
  licenseName: "MIT License",
  readLicense: "Read the MIT License",
  licenseUnavailable: "The packaged license is unavailable. Read the canonical copy online.",
  licenseCanonical: "Open the canonical copy",
  copy: "Copy",
  copied: "Copied",
  copyDiagnostics: "Copy version details",
  links: "Links",
  repository: "Source repository",
  feedback: "Report an issue",
  feedbackDescription: "Search known issues or file a new one",
  releaseNotes: "Release notes",
  releaseNotesDescription: "What changed in each version",
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
  backgroundFailedOpen:
    "Automatic update checks are failing; open About for details",
  check: "Check for updates",
  upgrade: "Update now",
  manualUpgrade: "Open download page",
  checkedAt: " · checked {{time}}",
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
