/**
 * [INPUT]: No runtime dependencies; translated Dock plugin copy.
 * [OUTPUT]: Provides dock catalog strings for en.
 * [POS]: Nested workbench plugin catalog, consumed by Dock cards, settings and health.
 */
export const dock = {
  "name": "Bottega Dock",
  "summary": "App shortcuts and usage widgets alongside the macOS Dock. Off by default.",
  "description": "The Bottega Dock sits next to the macOS Dock with shortcuts to your Apps and small widgets for usage.\n\nIt is off by default. Set it up to choose how it looks and when it shows.",
  "running": "Dock is running",
  "off": "Off",
  "loading": "Checking Dock…",
  "unsupported": "Unavailable on this computer",
  "recoveryPending": "Recovery needs attention. Retry recovery in Dock settings.",
  "coexist": "Alongside the system Dock",
  "replace": "Replacing the system Dock",
  "replacementPending": "Unavailable in 0.2.0; safety validation pending",
  "autohide": "Auto-hide",
  "pinned": "Always visible",
  "settings": {
    "showHandle": "Show handle",
    "privacyMask": "Hide sensitive values",
    "showRunning": "Show running Apps",
    "scale": "Size",
    "visibility": "Visibility"
  },
  "labels": {
    "mode": "Mode",
    "phase": "Runtime phase",
    "registration": "Recovery agent",
    "accessibility": "Accessibility",
    "automation": "Finder automation",
    "recovery": "Last recovery",
    "sync": "Layout sync",
    "replacement": "Replacement mode"
  },
  "phase": {
    "inactive": "Inactive",
    "preparing": "Preparing",
    "active": "Active",
    "restoring": "Restoring",
    "suspended": "Paused"
  },
  "registration": {
    "notRegistered": "Not registered",
    "enabled": "Registered",
    "requiresApproval": "Waiting for approval",
    "notFound": "Recovery service missing",
    "unsupported": "Not available in this build",
    "unknown": "Could not verify registration"
  },
  "permission": {
    "granted": "Allowed",
    "notGranted": "Not allowed",
    "unsupported": "Not checked",
    "unknown": "Not checked",
    "needsPrompt": "Ask when used",
    "denied": "Denied",
    "unavailable": "Unavailable"
  },
  "recovery": {
    "none": "No recovery recorded",
    "restored": "Restored",
    "keptExternal": "Kept your system changes",
    "failed": "Recovery could not be confirmed"
  },
  "sync": {
    "localOnly": "Local only",
    "synced": "Synced; continues while Dock is off",
    "pending": "Changes waiting to sync",
    "offline": "Offline; layout kept on this computer",
    "conflict": "Layout changes need review",
    "blocked": "Sync is unavailable",
    "error": "Sync failed; layout kept"
  },
  "unsupportedReason": {
    "platform": "Requires macOS 15 or later",
    "architecture": "Requires Apple silicon",
    "osVersion": "Requires macOS 15 or later",
    "helperMissing": "Dock helper is missing. Reinstall Bottega."
  },
  "effects": {
    "restore": "Restore the system Dock before completing shutdown.",
    "unregister": "Unregister the recovery agent after recovery is confirmed.",
    "hide": "Hide the Dock bar, its menu and widgets. Keep your layout and continue layout sync when available."
  },
  "capabilities": {
    "launch": "Opens Apps and system shortcuts on this Mac",
    "usage": "Reads existing local usage and limit data",
    "sync": "Keeps layout sync active even while Dock is off",
    "permissions": "Optional Accessibility and Finder automation permissions remain under your control"
  }
};
