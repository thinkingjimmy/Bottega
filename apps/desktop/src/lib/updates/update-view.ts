/**
 * [INPUT]: Depends on the shared UpdateSnapshot and typed failure-reason contracts
 * [OUTPUT]: Provides UpdateView, UpdateFailureView, describeUpdate and describeUpdateFailure with stage-specific recovery and separate diagnostics
 * [POS]: Pure Settings update presentation policy; confirmed versions remain usable after a failed refresh and raw errors never become visible copy
 */

import type { UpdateFailureReason, UpdateSnapshot } from "../../../shared/ipc/settings/update-ipc";

export type UpdateTone = "quiet" | "loud" | "danger";
export type UpdateGlyph = "spinner" | "check" | "download" | "alert";

type UpdateMessageKey =
  | "appHost.waitingDownload" | "appHost.checking" | "appHost.unavailable" | "appHost.installBusy"
  | "settings.presence.ready" | "settings.updates.unavailable" | "settings.updates.checking"
  | "settings.updates.available" | "settings.updates.downloading" | "settings.updates.installing"
  | "settings.updates.checkFailedShort" | "settings.updates.downloadFailedShort"
  | "settings.updates.validationFailed" | "settings.updates.current";
type UpdateActionKey = "settings.presence.restart" | "settings.updates.upgrade" | "settings.updates.manualUpgrade";

export type UpdateView = Readonly<{
  messageKey: UpdateMessageKey | null;
  messageVars: Readonly<Record<string, string>>;
  glyph: UpdateGlyph | null;
  tone: UpdateTone;
  percent: number | null;
  blocked: boolean;
  upgradeKey: UpdateActionKey | null;
  resolutionKey: "settings.updates.failedResolution" | null;
}>;

const REASONS = {
  offline: "settings.updates.offline",
  network: "settings.updates.connectionFailed",
  timeout: "settings.updates.requestTimedOut",
  service: "settings.updates.serviceUnavailable",
  "rate-limit": "settings.updates.rateLimited",
} as const satisfies Partial<Record<UpdateFailureReason, string>>;

export type UpdateFailureView = Readonly<{
  summaryKey: "settings.updates.checkFailedShort" | "settings.updates.downloadFailedShort";
  reasonKey: (typeof REASONS)[keyof typeof REASONS] | "settings.updates.checkFailedUnknown" | "settings.updates.downloadFailedUnknown" | "settings.updates.validationFailed";
  tone: "quiet" | "danger";
  retry: "check" | "download";
  diagnostic: string | null;
}>;

export function describeUpdateFailure(update: UpdateSnapshot): UpdateFailureView | null {
  const validation = update.error === "UPDATE_VALIDATION_FAILED";
  const failure = update.failure;
  if (!failure && !validation && update.phase !== "error" && !update.lastError) return null;
  if (["checking", "downloading", "ready", "installing"].includes(update.phase)) return null;
  const check = validation || failure?.stage === "check" || (!failure && update.phase !== "error");
  const reason = failure?.reason ?? "unknown";
  return Object.freeze({
    summaryKey: check ? "settings.updates.checkFailedShort" : "settings.updates.downloadFailedShort",
    reasonKey: validation ? "settings.updates.validationFailed" : reason === "unknown"
      ? check ? "settings.updates.checkFailedUnknown" : "settings.updates.downloadFailedUnknown" : REASONS[reason],
    tone: check ? "quiet" : "danger",
    retry: check ? "check" : "download",
    diagnostic: (check ? update.lastError ?? update.error : update.error) ?? null,
  });
}

const SILENT: UpdateView = Object.freeze({ messageKey: null, messageVars: Object.freeze({}), glyph: null,
  tone: "quiet", percent: null, blocked: false, upgradeKey: null, resolutionKey: null });

function speak(patch: Partial<UpdateView> & { messageKey: UpdateMessageKey; glyph: UpdateGlyph }): UpdateView {
  return Object.freeze({ ...SILENT, ...patch });
}

export function describeUpdate(update: UpdateSnapshot, checkedHere: boolean, bridgeReady: boolean): UpdateView {
  if (!bridgeReady) return speak({ messageKey: "settings.updates.unavailable", glyph: "alert", blocked: true });
  if (update.manualOnly) return Object.freeze({ ...SILENT, upgradeKey: "settings.updates.manualUpgrade" });
  const requirement = update.appRequirement;
  if (requirement && requirement.status !== "satisfied" && requirement.status !== "error") {
    const keys = { "waiting-download": "appHost.waitingDownload", checking: "appHost.checking", unavailable: "appHost.unavailable", "install-busy": "appHost.installBusy" } as const;
    const waiting = requirement.status === "waiting-download" || requirement.status === "checking";
    return speak({ messageKey: keys[requirement.status], glyph: waiting ? "spinner" : "alert", blocked: waiting,
      percent: requirement.status === "waiting-download" && update.progress ? Math.round(update.progress.percent) : null });
  }
  const failure = describeUpdateFailure(update);
  if (failure && update.phase !== "available") {
    return speak({ messageKey: update.error === "UPDATE_VALIDATION_FAILED" ? "settings.updates.validationFailed" : failure.summaryKey,
      glyph: "alert", tone: failure.tone, resolutionKey: failure.retry === "download" ? "settings.updates.failedResolution" : null });
  }
  const version = update.availableVersion ?? update.currentVersion;
  switch (update.phase) {
    case "checking": return speak({ messageKey: "settings.updates.checking", glyph: "spinner", blocked: true });
    case "available": return speak({ messageKey: "settings.updates.available", messageVars: { version }, glyph: "download", tone: "loud",
      upgradeKey: update.automaticInstall ? "settings.updates.upgrade" : "settings.updates.manualUpgrade" });
    case "downloading": return speak({ messageKey: "settings.updates.downloading", messageVars: { version }, glyph: "download", tone: "loud",
      percent: Math.round(update.progress?.percent ?? 0), blocked: true });
    case "ready": return speak({ messageKey: "settings.presence.ready", glyph: "download", tone: "loud", upgradeKey: "settings.presence.restart" });
    case "installing": return speak({ messageKey: "settings.updates.installing", glyph: "check", tone: "loud", blocked: true });
    case "not-available": return checkedHere ? speak({ messageKey: "settings.updates.current", glyph: "check" }) : SILENT;
    default: return SILENT;
  }
}
