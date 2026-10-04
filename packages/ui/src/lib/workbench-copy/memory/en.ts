/**
 * [INPUT]: Depends on the Memory plugin metadata, settings and pause impact contracts.
 * [OUTPUT]: Provides en copy for the official Memory plugin.
 * [POS]: Localized Memory feature copy within the workbench catalog.
 */
export const memoryPluginCopy = {
  "name": "Memory",
  "summary": "Recall useful chat context within the sharing scope you choose.",
  "description": "Memory remembers useful context from your Chats and brings it back when it helps, like a decision from last week or how you like reports written.\n\nYou choose how far it is shared: within each Chat, each Project, or across all Chats. Extraction uses a model you pick and may incur charges, so Bottega asks before turning it on. Existing history is excluded.",
  "settings": {
    "backend": {
      "label": "Memory backend"
    },
    "sharingMode": {
      "label": "Sharing scope"
    },
    "phoneFacade": {
      "label": "Memory status and controls on phone and Web"
    },
    "workflowRoles": {
      "label": "Allow workflow roles to read Memory"
    }
  },
  "sharing": {
    "chat": "This chat",
    "group": "This Project",
    "personal": "All chats"
  },
  "capability": {
    "recall": "Recall within your sharing scope",
    "capture": "Save eligible context with your consent",
    "backfill": "Process only authorized history"
  },
  "confirmation": {
    "title": "Confirm Memory change",
    "cutover": "Use this backend. Extraction uses {{model}} at {{hostname}} and may incur model charges. Existing history is excluded.",
    "chat": "Keep future Memory within each chat. Extraction uses {{model}} at {{hostname}} and may incur model charges. Existing history is excluded.",
    "group": "Share future Memory within each Project. Extraction uses {{model}} at {{hostname}} and may incur model charges. Existing history is excluded.",
    "personal": "Share future Memory across all chats. Extraction uses {{model}} at {{hostname}} and may incur model charges. Existing history is excluded."
  },
  "effects": {
    "recall": "Pause recall for new chat and workflow turns.",
    "capture": "Pause new capture; keep saved memories.",
    "backfill": "Pause regular history processing.",
    "phone": "Pause Memory for phone and Web chats.",
    "rebuild": "An already authorized rebuild continues and may incur model charges."
  },
  "health": {
    "backend": "Backend",
    "version": "Installed version",
    "sharing": "Sharing scope",
    "service": "Status",
    "directory": "Data folder",
    "unknown": "Not yet known",
    "unsupported": "Memory is available on macOS.",
    "missing": "Install the selected backend in Memory settings.",
    "configuration": "Complete the backend configuration in Memory settings.",
    "repair": "Check or repair the backend in Memory settings.",
    "off": "Set up Memory to begin.",
    "paused": "Paused; saved memories are kept.",
    "ready": "Ready",
    "checking": "Checking the backend…"
  }
};
