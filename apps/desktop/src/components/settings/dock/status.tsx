/**
 * [INPUT]: Depends on React, the desktop i18n provider, Settings primitives, the shared Select and confirmation dialog, the Dock settings store, and the Settings → Dock snapshot.
 * [OUTPUT]: Provides `DockUnsupported` (why this Mac cannot run the Dock), `DockMaster` (the one on/off switch with the phase badge, pause reason and recovery results, the mode select, Restore/Resume; turning on asks for setup, turning off asks for confirmation) and `DockRecovery` (the recovery background item's registration with the Login Items path).
 * [POS]: settings/dock status and recovery surface (3.1, INV-02~05); it only states what main reports — a replace-mode Dock that is not active is never shown as working.
 */

import { useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ai-chat/ui/components/ui/select";
import { SettingsAlert, SettingsBadge, SettingsButton, SettingsList, SettingsRow, SettingsSection, SettingsSwitch } from "../settings-layout";
import { dockSettingsStore, type DockSettingsCommand } from "@/lib/system-dock-settings-client";
import type { DockCapability, DockSettingsSnapshot } from "../../../../shared/system-dock/ipc";
import type { DockMode, ReplacementPhase, SuspendReason } from "../../../../shared/system-dock/local-state";

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
  development: "systemDock.settings.replacementDevelopment", "helper-missing": "systemDock.settings.replacementHelperMissing",
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

export function DockMaster({ snapshot, pending, onTurnOn, onSwitchToReplace }: {
  snapshot: DockSettingsSnapshot; pending: DockSettingsCommand | null; onTurnOn(): void; onSwitchToReplace(): void;
}) {
  const { t } = useAppTranslation();
  const [confirmOff, setConfirmOff] = useState(false);
  const store = dockSettingsStore;
  const busy = pending !== null;
  const title = t("systemDock.settings.sectionTitle");
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

  const mode: DockMode = snapshot.actualMode ?? snapshot.state.preferredMode;
  const replace = mode === "replace";
  const phase = replace ? snapshot.phase : "active";
  const paused = snapshot.phase === "suspended";
  const registration = snapshot.registration;
  const why = paused && snapshot.suspendReason ? t(REASON_KEYS[snapshot.suspendReason])
    : replace && phase !== "active" && registration === "requires-approval" ? t("systemDock.settings.registrationApproval")
      : replace && phase !== "active" && registration === "not-found" ? t("systemDock.settings.registrationMissing") : null;
  const recovery = snapshot.recovery.lastResult;
  const notes = [why, snapshot.recovery.pending ? t("systemDock.settings.recoveryPending") : null, recovery !== "none" ? t(RECOVERY_KEYS[recovery]) : null]
    .filter((note): note is string => note !== null);
  const pickMode = (next: string) => {
    if (next === mode) return;
    if (next === "replace") onSwitchToReplace(); else void store.setMode("coexist");
  };
  return <SettingsSection title={title}
    alert={replace && phase !== "active" && phase !== "preparing" && !paused ? t("systemDock.settings.notReplacingYet") : undefined}>
    <SettingsList>
      <SettingsRow label={t("systemDock.settings.enabledLabel")} htmlFor="dock-enabled"
        badge={<SettingsBadge tone={phase === "active" ? "neutral" : paused ? "warn" : "muted"}>
          {replace ? t(PHASE_KEYS[phase]) : t("systemDock.settings.phaseCoexist")}</SettingsBadge>}
        description={notes.length ? <>{notes.map((note) => <span key={note} className="block" role="status">{note}</span>)}</> : t("systemDock.settings.preamble")}
        control={<span className="flex items-center gap-3">
          {paused && <SettingsButton disabled={busy} onClick={() => void store.resume()}>{t("systemDock.settings.resume")}</SettingsButton>}
          <SettingsSwitch id="dock-enabled" label={t("systemDock.settings.enabledLabel")} describedBy="dock-enabled-description" checked
            disabled={busy} onToggle={(next) => { if (!next) setConfirmOff(true); }} />
        </span>} />
      <SettingsRow label={t("systemDock.settings.modeLabel")} htmlFor="dock-mode"
        description={t(replace ? "systemDock.settings.modeReplaceDescription" : snapshot.capability.replacement ? "systemDock.settings.modeCoexistDescription" : "systemDock.settings.modeCoexistOnly")}
        control={<Select value={mode} disabled={busy || !snapshot.capability.replacement} onValueChange={pickMode}>
          <SelectTrigger id="dock-mode" size="lg" aria-describedby="dock-mode-description"><SelectValue /></SelectTrigger>
          <SelectContent align="end" className="text-sm">
            <SelectItem value="replace">{t("systemDock.settings.modeReplace")}</SelectItem>
            <SelectItem value="coexist">{t("systemDock.settings.modeCoexist")}</SelectItem>
          </SelectContent>
        </Select>} />
      {replace && (phase === "active" || phase === "preparing") && <SettingsRow label={t("systemDock.settings.restore")}
        description={t("systemDock.settings.restoreDescription")}
        control={<SettingsButton variant="outline" disabled={busy || snapshot.recovery.pending} onClick={() => void store.restoreSystemDock()}>
          {t("systemDock.settings.restore")}</SettingsButton>} />}
    </SettingsList>
    <ConfirmationDialog open={confirmOff} onOpenChange={setConfirmOff} busy={pending === "disable"}
      title={t("systemDock.settings.turnOffTitle")} description={t(replace ? "systemDock.settings.turnOffBodyReplace" : "systemDock.settings.turnOffBodyCoexist")}
      confirmLabel={t("systemDock.settings.turnOffAction")} confirmTone="destructive"
      onConfirm={() => void store.disable().then(() => setConfirmOff(false))} />
  </SettingsSection>;
}

/** Only meaningful while Bottega Dock replaces the system Dock; the helper is how the system Dock always comes back. */
export function DockRecovery({ snapshot }: { snapshot: DockSettingsSnapshot }) {
  const { t } = useAppTranslation();
  const registration = snapshot.registration;
  if ((snapshot.actualMode ?? snapshot.state.preferredMode) !== "replace" || registration === "unsupported") return null;
  return <SettingsSection title={t("systemDock.settings.recoveryTitle")} description={t("systemDock.settings.recoveryDescription")}>
    <SettingsList>
      <SettingsRow label={t("systemDock.settings.registrationLabel")}
        badge={registration === "enabled" ? undefined : <SettingsBadge tone="warn">{t(registration === "requires-approval" ? "systemDock.settings.needsApproval"
          : registration === "not-found" ? "systemDock.settings.notFound" : "systemDock.settings.notRegistered")}</SettingsBadge>}
        description={t(registration === "enabled" ? "systemDock.settings.registrationEnabled" : registration === "requires-approval" ? "systemDock.settings.registrationApproval"
          : registration === "not-found" ? "systemDock.settings.registrationMissing" : "systemDock.settings.registrationNone")}
        control={registration === "requires-approval" ? <SettingsButton variant="outline" onClick={() => void dockSettingsStore.openRecoverySettings()}>
          {t("systemDock.settings.openLoginItems")}</SettingsButton> : null} />
    </SettingsList>
  </SettingsSection>;
}
