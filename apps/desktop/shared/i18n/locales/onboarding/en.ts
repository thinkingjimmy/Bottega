/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Includes Memory plugin enable, paused/resume and unsupported states; Provides onboardingEn — the Optional step marker, data location (the suggested folder and the chooser), Agent installation with its Install later exemption and optional capabilities — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/onboarding; the heading/description tables share the one path's step ids while feature rows retain their own badge, state and action copy
 */

// Views interpolate the shared product identity so a rename cannot leave locales out of sync.

export const onboardingEn = {
  optional: "Optional",
  heading: { "chat-home": "Where should {{product}} keep your files?", agent: "Set up your Agents", extras: "Get more from {{product}}" },
  description: {
    "chat-home": "Chats, files and skills live in one folder you own. Account settings, keys and device permissions stay on this computer either way.",
    agent: "{{product}} works through the coding Agents on this computer. Install at least one to continue — you can add the others any time from Settings › Providers.",
    extras: "All optional. Skip anything now and turn it on later in Settings.",
  },
  back: "Back", next: "Continue", start: "Get Started",
  folder: {
    aria: "Where to keep your files",
    fresh: "Start fresh", recommended: "Recommended", freshDetail: "Creates {{path}} for you.",
    found: "Continue where you left off", foundBadge: "Found", foundDetail: "{{path}} already holds your {{product}} chats and files.",
    choose: "Choose a folder…", chooseDetail: "New or existing — {{product}} works out which.",
  },
  opening: "Opening…",
  folderProgress: { opening: "Opening your files… {{completed}} of {{total}}", saving: "Saving your files… {{completed}} of {{total}}" },
  agentLater: "Install later",
  agentLaterFailed: "Could not save this choice. Try again.",
  agentInstalled: "Installed",
  agentChecking: "Checking…",
  agentInstalling: "Waiting for installation…",
  agentCheckFailed: "Couldn't check the installation. Try again.",
  agentAbout: { codex: "OpenAI’s coding Agent", claude: "Anthropic’s coding Agent", kimi: "Moonshot’s coding Agent", opencode: "Open-source, bring your own model" },
  extras: { skills: "Skills", memory: "Memory plugin" },
  skillsAbout: "Import the Skills your Agents already have, so every conversation can use them.",
  skillsFound: "{{count}} found", skillsImported: "Imported", skillsImport: "Import All",
  skillsScanning: "Looking for existing Skills…", skillsNone: "No Skills to import yet", skillsDone: "Your personal Skills Library is ready",
  skillsScanFailed: "Couldn't scan for Skills. Try again or add them later in Settings.",
  skillsImportTitle: "Found {{count}} Skills in your existing Agents",
  skillsImportDescription: "Import them to use in every compatible conversation.",
  skillsImportAll: "Import all and enable", skillsSkip: "Skip", skillsUpdateFailed: "Could not update Skills onboarding",
  memory: {
    badge: { start: "Not set up", installing: "Installing", failed: "Didn’t finish", connect: "Installed", ready: "Ready", on: "On", paused: "Paused", unsupported: "Not supported" },
    about: "Remembers what matters from past conversations. Runs a small service on this computer.",
    installing: "Installing {{provider}} — keeps going in the background. You can finish setting it up later.",
    failed: "Installing {{provider}} did not finish.",
    connect: "{{provider}} {{version}} is installed. Connect a model to start remembering.",
    ready: "{{provider}} is ready. Turn it on to start recall and extraction.",
    on: "Open the Memory plugin settings to view activity and gaps.",
    paused: "Memory is paused. Saved memories are kept.", resume: "Resume",
    setUp: "Set Up…", retry: "Try Again…", connectAction: "Connect…", progress: "Show Progress", turnOn: "Enable Memory plugin",
  },
};
