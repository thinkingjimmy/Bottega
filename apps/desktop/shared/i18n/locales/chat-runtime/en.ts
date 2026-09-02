/**
 * [INPUT]: Depends on no runtime modules; defines the reference shape for Chat runtime copy
 * [OUTPUT]: Provides the English Chat runtime catalog
 * [POS]: Reference locale for attachment, queue, submission, settings, and recovery messages projected into the Chat UI
 */

export const chatRuntimeEn = {
  attachment: {
    takeoverFailed: "**Failed to attach to the running session:** {{message}}",
    chatLoadFailed: "**Failed to load chat:** {{message}}",
  },
  queue: {
    notPersisted: "The message was not saved. Fix it and try again.",
    recoverable: "The message can be recovered; resending creates a new submission identity.",
    retryAgentTurn: "The user message was saved. Use “Retry Agent turn”.",
    reconciling: "The submission is still being reconciled. A normal retry may run it twice.",
    failedResourcesReleased: "The submission failed and main released its retry resources. Edit and send it again.",
    failed: "The submission failed.",
    steerReturned: "Steering did not finish, so the message returned to the queue.",
    staleResourcesDecision: "The message contains resources from before restart. Choose exact resend or delete it.",
    staleWorkspaceWait: "The message contains Workspace resources from before restart. Wait for an exact outcome or delete it.",
    steerPrepareFailed: "Could not prepare the inserted message: {{message}}",
    steerVerifyFailed: "Could not verify whether the message was inserted: {{message}}",
    steerHistoryPending: "The message was inserted; its history record is still being saved.",
    steerQueuedNext: "The current turn did not consume the message, so it was queued next.",
    steerDeliveryUnknown: "Could not confirm delivery. Check the conversation, then resend or delete the message.",
    turnEnded: "The current turn ended, so this message will be sent through the normal queue.",
    viewChangedSteerCancelled: "The Chat view changed, so the previous view’s Steer message was not sent.",
    workspaceChangedNoResend: "The Workspace changed. This message cannot be resent in the new Workspace; delete it and enter it again.",
    durableOutcomeUnavailable: "The durable outcome is unavailable; reconciliation remains active.",
    mainCustodyPending: "The submission is still in main custody. Wait for a definite outcome.",
    noSafeNegativeProof: "Main did not provide safe proof that the submission never arrived, so it cannot be resent blindly.",
    ordinaryResendUnavailable: "This submission cannot be resent normally. Follow the durable outcome guidance.",
  },
  submission: {
    notSent: "**Message not sent:** {{message}}",
    stateUnknown: "**Message status unknown:** {{message}}. The original submission identity was preserved; choose resend or delete in the queue.",
    relayPaused: "Message queued: this Section relay chain is paused. Resolve the Continue notice at the top of the chat first.",
    relayPending: "Message queued: this Section has a pending relay message.",
    acceptedRefreshFailed: "The Agent accepted the message, but local session state could not refresh: {{message}}. Do not resend it; the task will continue.",
    backendSetupRequired: "**Finish setting up {{backend}} first.** The installation and sign-in guide is open.",
    localPreparationFailed: "Local session preparation failed: {{message}}",
  },
  settings: {
    readFailed: "Failed to load Agent settings: {{message}}",
    saveFailed: "Failed to save Agent settings: {{message}}",
    transcriptReadFailed: "**Failed to load Agent settings:** {{message}}",
  },
  relayStopFailed: "Failed to stop the entire Section relay chain; the current request was stopped instead: {{message}}. You can retry.",
  actionFailed: "**{{action}} failed:** {{message}}",
  abandonTurn: "Abandon turn",
  acknowledgeCleanup: "Confirm cleanup",
  unnamed: "Untitled",
};
