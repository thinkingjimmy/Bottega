/**
 * [INPUT]: Depends on no runtime modules
 * [OUTPUT]: Provides localized Agent selection, pending, eligibility, and retained-history disclosure
 * [POS]: Chat Agent switch locale leaf
 */

export const chatAgentSwitchEn = {
  "pending": "The next message will be answered by {{backend}}. Chat history stays here.",
  "undo": "Undo",
  "details": "Continuation details",
  "explanation": "The new Agent receives history excerpts and can read saved records when available. Historical images and live tool state are not inherited.",
  "permission": "Permission: {{from}} → {{to}}",
  "confirming": "Confirming the send result…",
  "recovering": "Message saved. Recovering…",
  "stale": "This Chat changed. Choose the target Agent again.",
  "adjacent": "Send a new message or undo the Agent switch first.",
  "defaultsFailed": "Chat options saved; updating global defaults failed.",
  "divider": "Replies from here are by {{backend}}",
  "notInjected": "Some history was not included; saved records may be available to read.",
  "storageTrimmed": "Some earlier records are no longer saved.",
  "lookupUnavailable": "History lookup is unavailable for this turn.",
  "running": "Reply must finish before switching.",
  "queue": "Handle queued messages before switching.",
  "recovery": "Finish recovery before switching.",
  "readonly": "This Chat is read-only. Adopt it with its source Agent first.",
  "app-bound": "This Agent is set by the App.",
  "archived": "Archived Chats cannot switch Agents.",
  "approval": "Resolve the pending approval first.",
  "plan-review": "Finish the Plan review first.",
  "paused": "Resume or end the paused chain first.",
  "submission": "Confirm the previous submission first.",
  "selectionFailed": "Agent selection failed: {{message}}",
  "revision-stale": "This Chat changed. Choose the target Agent again."
};
