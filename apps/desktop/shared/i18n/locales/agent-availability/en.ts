/**
 * [INPUT]: Depends on the shared availability state vocabulary.
 * [OUTPUT]: Provides localized Agent availability and recovery copy, including the custom-route state, why sign-in is not verified, and why a catalog entry is unavailable.
 * [POS]: Availability locale leaf.
 */
export const agentAvailabilityEn = {
  "state": {
    "recent-sign-in": "Recent request needs sign-in",
    "connection": "Connection issue",
    "service": "Service issue",

    "ready": "Ready",
    "custom-route": "Custom endpoint · sign-in not verified",
    "unverified": "Not verified",
    "checking": "Checking",
    "missing": "Not installed",
    "unsupported": "Update available",
    "sign-in": "Not signed in",
    "cannot-check": "Could not check",
    "cannot-start": "Cannot start",
    "usage-limit": "Usage limit",
    "unavailable": "Unavailable"
  },
  "unavailableReason": {
    "package-disabled": "Turned off in Plugins",
    "package-removed": "Removed from this computer",
    "package-refused": "Couldn't be loaded",
    "trust-refused": "Not trusted on this computer"
  },
  "imagesPreserved": "This Agent cannot send these images. Your attachments are preserved.",
  "managementUnavailable": "Open the main window to manage Agents.",
  "openMenu": "Open Agent menu",
  "manage": "Manage Agents",
  "login": "Sign in",
  "retry": "Retry",
  "locked": "Agent selection is locked in this Chat.",
  "blocked": "{{backend}} is unavailable. Your draft is preserved.",
  "retrySending": "Retry sending",
  "retryExplanation": "Already signed in, or think the check is wrong? Try sending this message.",
  "customRoute": "{{backend}} sends requests to an endpoint you configured. Bottega can't confirm that sign-in works there; a failed request will say why.",
  "isolatedConfig": "Bottega runs {{backend}} with its own configuration. Providers set up in ~/.config/opencode or a project's opencode.json aren't used here.",
  "unverifiedReason": {
    "provider-scoped": "{{backend}} checks sign-in per project, so it is confirmed when a Chat runs.",
    "not-supported": "{{backend}} can't report its sign-in status to Bottega. If it needs you to sign in, the Chat will say so."
  }
};
