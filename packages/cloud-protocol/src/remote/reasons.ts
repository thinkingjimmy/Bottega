/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides REMOTE_REASONS, the closed list of remote-control refusal and failure reasons. Includes the App-disabled remote refusal.
 * [POS]: Zod-free source of the reason list (OPT-34 step 2b): model.ts builds remoteReasonSchema from it, and the chat-ui reason matcher reads it without loading the remote contract or zod.
 */
export const REMOTE_REASONS = ["remote-disabled", "protocol-mismatch", "device-offline", "device-revoked", "source-revoked",
  "not-owner", "chat-incarnation-mismatch", "chat-not-executable", "execution-not-ready", "project-path-unbound", "project-unavailable",
  "chat-home-unavailable", "permission-required", "agent-missing", "agent-outdated", "auth-required", "agent-unavailable", "agent-revision-changed", "fact-revision-changed", "local-facts-pending",
  "request-not-active", "interaction-expired", "command-expired", "connection-changed", "capacity-exceeded", "admission-failed", "execution-failed", "outcome-unknown",
  "target-changed", "agent-changed", "already-dispatched", "body-unavailable", "identity-changed", "attachment-unavailable", "attachment-invalid", "input-unsupported", "fork-failed", "revision-stale", "revision-busy", "reference-target-changed", "workspace-changed", "workspace-file-unavailable", "workspace-text-unavailable", "skill-unavailable", "queue-changed",
  "entitlement-required", "quota-exceeded", "app-disabled", "app-transitioning",
  /* U06 Q7: a first message whose reservation another Edit Chat filled, or whose reservation expired. */
  "reservation-filled", "reservation-expired"] as const;
