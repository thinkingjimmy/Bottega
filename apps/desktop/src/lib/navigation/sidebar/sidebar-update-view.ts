/**
 * [INPUT]: Depends on the shared UpdateSnapshot contract only.
 * [OUTPUT]: Provides SidebarUpdateTone, SidebarUpdateGlyph, SidebarUpdateIntent, SidebarUpdateView and describeSidebarUpdate.
 * [POS]: Pure Sidebar update policy; compact text and accessible labels share one phase and one action decision.
 */

import type { UpdateSnapshot } from "../../../../shared/ipc/settings/update-ipc";

export type SidebarUpdateTone = "loud" | "quiet" | "danger";
export type SidebarUpdateGlyph = "download" | "external" | "spinner" | "alert" | "restart";
export type SidebarUpdateIntent = "install" | "restart" | "releases" | "updates";

type SidebarUpdateLabelKey =
  | "appHost.waitingDownload" | "appHost.checking" | "appHost.unavailable" | "appHost.installBusy" | "appHost.retryError"
  | "settings.updates.restartUpdate" | "settings.updates.download" | "settings.updates.manualUpgrade"
  | "settings.updates.downloading" | "settings.updates.installing" | "settings.updates.failedShort"
  | "settings.updates.backgroundFailedOpen";

type SidebarUpdateTextKey = SidebarUpdateLabelKey
  | "settings.updates.newVersion" | "settings.updates.downloadingShort"
  | "settings.updates.installingShort" | "settings.updates.checkFailedShort" | "settings.updates.manualShort";

export type SidebarUpdateView = Readonly<{
  tone: SidebarUpdateTone;
  glyph: SidebarUpdateGlyph;
  labelKey: SidebarUpdateLabelKey;
  textKey: SidebarUpdateTextKey;
  labelVars: Readonly<Record<string, string | number>>;
  percent: number | null;
  // A null intent is status, not a disabled action.
  intent: SidebarUpdateIntent | null;
}>;

function show(patch: Pick<SidebarUpdateView, "glyph" | "labelKey" | "intent"> & Partial<SidebarUpdateView>): SidebarUpdateView {
  return Object.freeze({ tone: "loud", labelVars: {}, percent: null, ...patch, textKey: patch.textKey ?? patch.labelKey });
}

export function describeSidebarUpdate(update: UpdateSnapshot): SidebarUpdateView | null {
  const requirement = update.appRequirement;
  if (requirement && requirement.status !== "satisfied") {
    const keys = { "waiting-download": "appHost.waitingDownload", checking: "appHost.checking", unavailable: "appHost.unavailable", "install-busy": "appHost.installBusy", error: "appHost.retryError" } as const;
    return show({ glyph: ["waiting-download", "checking"].includes(requirement.status) ? "spinner" : "alert", labelKey: keys[requirement.status], intent: "updates", tone: "quiet" });
  }
  const version = update.availableVersion ?? update.currentVersion;
  switch (update.phase) {
    case "available":
      return update.automaticInstall
        ? show({ glyph: "download", labelKey: "settings.updates.download", textKey: "settings.updates.newVersion", intent: "install" })
        : show({ glyph: "external", labelKey: "settings.updates.manualUpgrade", textKey: "settings.updates.manualShort", intent: "releases" });
    case "downloading": {
      const percent = Math.round(update.progress?.percent ?? 0);
      return show({ tone: "quiet", glyph: "download", labelKey: "settings.updates.downloading", textKey: "settings.updates.downloadingShort", labelVars: { version, percent }, percent, intent: null });
    }
    case "ready":
      return show({ glyph: "restart", intent: "restart", labelKey: "settings.updates.restartUpdate" });
    case "installing":
      return show({ tone: "quiet", glyph: "spinner", labelKey: "settings.updates.installing", textKey: "settings.updates.installingShort", intent: null });
    case "error":
      return show({ tone: "danger", glyph: "alert", labelKey: "settings.updates.failedShort", labelVars: { version }, intent: "updates" });
    case "checking":
    case "not-available":
      return null;
    default:
      return update.lastError
        ? show({ tone: "quiet", glyph: "alert", labelKey: "settings.updates.backgroundFailedOpen", textKey: "settings.updates.checkFailedShort", intent: "updates" })
        : null;
  }
}
