/**
 * [INPUT]: Depends on React, the desktop i18n provider, Settings primitives, the shared confirmation dialog, the Dock settings store, and the Settings → Dock snapshot.
 * [OUTPUT]: Provides `DockUnsupported` and `DockMaster` for capability and activation status, Login Items approval, explicit continuation, and the legacy switch with setup and disable confirmation.
 * [POS]: settings/dock activation status reads the phase and background approval state from main.
 */

import { useState } from "react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { SettingsAlert, SettingsBadge, SettingsButton, SettingsList, SettingsRow, SettingsSection, SettingsSwitch } from "../settings-layout";
import { dockSettingsStore, type DockSettingsCommand } from "@/lib/platform/system-dock-settings-client";
import type { DockCapability, DockSettingsSnapshot } from "../../../../shared/system-dock/ipc";
import type { ReplacementPhase, SuspendReason } from "../../../../shared/system-dock/local-state";

/* Also the vocabulary main uses for native notices; one literal map keeps every reason readable in five languages. */
export const REASON_KEYS: Record<SuspendReason, string> = {
  "external-change": "systemDock.reason.external-change", managed: "systemDock.reason.managed", "journal-corrupt": "systemDock.reason.journal-corrupt",
  "agent-unhealthy": "systemDock.reason.agent-unhealthy", "renderer-failed": "systemDock.reason.renderer-failed", "entry-unreachable": "systemDock.reason.entry-unreachable",
  "empty-layout": "systemDock.reason.empty-layout", "registration-disabled": "systemDock.reason.registration-disabled", unsupported: "systemDock.reason.unsupported",
  "write-failed": "systemDock.reason.write-failed", "owned-elsewhere": "systemDock.reason.owned-elsewhere", "display-unavailable": "systemDock.reason.display-unavailable",
  "user-restored": "systemDock.reason.user-restored",
};
const PHASE_KEYS: Record<ReplacementPhase, string> = {
  active: "systemDock.settings.phaseActive", preparing: "systemDock.settings.phasePreparing", restoring: "systemDock.settings.phaseRestoring",
  suspended: "systemDock.settings.phasePaused", inactive: "systemDock.settings.phaseInactive",
};
const RECOVERY_KEYS: Record<Exclude<DockSettingsSnapshot["recovery"]["lastResult"], "none">, string> = {
  restored: "systemDock.settings.recoveryRestored", "kept-external": "systemDock.settings.recoveryKeptExternal", failed: "systemDock.settings.recoveryFailed",
};
const UNSUPPORTED_KEYS: Record<NonNullable<DockCapability["reason"]>, string> = {
  platform: "systemDock.settings.unsupportedPlatform", "os-version": "systemDock.settings.unsupportedVersion", architecture: "systemDock.settings.unsupportedArchitecture",
  development: "systemDock.settings.replacementDevelopment", "helper-missing": "systemDock.settings.unsupportedHelperMissing",
  checking: "systemDock.settings.replacementChecking", "signature-unverified": "systemDock.settings.replacementUnverified",
};

export function DockUnsupported({ capability }: { capability: DockCapability }) {
  const { t } = useAppTranslation();
  return <SettingsSection title={t("systemDock.settings.unsupportedTitle")}>
    <SettingsAlert tone="warn">{t(UNSUPPORTED_KEYS[capability.reason ?? "os-version"])} {t("systemDock.settings.unsupportedOther")}</SettingsAlert>
  </SettingsSection>;
}

/** A miniature, purely decorative Dock so a first-time reader sees what the switch adds before reading a word. */
function DockPreview() {
  return <div aria-hidden="true" className="flex h-32 items-end justify-center bg-muted/40 pb-4">
    <div className="flex items-center gap-1.5 rounded-2xl bg-background/90 px-2 py-1.5 shadow-[0_0_0_0.5px_rgb(0_0_0/0.12),0_6px_18px_rgb(0_0_0/0.08)] dark:shadow-[0_0_0_0.5px_rgb(255_255_255/0.14)]">
      {[0, 1, 2, 3].map((index) => <span key={index} className="size-8 rounded-lg bg-foreground/10" />)}
      <span className="mx-0.5 h-6 w-px bg-foreground/15" />
      {[87, 100].map((value) => <span key={value} className="flex size-8 items-center justify-center rounded-full font-semibold text-[9px] tabular-nums ring-2 ring-foreground/25 ring-inset">{value}</span>)}
      <span className="size-8 rounded-lg bg-sky-400/40" />
      <span className="size-8 rounded-lg bg-foreground/10" />
    </div>
  </div>;
}

