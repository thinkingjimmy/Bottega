/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides onboardingEn — two-step folder/Agent setup, its Install later exemption and completion, plus the separate Chat Skills import prompt — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/onboarding; the heading/description tables share the one path's step ids while the Chat Skills prompt retains its import and dismissal copy
 */

// Views interpolate the shared product identity so a rename cannot leave locales out of sync.

export const onboardingEn = {
  heading: { "chat-home": "Where should {{product}} keep your files?", agent: "Set up your Agents" },
  description: {
    "chat-home": "Chats, files and skills live in one folder you own. Account settings, keys and device permissions stay on this computer either way.",
    agent: "{{product}} works through the coding Agents on this computer. Install at least one to continue — you can add the others any time from Settings › Providers.",
  },
  next: "Continue", start: "Get Started",
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
  skillsImportTitle: "Found {{count}} Skills in your existing Agents",
  skillsImportDescription: "Import them to use in every compatible conversation.",
  skillsImportAll: "Import all and enable", skillsSkip: "Skip", skillsUpdateFailed: "Could not update Skills onboarding",
};
