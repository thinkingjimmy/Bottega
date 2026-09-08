/**
 * [INPUT]: Depends on the shared availability state vocabulary.
 * [OUTPUT]: Provides localized Agent availability and recovery copy.
 * [POS]: Availability locale leaf.
 */
export const agentAvailabilityEn = {
  "state": {
    "recent-sign-in": "Recent request needs sign-in",
    "connection": "Connection issue",
    "service": "Service issue",

    "ready": "Ready",
    "unverified": "Not verified",
    "checking": "Checking",
    "missing": "Not installed",
    "unsupported": "Update required",
    "sign-in": "Sign in required",
    "cannot-check": "Could not check",
    "cannot-start": "Cannot start",
    "usage-limit": "Usage limit"
  },
  "imagesPreserved": "This Agent cannot send these images. Your attachments are preserved.",
  "managementUnavailable": "Open the main window to manage Agents.",
  "openMenu": "Open Agent menu",
  "manage": "Manage Agents",
  "login": "Sign in",
  "install": "Install",
  "update": "Update",
  "retry": "Retry",
  "locked": "Agent selection is locked in this Chat.",
  "blocked": "{{backend}} is unavailable. Your draft is preserved.",
  "retrySending": "Retry sending",
  "retryExplanation": "Already signed in, or think the check is wrong? Try sending this message."
};
