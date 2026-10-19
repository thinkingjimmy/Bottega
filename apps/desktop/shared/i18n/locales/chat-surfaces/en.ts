/**
 * [INPUT]: Depends on no runtime modules; defines the structural baseline for side-panel and usage-limit copy
 * [OUTPUT]: Provides Chat surface copy, including exact-command service controls and local-file preview actions
 * [POS]: English Chat surfaces locale leaf assembled into the existing chat namespace
 */

export const chatSurfacesEn = {
  nativeBackground: {
    "running": "Running",
    "stopFailed": "Stop failed",
    "retry": "Retry stop",
    "stopNamed": "Stop {{name}}",
    "retryNamed": "Retry stopping {{name}}",
    "services": "Services running in this chat",
    "stop": "Stop",
    "stopping": "Stopping…",
    "started": "Started with {{mode}}. Continues after the reply.",
    "failed": "Could not confirm that this command stopped. Try again.",
    "modes": {
      "ask-for-approval": "Ask for approval",
      "approve-for-me": "Approve for me",
      "full-access": "Full access"
    }
  },
  sidePanel: {
    shell: {
      loadingBase: "Loading Base",
      closePreview: "Close preview",
      readingFile: "Reading file…",
      bytes: "{{count}} bytes",
      resize: "Resize side panel",
      resizeHint: "Drag or use the arrow keys to resize the side panel",
    },
    file: {
      open: "Open with system app",
      reveal: "Show in Finder",
      copyPath: "Copy path",
      copied: "Path copied",
      retry: "Retry",
      missing: "This file no longer exists at this path.",
      outside: "This file is outside the current workspace, or the workspace has changed.",
      readFailed: "This file could not be previewed. Try again.",
      actionFailed: "The file action failed. Open the preview again and retry.",
      tooLarge: "This file exceeds the 1 MiB preview limit. You can open it with a system app.",
      binary: "This file is not UTF-8 text. You can open it with a system app.",
    },
    appGrant: {
      badgeAria: "{{name}} permissions — data: {{data}}; acts for you: {{delegation}}",
      on: "On",
      off: "Off",
      omittedIntro: "The Agent did not see this App last turn — {{reason}}",
      omission: {
        referenceLimit:
          "this Chat has too many Apps attached. Remove a few and try again.",
        instructionBudget:
          "the attached App instructions exceed the 2 KB budget. Remove a few Apps and try again.",
        backendUnsupported:
          "the current backend has no tool channel, so acting for you is unavailable. Read-only file access still applies.",
        baseToolsDisabled:
          "the Base read and write tools are both off. Turn them on in Settings › Tools.",
      },
      degradation: {
        baseReadsDisabled:
          "This turn it can only change rows, not read tables: Base reads are turned off.",
        baseRowMutationsDisabled:
          "This turn it can only read tables, not change rows: Base row changes are turned off.",
      },
      excludedIntro:
        "An extension was not delivered last turn, so this App is not running in full: {{items}}",
      excludedItem: "{{name}} ({{code}})",
      excludedRequiredItem: "{{name}} ({{code}}, required)",

      extensionDetails: "Extension and delivery details",
      requirementSummary:
        "Requirement: {{requirement}}; installed: {{installed}}; admission: {{admission}}; generation: {{generation}}; enabled: {{enabled}}; granted to App: {{granted}}",
      required: "Required",
      optional: "Optional",
      yes: "Yes",
      no: "No",
      none: "None",
      unknown: "Unknown",
      unresolved: "Unresolved",
      configOverrideDiff: "Config override: {{value}}",
      eligible: "Eligible: {{value}}",
      turnActive: "Active this turn: {{active}}",
    },
    appTab: {
      readFailed: "Could not read App status",
      surfaceFailed: "Could not issue the App surface",
      unavailable:
        "The App is unavailable or being deleted. Its slot is preserved, but no runtime or data capability will be issued.",
      stop: "Stop App",
      startFailed: "Could not start the App",
      open: "Open App",
      opening: "Opening…",
      notAuthorized:
        "This App is not authorized in this Chat yet, so it cannot read data or open its surface here.",
      authorize: "Authorize in this Chat",
    },
    image: {
      fallbackTitle: "Image",
      preview: "Image preview",
      previewNamed: "Image preview: {{name}}",
      zoom: "Zoom",
      restoring: "Restoring image",
      reading: "Reading image",
      unavailable:
        "The image is no longer in this conversation or is temporarily unavailable.",
      retry: "Retry",
    },
  },
  transcript: {
    image: {
      unavailable: "Image preview unavailable",
      reading: "Reading image",
      generatedAlt: "Generated image",
      openInSidePanel: "Open image in the side panel: {{title}}",
      fallbackTitle: "Image",
    },
    actions: {
      copy: "Copy",
      copied: "Copied",
    },
    outlineLabel: "Conversation outline",
    plan: {
      editingAria: "Plan is being edited",
      editing: "Editing",
      title: "Plan",
      copy: "Copy Plan",
      copied: "Copied",
      collapsePanel: "Collapse the Plan side panel",
      showPanel: "Show Plan in the side panel",
      showFullPanel: "Show the full Plan in the side panel",
    },
    loadEarlier: "Show earlier messages",
    loadingEarlier: "Loading earlier messages…",
    fatalResultTitle: "This turn’s result could not be saved",
    fatalResultLocked: "Input stays locked until you discard this turn’s result.",
    abandonFatal: "Discard this turn’s result",
    cleanupFailedTitle: "Process cleanup did not finish",
    cleanupFailed:
      "{{backend}} process-group cleanup failed. Confirm that the related processes have ended before unlocking this Chat.",
    acknowledgeCleanup: "I confirmed the processes ended",
    loadedEarlier: "Loaded {{count}} earlier messages",
    subagentDetailsCleared: "This Subagent’s details have been cleared",
    subagentDetailsLimited: "Realtime detail reached its limit",
    showLess: "Show less",
    showMore: "Show more",
    openAttachmentInSidePanel: "Open image in the side panel: {{title}}",
    workingFor: "Working for {{duration}}",
  },
  usageLimit: {
    unavailable: "{{backend}} is temporarily unavailable",
    resetTime: "Reset time",
    usageWindow: "Usage window",
    window: {
      fiveHour: "5-hour window",
      weekly: "Weekly window",
    },
    retry: "Retry now",
    resetAt: "{{date}} ({{zone}})",
    aboutMinutes: "About {{minutes}} min",
    aboutHours: "About {{hours}} hr",
    aboutHoursMinutes: "About {{hours}} hr {{minutes}} min",
  },
};
