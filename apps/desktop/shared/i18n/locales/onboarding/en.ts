/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides onboardingEn — the step rail, data location, Agent installation with its Install later exemption and optional capabilities — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/onboarding; the step-driven tables share the one path's step ids while feature rows retain their own badge, state and action copy
 */

// Views interpolate the shared product identity so a rename cannot leave locales out of sync.

export const onboardingEn = {
  rail: {
    steps: "Setup steps",
    intro: "Three quick steps. Everything here can be changed later in Settings.",
    footer: "{{product}} runs locally. Nothing leaves this computer unless you ask it to.",
    done: "Done",
  },
  step: {
    "chat-home": { label: "Data location", hint: "Where your chats and files live" },
    agent: { label: "Agents", hint: "At least one to start chatting" },
    extras: { label: "More", hint: "Skills and memory — optional" },
  },
  heading: { "chat-home": "Where should {{product}} keep your files?", agent: "Set up your Agents", extras: "Get more from {{product}}" },
  description: {
    "chat-home": "Pick an empty folder to start fresh, or an existing {{product}} folder to pick up where you left off. Account settings, keys and device permissions stay on this computer either way.",
    agent: "{{product}} works through the coding Agents on this computer. Install at least one to continue — you can add the others any time from Settings › Providers.",
    extras: "All optional. Skip anything now and turn it on later in Settings.",
  },
  back: "Back", next: "Continue", start: "Get Started",
  folder: "{{product}} folder",
  chatHome: { unconfigured: "Not chosen", ready: "Ready" },
  chatHomeUnset: "Choose a folder on this computer.", choose: "Choose…", opening: "Opening…",
  folderProgress: { opening: "Opening your files… {{completed}} of {{total}}", saving: "Saving your files… {{completed}} of {{total}}" },
  agentLater: "Install later",
  agentLaterFailed: "Could not save this choice. Try again.",
  agentInstalled: "Installed",
  agentChecking: "Checking…",
  agentInstalling: "Waiting for installation…",
  agentCheckFailed: "Couldn't check the installation. Try again.",
  agentAbout: { codex: "OpenAI’s coding Agent", claude: "Anthropic’s coding Agent", kimi: "Moonshot’s coding Agent", opencode: "Open-source, bring your own model" },
  extras: { skills: "Skills", memory: "Long-term memory" },
  skillsAbout: "Import the Skills your Agents already have, so every conversation can use them.",
  skillsFound: "{{count}} found", skillsImported: "Imported", skillsImport: "Import All",
  skillsScanning: "Looking for existing Skills…", skillsNone: "No Skills to import yet", skillsDone: "Your personal Skills Library is ready",
  skillsScanFailed: "Couldn't scan for Skills. Try again or add them later in Settings.",
  skillsImportTitle: "Found {{count}} Skills in your existing Agents",
  skillsImportDescription: "Import them to use in every compatible conversation.",
  skillsImportAll: "Import all and enable", skillsSkip: "Skip", skillsUpdateFailed: "Could not update Skills onboarding",
  memory: {
    badge: { start: "Not set up", installing: "Installing", failed: "Didn’t finish", connect: "Installed", ready: "Ready", on: "On" },
    about: "Remembers what matters from past conversations. Runs a small service on this computer.",
    installing: "Installing {{provider}} — keeps going in the background. You can finish setting it up later.",
    failed: "Installing {{provider}} did not finish.",
    connect: "{{provider}} {{version}} is installed. Connect a model to start remembering.",
    ready: "{{provider}} is ready. Turn it on to start recall and extraction.",
    on: "Settings › Memory shows its activity and gaps.",
    setUp: "Set Up…", retry: "Try Again…", connectAction: "Connect…", progress: "Show Progress", turnOn: "Turn On",
  },
};
