/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides the Agent, Chats and usage-limits channel names.
 * [POS]: Zod-free IPC channel names (OPT-34): preload imports these so no schema module enters its bundle; the owning contract modules re-export them unchanged.
 */
export const AGENT_CHANNEL = {
  event: "agent:event",
  cancel: "agent:cancel",
  respondApproval: "agent:respond-approval",
  respondUserInput: "agent:respond-user-input",
  turnAttach: "agent:turn-attach",
  turnDetach: "agent:turn-detach",
  abandonFatalTurn: "agent:abandon-fatal-turn",
  acknowledgeCleanupFailure: "agent:acknowledge-cleanup-failure",
  abandonResumeFailure: "agent:abandon-resume-failure",
  retryWithoutSession: "agent:retry-without-session",
  retrySameSession: "agent:retry-same-session",
  activity: "agent:activity",
  activityList: "agent:activity-list",
  steer: "agent:steer",
  decideSteer: "agent:decide-steer",
  ackSteerIntents: "agent:ack-steer-intents",
  /** A hint that the person is about to send to this Provider: start its stopped bridge ahead of the send (TASK-11). */
  warmProvider: "agent:warm-provider",
} as const;

export const CHATS_CHANNEL = {
  list: "chats:list",
  runtimeContext: "chats:runtime-context",
  timelinePage: "chats:timeline-page",
  timelineAround: "chats:timeline-around",
  outlinePage: "chats:outline-page",
  findMessages: "chats:find-messages",
  forkPreflight: "chats:fork-preflight",
  fork: "chats:fork",
  commitManagedWorktree: "chats:commit-managed-worktree",
  rename: "chats:rename",
  setSortKey: "chats:set-sort-key",
  remove: "chats:remove",
  readAttachment: "chats:read-attachment",
  readAttachmentThumbnail: "chats:read-attachment-thumbnail",
  event: "chats:event",
} as const;

export const LIMITS_CHANNEL = {
  snapshot: "usage:limits:snapshot",
  demand: "usage:limits:demand",
  refresh: "usage:limits:refresh",
  revealRouteConfig: "usage:limits:reveal-route-config",
  changed: "usage:limits:changed",
} as const;
