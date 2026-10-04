/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Includes Memory access selection, explicit workflow-read consent, plugin chrome and native-memory distinction; Provides memoryEn — Memory product copy for runtime repair, version/history recovery, background operations, data-location failures, and busy-state guidance, the phone status switch (TASK-28); no Project workspace chooser UI remains — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/memory; renderer and main-process surfaces consume these keys as the single copy authority
 */

export const memoryEn = {
  plugin: { open: "Open Memory plugin", name: "Memory", official: "Official · Built in", about: "About Memory", unsupported: "Memory is not supported on this platform. It is currently available on macOS only.", nativeDistinction: "Bottega Memory is separate from the native memory managed in the Codex and Claude plugin settings." },
  access: {"none": "None", "readOnly": "Read only", "description": "Read only recalls relevant memory for this role. Workflow roles never write to Memory.", "workflowOff": "Workflow read access is off in the Memory plugin.", "workflowOn": "Workflow read access is allowed on this computer."},
  workflow: {"sectionTitle": "Access and controls", "label": "Allow workflow roles to read Memory", "description": "Only workflow roles whose configuration selects Read only can recall memory. Workflow roles never write to Memory.", "consentTitle": "Allow workflow roles to read Memory?", "consentBody": "Configured planning, development and review roles can recall memory using the task name and acceptance criteria, within the current Chat or Project scope. Workflow roles never write memory. Pausing Memory or turning off this permission stops recall at the next step.", "confirm": "Allow read only", "requiresActive": "Enable Memory and finish consent before allowing workflow reads. Resume Memory if it is paused.", "personal": "Workflow reads are unavailable in the personal memory pool. Choose Chat or Project scope.", "saveFailed": "Could not save workflow read access. Try again."},
  store: {
    providerListFailed: "Failed to load Memory providers",
    statusFailed: "Failed to read Memory status",
    healthFailed: "Failed to check Memory health",
    historyPreviewFailed: "Failed to preview Memory history",
    attentionFailed: "Failed to resolve the pending Memory item",
    runtimeStatusFailed: "Failed to read Memory runtime status",
    configIssueFailed: "Failed to resolve the Memory configuration issue",
    manualConfigPreviewFailed: "Failed to preview the manually configured destination",
    runtimeOperationFailed: "Memory runtime operation failed",
    updateCheckFailed: "Failed to check for Memory updates",
    configPreviewFailed: "Failed to preview the Memory destination",
    configAuthorityFailed: "Failed to authorize the Memory destination",
    manualConfigAuthorityFailed: "Failed to authorize the manually configured destination",
    configSubmitFailed: "Failed to submit the Memory runtime configuration",
    destructiveAuthorityFailed: "Failed to authorize the destructive Memory operation",
    destructiveFailed: "The destructive Memory operation failed",
  },
  common: { unread: "Not read yet", paused: "paused", enabled: "enabled" },
  time: { none: "None yet", now: "just now" },
  sharing: {
    title: "Sharing scope", description: "Choose where new memories can be recalled. Changing scope never reuses old scope data automatically.", disabledMemory: "Enable long-term memory before changing its sharing scope.", disabledTarget: "The current memory target is unavailable.", previewFailed: "Failed to preview the Memory sharing change",
    dialogTitle: "Change memory sharing scope?", oldScopeRetained: "Old-scope data is retained but stops being recalled. It is never merged automatically.", historyPaused: "Resume memory before importing history; scope-only changes remain available while paused.", confirm: "Confirm scope change", readingScope: "Reading the target scope…",
    mode: { chat: "This Chat only", group: "Project / standalone pool", personal: "Personal memory pool" },
    isolation: { chat: "Only this Chat incarnation can recall the new memory.", group: "Chats in one Project can recall each other; all standalone Chats share one separate pool.", personal: "All Project and standalone Chats can recall from one personal pool." },
  },
  runtime: { running: "Working…", openRunning: "Open Memory operation status" },
  page: { pausedBanner: "Long-term memory is paused. Chat, Tools, Apps, and Skills continue normally." },
  receipt: {
    used: "Long-term memory · sent {{count}} items with the request", usedDetail: "Sending does not mean the model used them", none: "Long-term memory · no relevant content found", unavailable: "Long-term memory unavailable · not used for this turn", planMode: "Long-term memory · not used in Plan mode", promptNotIssued: "Long-term memory · Agent request was not sent",
    failure: { initialization: "Memory owners failed to initialize", "scope-resolution": "Memory scope could not be resolved", "policy-store": "Memory policy ledger is unavailable", "runtime-configuration": "Memory runtime configuration is unavailable", identity: "Memory service identity verification failed", provider: "Memory provider failed", ownership: "Memory ownership verification failed", deadline: "Memory recall exceeded its deadline", "render-budget": "Memory context exceeded the render budget", "stale-capability": "Memory capability became stale" },
  },
};
