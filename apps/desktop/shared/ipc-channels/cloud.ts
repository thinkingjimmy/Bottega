/**
 * [INPUT]: Depends on nothing.
 * [OUTPUT]: Provides the cloud account, Chat, cloud App, Base sync, conversion and remote-control channel names.
 * [POS]: Zod-free IPC channel names (OPT-34): preload imports these so no schema module enters its bundle; the owning contract modules re-export them unchanged.
 */
export const CLOUD_CHANNEL = { getAccountState: "cloud:get-account-state", startLogin: "cloud:start-login", cancelLogin: "cloud:cancel-login",
  abandonLogin: "cloud:abandon-login",
  retryLoginSave: "cloud:retry-login-save", retryCredentialStorage: "cloud:retry-credential-storage", retryConnection: "cloud:retry-connection", settingsOpened: "cloud:settings-opened", networkChanged: "cloud:network-changed",
  inspectSavedLoginDiscard: "cloud:inspect-saved-login-discard", discardSavedLogin: "cloud:discard-saved-login",
  openCloudAccount: "cloud:open-cloud-account",
  reopenLogin: "cloud:reopen-login", signOut: "cloud:sign-out", listDevices: "cloud:list-devices", renameDevice: "cloud:rename-device",
  revokeDevice: "cloud:revoke-device", accountChanged: "cloud:account-changed",
  getComputers: "cloud:get-computers", computersChanged: "cloud:computers-changed", renameComputer: "cloud:rename-computer",
  inspectSync: "cloud:inspect-sync", cancelSyncReview: "cloud:cancel-sync-review", approveSync: "cloud:approve-sync",
  retrySync: "cloud:retry-sync", inspectCleanup: "cloud:inspect-cleanup", disableSync: "cloud:disable-sync",
  inspectAccountSwitch: "cloud:inspect-account-switch", switchAccount: "cloud:switch-account", openAccountDeletion: "cloud:open-account-deletion",
  setupEncryption: "cloud:setup-encryption", unlockEncryption: "cloud:unlock-encryption",
  retryEncryption: "cloud:retry-encryption", cancelEncryption: "cloud:cancel-encryption" } as const;

export const CHAT_CHANNEL = { catalog: "cloud-chat:catalog", head: "cloud-chat:head", transcript: "cloud-chat:transcript", query: "cloud-chat:query",
  facts: "cloud-chat:facts", editFacts: "cloud-chat:edit-facts", resolveFacts: "cloud-chat:resolve-facts",
  deletion: "cloud-chat:deletion", requestDeletion: "cloud-chat:request-deletion", keepDeletion: "cloud-chat:keep-deletion",
  watch: "cloud-chat:watch", unwatch: "cloud-chat:unwatch", changed: "cloud-chat:changed", openFile: "cloud-chat:open-file",
  readFile: "cloud-chat:read-file", closeFile: "cloud-chat:close-file", execution: "cloud-chat:execution", prepare: "cloud-chat:prepare", retryHome: "cloud-chat:retry-home", skipHome: "cloud-chat:skip-home",
  draft: "cloud-chat:draft", saveDraft: "cloud-chat:save-draft", bindProject: "cloud-chat:bind-project",
  retainedCatalog: "cloud-chat:retained-catalog", retainedMetadata: "cloud-chat:retained-metadata",
  projectDeletionCatalog: "cloud-chat:project-deletion-catalog", reviewProjectDeletion: "cloud-chat:project-deletion-review", resolveProjectDeletion: "cloud-chat:project-deletion-resolve", retryProjectDeletion: "cloud-chat:project-deletion-retry",
  recoveryPage: "cloud-chat:recovery-page", recoveryFile: "cloud-chat:recovery-file" } as const;

export const CLOUD_APPS_CHANNEL = { catalog: "cloud-apps:catalog", origin: "cloud-apps:origin", review: "cloud-apps:review", confirm: "cloud-apps:confirm",
  discard: "cloud-apps:discard", retry: "cloud-apps:retry", cancel: "cloud-apps:cancel", changed: "cloud-apps:changed",
  removeLocal: "cloud-apps:remove-local", retryRemoval: "cloud-apps:retry-removal", openRetained: "cloud-apps:open-retained",
  reviewDeletion: "cloud-apps:review-deletion", confirmDeletion: "cloud-apps:confirm-deletion", retryDeletion: "cloud-apps:retry-deletion",
  discardDeletion: "cloud-apps:discard-deletion", dismissDeletion: "cloud-apps:dismiss-deletion" } as const;

export const BASE_SYNC_CHANNEL = { review: "cloud-base:review", detail: "cloud-base:detail", decide: "cloud-base:decide", copy: "cloud-base:copy", changed: "cloud-base:changed" } as const;

export const CONVERSION_CHANNEL = { review: "cloud-conversion:review", keepOriginal: "cloud-conversion:keep-original",
  projectReview: "cloud-conversion:project-review", keepProjectOriginal: "cloud-conversion:keep-project-original",
  rescueReview: "cloud-conversion:rescue-review", keepRescueOriginal: "cloud-conversion:keep-rescue-original" } as const;

export const REMOTE_CHANNEL = { projectFiles: "cloud-remote:project-files", queue: "cloud-remote:queue", reorderQueue: "cloud-remote:reorder-queue", withdraw: "cloud-remote:withdraw", prepareCommand: "cloud-remote:prepare-command", prepareCreate: "cloud-remote:prepare-create", targets: "cloud-remote:targets", submit: "cloud-remote:submit", command: "cloud-remote:command",
  commands: "cloud-remote:commands", receipts: "cloud-remote:receipts", create: "cloud-remote:create", created: "cloud-remote:created",
  retryPreparation: "cloud-remote:retry-preparation", watch: "cloud-remote:watch", unwatch: "cloud-remote:unwatch", changed: "cloud-remote:changed",
  stageAttachment: "cloud-remote:stage-attachment", cancelAttachment: "cloud-remote:cancel-attachment", attachmentProgress: "cloud-remote:attachment-progress" } as const;
