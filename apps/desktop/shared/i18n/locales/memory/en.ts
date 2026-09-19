/**
 * [INPUT]: No runtime dependencies
 * [OUTPUT]: Provides memoryEn — Memory product copy for runtime repair, version/history recovery, background operations, data-location failures, and busy-state guidance; no Project workspace chooser UI remains — and the structural shape its translated leaves derive from
 * [POS]: English leaf of shared/i18n/locales/memory; renderer and main-process surfaces consume these keys as the single copy authority
 */

export const memoryEn = {
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
  provider: {
    openviking: {
      summary: "Cleanup is workspace-scoped — deleting one scope leaves the rest.",
      panel: { title: "OpenViking extraction model", description: "The key, Base URL, and model stay in local secrets and a managed 0600 ov.conf. Manual takeover means editing that file directly." },
      field: {
        OPENVIKING_LLM_API_KEY: { label: "Extraction API key", description: "Required to extract long-term memory from conversations." },
        OPENVIKING_LLM_BASE_URL: { label: "Base URL", description: "OpenAI-compatible endpoint, such as https://api.deepseek.com/v1." },
        OPENVIKING_LLM_MODEL: { label: "Model", description: "Extraction model name, such as deepseek-chat." },
      },
    },
    everos: {
      summary: "Cleanup resets the whole runtime — every scope goes at once.",
      panel: { title: "EverOS extraction credentials", description: "EverOS needs a model-service key to start. Credentials stay in local secrets and LaunchAgent; CLI credentials are never read." },
      field: {
        EVEROS_LLM__API_KEY: { label: "Extraction API key", description: "OpenAI-compatible model-service key used for memory extraction." },
        EVEROS_LLM__BASE_URL: { label: "Base URL", description: "OpenAI-compatible endpoint, such as https://api.deepseek.com/v1." },
        EVEROS_LLM__MODEL: { label: "Model", description: "Extraction model name, such as deepseek-chat." },
      },
    },
  },
  backend: {
    homepage: "Project homepage", notReady: "The service is not ready yet. Repair or re-check the install below first.",
    installed: "Installed", installedNeedsConfig: "Installed · configuration required", installedNeedsConfigVersion: "Installed {{version}} · configuration required", notInstalled: "Not installed", dataLocation: "Reveal data location", dataLocationFailed: "The data location is not available yet. Repair or reinstall first.", interrupted: "Interrupted install", identityRepair: "Repair install identity",
  },
  health: {
    offLabel: "Off", offDetail: "Enable memory before connecting for recall and delivery.", unknownLabel: "Not checked", unknownDetail: "Refresh to handshake with the local service.",
    checkingLabel: "Checking", checkingDetail: "Connecting to the local service and validating its handshake.", readyLabel: "Service ready", readyDetail: "Recall and delivery are ready.",
    compatLabel: "Compatibility mode", compatDetail: "The service version differs from the locked version; functionality remains available.", compatVersionDetail: "Service {{version}} differs from the locked version. It remains usable; reinstall the locked version if recall or extraction behaves unexpectedly.",
    unavailableLabel: "Service unavailable", unavailableDetail: "Handshake failed; refresh to retry.", blockedLabel: "Cannot enable yet",
    blocked: { ownership: "Managed data ownership verification failed; memory is disabled to avoid writing to an unknown root. Repair the install below to recover.", configuration: "Configuration is incomplete; submit the extraction key first.", "not-installed": "This managed service is not installed yet. Install it below; once it is ready, memory can be turned on." },
    issue: {
      unreachable: { label: "Cannot reach local service", detail: "The service may not be running. Use Repair install below. Memory is paused; chat is unaffected." },
      unhealthy: { label: "Service is not ready", detail: "The service answered but is still starting. Retry shortly. Memory is paused; chat is unaffected." },
      auth: { label: "Service authentication is enabled", detail: "The product does not read CLI credentials. Restart the loopback service in dev mode. Current authentication mode: {{detail}}. Memory is paused; chat is unaffected." },
      protocol: { label: "Unexpected service at this address", detail: "The address returned an unrecognized protocol. Memory is paused; chat is unaffected." },
      identity: { label: "Port is owned by an unmanaged process", detail: "Delivery is stopped to avoid sending conversations to an unknown process. Repair the install or free the port; chat is unaffected." },
      configuration: { label: "Configuration incomplete", detail: "Submit the extraction key below. Memory is paused; chat is unaffected." },
      version: { label: "Service unavailable", detail: "Detected version {{detail}} failed the handshake. Memory is paused; chat is unaffected." },
    },
  },
  activity: { aria: "Memory activity", empty: "No recall or delivery activity yet—each recall and delivery batch will appear here.", lastCapture: "Latest delivery · after canonical persistence", lastRecall: "Latest recall", recallUsed: "Memory sent", recallNone: "No relevant memory", recallFailed: "Recall unavailable", recallFailedCount: "{{count}} failed", recallUsedTurns: "Turns with memory sent", recallZeroTurns: "Turns with no match", rebuilt: "Last rebuild · completed", delivered: "Turns delivered in current scope", pending: "Pending in current scope", inflight: "Batches in flight", gap: "Gap turns · authorized but undelivered" },
  attention: {
    kind: { "capture-gap": "Extraction delivery gap", "cleanup-failed": "Remote cleanup failed", "rebuild-failed": "Rebuild interrupted", "capacity-pressure": "Memory ledger needs compaction" },
    action: { acknowledge: "Acknowledge", "retry-cleanup": "Retry cleanup", compact: "Compact now", abandon: "Abandon and record", "resume-rebuild": "Resume rebuild" },
  },
  rebuild: {
    button: "Rebuild memory", title: "Rebuild memory?", confirm: "Start rebuild", unavailable: "Long-term memory is unavailable during rebuild; the current Chat keeps working.",
    progress: "Cleaned {{purged}}/{{totalScopes}} remote sessions · backfilled {{backfilledTurns}}/{{totalTurns}} turns", intentStable: "Completion or failure will not change your enabled or paused setting.",
    description: "This clears all product-written memory in the current {{provider}} data instance, then re-extracts surviving authorized content—not only the current Chat.",
    scope: "Estimated scope: {{chats}} Chats, {{turns}} turns; destination {{hostname}}/{{model}}. This can take time and consume third-party quota or incur charges.",
    pauseIntent: "Memory is unavailable during rebuild; Chat is unaffected. Completion preserves the {{intent}} setting, including later changes.", trimmed: "Trimmed history cannot be restored and will be recorded as a gap.", resetManualConfig: "A runtime reset removes manually managed configuration and returns it to product management.",
    phase: { prepared: "Preparing", quiescing: "Quiescing active requests", reconciling: "Reconciling in-flight commits", purging: "Cleaning remote data", "watermarks-cleared": "Resetting watermarks", backfilling: "Backfilling history", completed: "Completed", failed: "Interrupted" },
  },
  disclosure: {
    enableTitle: "Enable long-term memory?", switchTitle: "Switch long-term memory service?", processing: "Only human message text and successful replies are sent for extraction. Tools, Apps, Skills, and product context are not, and your Agent handles messages exactly as before.",
    destination: "Extraction destination", readingDestination: "Reading destination…", thirdParty: "Memory inventory stays local. The third party may log requests, consume quota, or charge fees.",
    includeHistory: "Start now and import selected history", scopeHistory: "{{chats}} Chats, {{turns}} selected turns", scopeNew: "Only new human conversations after confirmation", scopePrefix: "Scope: {{scope}}", historyRange: "{{from}} – {{to}}", gaps: "{{count}} Chats contain trimmed, unrecoverable gaps.",
    pauseBoundary: "You can pause anytime, but requests already entering the send phase cannot be withdrawn, and sending does not mean the model used them.", atLeastOnce: "Delivery is at-least-once: crash recovery can duplicate a turn when the service lacks idempotency keys.", switchBack: "Switching back later requires cleanup or a rebuild first; old data is never silently reused.", confirmSwitch: "Confirm and switch", confirmEnable: "Confirm and enable",
  },
  sharing: {
    title: "Sharing scope", description: "Choose where new memories can be recalled. Changing scope never reuses old scope data automatically.", disabledMemory: "Enable long-term memory before changing its sharing scope.", disabledTarget: "The current memory target is unavailable.", previewFailed: "Failed to preview the Memory sharing change",
    dialogTitle: "Change memory sharing scope?", oldScopeRetained: "Old-scope data is retained but stops being recalled. It is never merged automatically.", historyPaused: "Resume memory before importing history; scope-only changes remain available while paused.", confirm: "Confirm scope change", readingScope: "Reading the target scope…",
    mode: { chat: "This Chat only", group: "Project / standalone pool", personal: "Personal memory pool" },
    isolation: { chat: "Only this Chat incarnation can recall the new memory.", group: "Chats in one Project can recall each other; all standalone Chats share one separate pool.", personal: "All Project and standalone Chats can recall from one personal pool." },
  },
  supply: { title: "Memory supply", summary: "{{streams}} sources · {{delivered}} delivered", disabled: "Enable memory and finish initializing its owners to inspect supply.", loadFailed: "Memory sources could not be loaded. Collapse and reopen to retry.", foreign: "Imported history", untitled: "Untitled Chat", archived: "Archived", deleted: "Deleted", counts: "{{delivered}} delivered · {{pending}} pending · {{gap}} gap", empty: "No conversation has supplied this scope yet." },
  version: { historyTitle: "Recently installed", loading: "Loading releases…", confirmTitle: "Switch {{provider}} to {{version}}?", listStale: "The runtime changed while the list was loading, so it is out of date. Try again.", description: "The selected release is installed exactly and becomes the new last-known-good only after readiness succeeds.", current: "Current", locked: "Recommended", latest: "Latest", yanked: "Yanked", selected: "Custom version", currentYanked: "The installed release is now yanked; keep it or switch deliberately.", downgradeWarning: "This is a downgrade. Existing data remains, but runtime compatibility can change.", unverifiedWarning: "This release has not been validated by the product. It reuses the locked release's model specification and existing files; if upstream changes the model filename, OpenViking may download it itself on first launch without app progress.", catalogStaleWarning: "Version metadata could not be refreshed. This cached list may be stale.", catalogValidationWarning: "PyPI's advertised version differs from its installable release list. The installable list is used.", listFailed: "The version list could not be loaded. Try again.", switchFailed: "The version could not be switched. Review the runtime error and try again.", runningInBackground: "The switch continues in the background. You can close this dialog and follow progress on the Memory page.", confirm: "Switch version", action: "Choose version", available: "Update to {{version}}", check: "Check for updates" },
  runtime: {
    installHeading: "Install local memory service", installPackage: "Install {{provider}} {{version}} in an isolated, version-locked Python environment; source and verification are shown in the log.", installAutostart: "Register login startup at {{url}} and restart automatically after crashes.", installStorage: "Memory inventory stays local; extraction may use your configured model service. Runtime and data directories are separate.", installAction: "Install", managedNeedsConfig: "{{provider}} {{version}} is installed and waiting for extraction credentials; submission registers login startup and starts it.", repairAction: "Repair install", repairTitle: "Repair the {{provider}} installation?", repairDescription: "This briefly stops the service and reinstalls the current managed runtime. Memory data, extraction configuration, and install identity are preserved; the service restarts afterward.",
    running: "Working…", openRunning: "Open Memory operation status", retryInstall: "Retry install", unsupported: "One-click installation is not supported on this platform.", versionMismatch: "Installed {{installed}}; this app locks {{locked}}. It remains usable, but upgrading is recommended.", stepFailed: "{{step}} failed: ",
    /* 运行时步骤：main 只发身份（kind + 可选 context/version），文案在此
       落地。`<kind>_<context>` 是 i18next 的变体，缺席自动回落到 `<kind>`。 */
    step: {
      "refresh-version-catalog": "Refreshing the trusted version list", "remove-plist": "Removing login startup", "remove-venv": "Removing the candidate environment", "prepare-toolchain": "Preparing the pinned uv toolchain", "ensure-venv": "Creating the Python {{version}} environment", "fetch-artifacts": "Downloading and verifying packages",
      "install-packages": "Installing the locked version {{version}} (may take several minutes)", "install-packages_selected": "Installing your chosen version {{version}} (may take several minutes)",
      "register-manifest": "Recording the managed install", initialize: "Initializing the data root", "model-assets": "Downloading the embedding model", "config-converge": "Applying managed configuration", "install-plist": "Registering login startup",
      bootstrap: "Starting the service", bootstrap_deferred: "Startup waits for configuration", "await-ready": "Waiting for the service to be ready", "await-ready_deferred": "Readiness check waits for configuration",
      "config-write": "Writing runtime configuration", "config-regenerate": "Regenerating runtime configuration", "config-adopt-manual": "Adopting the manual configuration", bootout: "Stopping the service", "wipe-data": "Clearing runtime data", "remove-root": "Deleting the runtime and its data",
    },
    configModified: "{{file}} was modified manually", configModifiedDetail: "Regenerate to restore product management, or adopt manual mode and edit keys/models in the file.", regenerate: "Regenerate", adoptManual: "Adopt manual", manualDetail: "Configuration is manually managed; the product will not rewrite this file.",
    steps: "Step {{current}}/{{total}}", preparing: "Preparing", upgradeTo: "Upgrade to {{version}}", recheck: "Check again", downloadHint: "Dependencies must be downloaded and may take several minutes", errorLog: "Error log", hideLog: "Hide log", showLog: "View log", configureAction: "Configure extraction model", configDialogTitle: "Configure {{provider}}", retainBlank: "Leave blank to retain the current value", draftRetained: "Closing this dialog or a failed restart keeps this draft in memory. It is cleared only after a successful apply.", submitRestart: "Submit and restart service", savingConfig: "Saving…", configSaveFailed: "Failed to save the extraction model configuration",
    uninstallTitle: "Uninstall {{provider}} managed runtime?", uninstallDescription: "This stops the service, removes login startup, and permanently deletes its managed runtime directory, including all long-term memory data. If active, memory is disabled.", uninstallRetention: "Consent records and chats remain. Reinstall and rebuild to re-extract authorized history within the local retention window.", uninstallConfirm: "Uninstall and delete data", modelTransferAria: "Model download progress", modelTransfer: "{{received}} / {{total}} MiB", modelRecovered: "Model verification failed; downloading a verified copy again.", interruptedInstall: "The install was interrupted before ownership was committed. Retry to replace the partial runtime safely.", versionIntentRecoveryRequired: "The switch to {{version}} was interrupted before a candidate was proven. Repair restores the last-known-good runtime.", versionCandidateAwaitingReadiness: "{{version}} is installed but not yet proven ready. Submit the required configuration to verify and promote it.", identityRepair: "Managed files exist but their install manifest is missing. Repair reconstructs identity from the ownership marker.", identityMissing: "This directory has no product ownership marker and will not be adopted automatically.",
  },
  /* ── 引擎区：安装、升级、配置都归它，选哪个在用也归它 ──────────
     开关只说记不记（page.title/description），引擎只说存哪儿与怎么管。
     同一批引擎从前在「服务」与「框架」两处各列一遍，现在只有这一处。 */
  engines: {
    title: "Memory engines", aria: "Memory engines",
    description: "Choose the engine that holds memory, and manage it here. One is active at a time — switching needs cleanup or a rebuild first; installing another costs nothing.",
    manage: "Manage {{provider}}", collapse: "Collapse {{provider}}",
    versionRow: "Version", modelRow: "Extraction model", runtimeRow: "Runtime",
    inUse: "In use", updateAvailable: "Update available",
    modelConfigured: "The key and model stay on this Mac.", modelUnset: "Not configured yet — submit the extraction key to start the service.",
    runtimeManaged: "Managed install · {{url}}", runtimeAutostart: "Login startup · restarts automatically after crashes.",
    installAction: "Install {{provider}}",
  },
  /* ── 安装优先的初次设置：装好并配好之前，这一页只有这三步 ────────
     从前空装机进来看到的是一个点不动的开关加一句「暂不可启用」——
     那是把「还没设置」画成了「坏了」。 */
  setup: {
    title: "Set up long-term memory",
    description: "Long-term memory runs a small local service on this Mac. Choose an engine to install — it downloads into an isolated, version-locked Python environment, and nothing leaves your machine except extraction sent to the model service you connect in the last step.",
    stepChoose: "Choose engine", stepInstall: "Install", stepConnect: "Connect model",
    recommended: "Recommended",
    privacy: "The memory inventory stays on this Mac. Runtime and data directories are kept separate; you can remove either at any time.",
    installingTitle: "Installing {{provider}} into an isolated, version-locked environment. This runs once — the service then starts on login and restarts automatically after crashes.",
    leaveSafe: "It is safe to leave this page — installation continues in the background.",
    connectDescription: "Connect an OpenAI-compatible model to extract long-term memories from your conversations. Submitting registers login startup and starts the service.",
    connectSubmit: "Submit and start service", draftKept: "Closing keeps this draft until it applies successfully.",
    changeLater: "You can change the model or key later from Settings.",
  },
  page: {
    providerMissing: "Configured memory provider “{{provider}}” is not registered.", refreshHealth: "Refresh Memory health", title: "Long-term memory", description: "Only human turns are processed, and the memory inventory stays on this Mac. Turning this off pauses recall and recording — Chat, Tools, Apps, and Skills keep working normally.", stateOn: "On", stateUnavailable: "Paused · service unavailable", statePaused: "Paused",
    applyFailedTitle: "Configuration saved but not active in the runtime", applyFailedFallback: "Apply failed", applyRetrying: "Retrying in the background; this warning disappears after convergence.", resume: "Resume long-term memory", pause: "Pause long-term memory", enable: "Enable long-term memory", observability: "Activity", observabilityDescription: "No-match and recall failures stay distinct; delivery is durable and Chat always fails open.", observabilityEpoch: "Memory since {{date}} · scope generation {{generation}}", recallWarningTitle: "Recall metrics are temporarily unavailable", pausedBanner: "Long-term memory is paused. Chat, Tools, Apps, and Skills continue normally.", attentionTitle: "Needs attention", attentionDescription: "Every item has an explicit recovery action; the system will not guess what happened remotely.", resumeFailed: "Failed to resume Memory", pauseFailed: "Failed to pause Memory", consentFailed: "Failed to apply Memory consent",
    configTitle: "Change Memory extraction destination?", configChange: "Extraction changes from {{currentHostname}}/{{currentModel}} to {{nextHostname}}/{{nextModel}}.", configDisclosure: "Newly authorized messages go to this destination. Third-party services may charge fees; existing history authorization does not expand automatically.", configConfirm: "Confirm and apply",
    pauseTitle: "Pause long-term memory?", pauseDescription: "New recall and delivery stop after confirmation. Chat, Tools, Apps, and Skills continue. Requests already sent or entering the send phase cannot be withdrawn.", pauseConfirm: "Pause memory",
  },
  receipt: {
    used: "Long-term memory · sent {{count}} items with the request", usedDetail: "Sending does not mean the model used them", none: "Long-term memory · no relevant content found", unavailable: "Long-term memory unavailable · not used for this turn", planMode: "Long-term memory · not used in Plan mode", promptNotIssued: "Long-term memory · Agent request was not sent",
    failure: { initialization: "Memory owners failed to initialize", "scope-resolution": "Memory scope could not be resolved", "policy-store": "Memory policy ledger is unavailable", "runtime-configuration": "Memory runtime configuration is unavailable", identity: "Memory service identity verification failed", provider: "Memory provider failed", ownership: "Memory ownership verification failed", deadline: "Memory recall exceeded its deadline", "render-budget": "Memory context exceeded the render budget", "stale-capability": "Memory capability became stale" },
  },
};
