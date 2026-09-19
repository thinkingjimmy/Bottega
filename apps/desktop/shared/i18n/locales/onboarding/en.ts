/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides onboardingEn — usage mode, account availability, remote computers, installation, data location and optional capabilities — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/onboarding; step-driven tables share the local/account step ids while feature rows retain their own state and action copy
 */

// Views interpolate the shared product identity so a rename cannot leave locales out of sync.

export const onboardingEn = {
  mode: {"local": {"title": "Use on this computer", "description": "Everything stays on this computer. You can sign in and sync later in Settings."}, "account": {"title": "Connect an existing account", "description": "Sign in to join your encrypted sync space and sync content across devices."}},
  accountUnavailable: "Account connection is temporarily unavailable.",
  agentPlace: {"local": "Install on this computer", "remote": "Use another computer"},
  remoteEmpty: "Sign in and install an Agent on another computer first.",
  folderProgress: {"opening": "Opening your files… {{completed}} of {{total}}", "saving": "Saving your files… {{completed}} of {{total}}"} ,
  agentInstalled: "Installed",
  agentChecking: "Checking…",
  agentInstalling: "Waiting for installation…",
  agentCheckFailed: "Couldn't check the installation. Try again.",
  step: { mode: "Usage", account: "Connect account", "chat-home": "Data location", agent: "Agent", extras: "More capabilities" },
  heading: { mode: "How will you use {{product}}?", "chat-home": "Where should {{product}} keep your files?", agent: "Set up your Agent", extras: "Get more from {{product}}" },
  back: "Back", next: "Continue", start: "Get started",
  description: { mode: "Choose how to get started.", "chat-home": "Choose an existing Bottega folder to restore its contents, or an empty folder to start. Account settings, keys and device permissions stay on this computer.", agent: "Install at least one Agent to continue.", extras: "Bring in reusable Skills and set up long-term memory. Both are optional and can be changed later in Settings." },
  extras: { skills: "Skills", memory: "Long-term memory" },
  skillsScanFailed: "Couldn't scan for Skills. Try again or add them later in Settings.",
  skillsImportTitle: "Found {{count}} Skills in your existing Agents",
  skillsImportDescription: "Import them to use in every compatible conversation.",
  skillsScanning: "Looking for existing Skills…", skillsFound: "Found {{count}} Skills in your existing Agents · Import them to use from every compatible conversation", skillsNone: "No Skills to import yet", skillsDone: "Your personal Skills Library is ready", skillsImportAll: "Import all and enable", skillsSkip: "Skip", skillsUpdateFailed: "Could not update Skills onboarding",
  chatHome: { unconfigured: "Choose a folder on this computer.", ready: "Your Bottega folder is ready." },
  chatHomeUnset: "Not chosen yet", choose: "Choose folder…", opening: "Opening…",
  memoryEnabled: "Settings › Memory shows its activity and gaps.", memoryDisabled: "Install the local memory service and confirm the privacy disclosure once; recall and extraction begin after that.",
  memoryAction: "Set up memory",
  memoryInstalling: "Installing {{provider}}… continues in the background. You can get started now.", memoryInstallFailed: "Installing {{provider}} did not finish.",
  memoryConnect: "{{provider}} {{version}} is installed. Connect a model to finish.", memoryReady: "{{provider}} is ready. Turn it on to start recall and extraction.",
  memoryProgress: "Show progress", memoryTurnOn: "Turn on", memoryHide: "Hide",
};