export function DockMaster({ snapshot, pending, onTurnOn, showToggle = true }: {
  snapshot: DockSettingsSnapshot; pending: DockSettingsCommand | null; onTurnOn(): void; showToggle?: boolean;
}) {
  const { t } = useAppTranslation();
  const [confirmOff, setConfirmOff] = useState(false);
  const store = dockSettingsStore;
  const busy = pending !== null;
  const title = t("systemDock.settings.sectionTitle");
  if (!snapshot.state.enabled && !showToggle) return null;
  if (!snapshot.state.enabled) return <SettingsSection title={title}>
    <SettingsList>
      <DockPreview />
      <SettingsRow label={t("systemDock.settings.enabledLabel")} htmlFor="dock-enabled"
        badge={<SettingsBadge tone="muted">{t("systemDock.settings.phaseOff")}</SettingsBadge>}
        description={<>{t("systemDock.settings.preamble")} {t("systemDock.settings.offNote")}</>}
        control={<SettingsSwitch id="dock-enabled" label={t("systemDock.settings.enabledLabel")} describedBy="dock-enabled-description" checked={false}
          disabled={busy} onToggle={(next) => { if (next) onTurnOn(); }} />} />
    </SettingsList>
  </SettingsSection>;

  const replace = (snapshot.actualMode ?? snapshot.state.preferredMode) === "replace";
  const phase = snapshot.phase;
  const paused = phase === "suspended";
  const registration = snapshot.registration;
  const approvalRequired = replace && phase !== "active" && registration === "requires-approval";
  const why = approvalRequired ? t("systemDock.settings.registrationApproval")
    : replace && phase !== "active" && registration === "not-found" ? t("systemDock.settings.registrationMissing")
    : paused && snapshot.suspendReason ? t(REASON_KEYS[snapshot.suspendReason]) : null;
  const resumeDisabled = busy || snapshot.recovery.pending || replace && !snapshot.capability.replacement;
  const resumeLabel = t(snapshot.suspendReason === "registration-disabled" ? "systemDock.settings.continueEnabling" : "systemDock.settings.resume");
  const continueAction = approvalRequired
    ? <SettingsButton variant="outline" onClick={() => void store.openRecoverySettings()}>{t("systemDock.settings.openLoginItems")}</SettingsButton>
    : paused ? <SettingsButton disabled={resumeDisabled} onClick={() => void store.resume()}>{resumeLabel}</SettingsButton> : null;
  const inactiveAlert = replace && phase !== "active" && phase !== "preparing" && !paused ? t("systemDock.settings.notReplacingYet") : undefined;
  const recoveryPending = snapshot.recovery.pending ? t("systemDock.settings.recoveryPending") : null;
  if (!showToggle) {
    if (!paused && !approvalRequired) return inactiveAlert ? <SettingsAlert>{inactiveAlert}</SettingsAlert> : null;
    return <SettingsList>
      <SettingsRow label={t(PHASE_KEYS[phase])} description={approvalRequired ? why : recoveryPending ?? why} control={continueAction} />
    </SettingsList>;
  }

  const recovery = snapshot.recovery.lastResult;
  const notes = [why, recoveryPending, recovery !== "none" ? t(RECOVERY_KEYS[recovery]) : null]
    .filter((note): note is string => note !== null);
  return <SettingsSection title={title} alert={inactiveAlert}>
    <SettingsList>
      <SettingsRow label={t("systemDock.settings.enabledLabel")} htmlFor="dock-enabled"
        badge={<SettingsBadge tone={phase === "active" ? "neutral" : paused ? "warn" : "muted"}>
          {!replace && phase === "active" ? t("systemDock.settings.phaseCoexist") : t(PHASE_KEYS[phase])}</SettingsBadge>}
        description={notes.length ? <>{notes.map((note) => <span key={note} className="block" role="status">{note}</span>)}</> : t("systemDock.settings.preamble")}
        control={<span className="flex items-center gap-3">
          {continueAction}
          <SettingsSwitch id="dock-enabled" label={t("systemDock.settings.enabledLabel")} describedBy="dock-enabled-description" checked
            disabled={busy} onToggle={(next) => { if (!next) setConfirmOff(true); }} />
        </span>} />
    </SettingsList>
    <ConfirmationDialog open={confirmOff} onOpenChange={setConfirmOff} busy={pending === "disable"}
      title={t("systemDock.settings.turnOffTitle")} description={<>
        {t(replace ? "systemDock.settings.turnOffBodyReplace" : "systemDock.settings.turnOffBodyCoexist")}
        {store.getSnapshot().failed === "disable" && <span className="mt-2 block text-destructive" role="alert">{t("systemDock.settings.failedDisable")}</span>}
      </>}
      confirmLabel={t("systemDock.settings.turnOffAction")} confirmTone="destructive"
      onConfirm={() => void store.disable().then(result => { if (result) setConfirmOff(false); })} />
  </SettingsSection>;
}
