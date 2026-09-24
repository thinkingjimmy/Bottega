/**
 * [INPUT]: Depends on React, the desktop i18n provider, the shared Dialog root and StepDialogContent shell, Settings primitives, the Dock settings store/session calls, the shared candidate checklist, and Dock layout/preview projections.
 * [OUTPUT]: Provides `DockSetupDialog`: choose mode → layout preview (replace: system Dock Apps preselected, uncheck or skip; coexist: nothing until "Copy from System Dock"; an existing layout is kept) → impact and acknowledgement (replace) → confirm; `flow: "consent"` opens straight on the impact step to switch to replacement later. Cancelling, closing or leaving releases the preview session.
 * [POS]: settings/dock onboarding flow (3.1, DCK-08, DCK-46, INV-01), opened by the master switch; nothing is written before confirm, and the page reports the resulting phase honestly instead of declaring success here.
 */

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Check, LoaderCircle } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { StepDialogContent } from "@ai-chat/ui/components/ui/app-dialog";
import { Dialog } from "@ai-chat/ui/components/ui/dialog";
import { SettingsAlert, SettingsButton, SettingsChoiceRow } from "../settings-layout";
import { dockSettingsStore } from "@/lib/system-dock-settings-client";
import type { DockCapability, DockSetupPreview } from "../../../../shared/system-dock/ipc";
import type { DockMode } from "../../../../shared/system-dock/local-state";
import { CandidateChecklist, readFailureKey } from "./candidates";

export type DockSetupFlow = "full" | "consent";
type Step =
  | { kind: "mode"; mode: DockMode }
  | { kind: "loading"; mode: DockMode }
  | { kind: "layout" | "impact"; mode: DockMode; preview: DockSetupPreview; selected: Set<string> };

export const ENTRY_KEYS = { "system.finder": "systemDock.entry.finder", "system.downloads": "systemDock.entry.downloads", "system.trash": "systemDock.entry.trash",
  "builtin.ai-limits": "systemDock.entry.limits", "builtin.ai-activity": "systemDock.entry.activity" } as const;

/* Exactly what replacement changes and how to undo it (3.1); every line is a promise main keeps. */
const IMPACT_KEYS = ["systemDock.settings.impactAutohide", "systemDock.settings.impactRecoveryItem", "systemDock.settings.impactNoApp",
  "systemDock.settings.impactRestore", "systemDock.settings.impactShortcuts", "systemDock.settings.impactLogin"] as const;
const TITLE_KEYS = { mode: "systemDock.settings.modeTitle", loading: "systemDock.settings.layoutTitle", layout: "systemDock.settings.layoutTitle",
  impact: "systemDock.settings.impactTitle" } as const;

/** The first-run layout as it will be: fixed entries from main's preview, the chosen Apps after Finder. */
function PreviewStrip({ preview, selected }: { preview: DockSetupPreview; selected: ReadonlySet<string> }) {
  const { t } = useAppTranslation();
  const apps = preview.candidates.filter((candidate) => selected.has(candidate.key)).map((candidate) => candidate.label);
  const fixed = preview.preview.items.flatMap((item) => item.kind === "system" ? [t(ENTRY_KEYS[item.entry])]
    : item.kind === "widget" ? [t(ENTRY_KEYS[item.widget.type])] : []);
  const labels = fixed[0] === t("systemDock.entry.finder") ? [fixed[0], ...apps, ...fixed.slice(1)] : [...apps, ...fixed];
  return <ol aria-label={t("systemDock.settings.previewLabel")} className="flex flex-wrap gap-1.5">
    {labels.map((label, index) => <li key={`${label}-${index}`} className="rounded-md bg-muted px-2 py-1 text-xs">{label}</li>)}
  </ol>;
}

export function DockSetupDialog({ capability, flow, onExit }: { capability: DockCapability; flow: DockSetupFlow | null; onExit(): void }) {
  return <Dialog open={flow !== null} onOpenChange={(open) => { if (!open) onExit(); }}>
    {flow && <SetupFlow capability={capability} consentOnly={flow === "consent"} onExit={onExit} />}
  </Dialog>;
}

function SetupFlow({ capability, consentOnly, onExit }: { capability: DockCapability; consentOnly: boolean; onExit(): void }) {
  const { t } = useAppTranslation();
  const [step, setStep] = useState<Step>(consentOnly ? { kind: "loading", mode: "replace" } : { kind: "mode", mode: capability.replacement ? "replace" : "coexist" });
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const session = useRef<string | null>(null);
  const release = () => { if (session.current) void dockSettingsStore.cancelSetup(session.current); session.current = null; };
  // Closing the dialog or leaving the page mid-flow must not leave a preview session (or its read candidates) behind.
  useEffect(() => release, []);
  const open = (mode: DockMode, loader: () => Promise<DockSetupPreview>, next: "layout" | "impact" = "layout") => {
    setError(null); setStep({ kind: "loading", mode });
    return load(mode, loader, next);
  };
  const load = async (mode: DockMode, loader: () => Promise<DockSetupPreview>, next: "layout" | "impact") => {
    try {
      const preview = await loader();
      release();
      session.current = preview.sessionId;
      const selected = new Set(preview.candidates.filter((candidate) => candidate.preselected && candidate.status === "ok").map((candidate) => candidate.key));
      setStep({ kind: next, mode, preview, selected });
    } catch {
      setError(t("systemDock.settings.previewFailed"));
      if (!consentOnly) setStep({ kind: "mode", mode });
    }
  };
  // The consent-only path starts already loading; state changes only after main answers.
  const startConsent = useEffectEvent(() => { void load("replace", () => dockSettingsStore.beginSetup("replace"), "impact"); });
  useEffect(() => { if (consentOnly) startConsent(); }, [consentOnly]);
  const cancel = () => { release(); onExit(); };
  const finish = async (mode: DockMode, preview: DockSetupPreview, selected: ReadonlySet<string>) => {
    setBusy(true); setError(null);
    const result = await dockSettingsStore.confirmSetup({ sessionId: preview.sessionId, mode, selected: [...selected], acknowledged: mode === "replace" && acknowledged });
    setBusy(false);
    if (!result) {
      // The layout changed after this preview (another Mac, or an edit): show the fresh preview instead of applying the old one.
      if (dockSettingsStore.getSnapshot().failedCode === "DOCK_LAYOUT_REVISION_CHANGED") {
        await load(mode, () => dockSettingsStore.beginSetup(mode), "layout");
        setError(t("systemDock.settings.previewChanged"));
        return;
      }
      setError(t("systemDock.settings.confirmFailed")); return;
    }
    // The session was consumed; what happened next is reported by the page's status, not a success message here.
    session.current = null;
    onExit();
  };

  const total = step.mode === "replace" ? (consentOnly ? 1 : 3) : 2;
  const index = consentOnly ? 1 : step.kind === "mode" ? 1 : step.kind === "impact" ? 3 : 2;
  const cancelButton = <SettingsButton variant="ghost" disabled={busy} onClick={cancel}>{t("common.cancel")}</SettingsButton>;
  const confirmLabel = busy ? t("systemDock.settings.turningOn") : t(consentOnly ? "systemDock.settings.switchConfirm" : "systemDock.settings.turnOnConfirm");
  return <StepDialogContent aria-live="off" title={t(consentOnly ? TITLE_KEYS.impact : TITLE_KEYS[step.kind])}
    progress={{ index, total, label: t("systemDock.settings.step", { index, total }) }}
    back={step.kind === "impact" && !consentOnly ? <SettingsButton variant="ghost" disabled={busy}
      onClick={() => setStep({ ...step, kind: "layout" })}>{t("common.back")}</SettingsButton> : undefined}
    actions={<>
      {cancelButton}
      {step.kind === "mode" && <SettingsButton onClick={() => void open(step.mode, () => dockSettingsStore.beginSetup(step.mode))}>{t("systemDock.settings.continue")}</SettingsButton>}
      {step.kind === "layout" && <>
        {step.mode === "replace" && !step.preview.layoutExists && step.preview.candidates.length > 0 &&
          <SettingsButton variant="outline" onClick={() => setStep({ ...step, kind: "impact", selected: new Set() })}>{t("systemDock.settings.skipImport")}</SettingsButton>}
        {step.mode === "replace" ? <SettingsButton onClick={() => setStep({ ...step, kind: "impact" })}>{t("systemDock.settings.continue")}</SettingsButton>
          : <SettingsButton disabled={busy} onClick={() => void finish("coexist", step.preview, step.selected)}>{confirmLabel}</SettingsButton>}
      </>}
      {step.kind === "impact" && <SettingsButton disabled={!acknowledged || busy} onClick={() => void finish("replace", step.preview, step.selected)}>{confirmLabel}</SettingsButton>}
    </>}>
      {error && <SettingsAlert>{error}</SettingsAlert>}
      {step.kind === "mode" && <div role="radiogroup" aria-label={t("systemDock.settings.modeTitle")} className="divide-inset rounded-lg ring-1 ring-foreground/10">
        <SettingsChoiceRow label={t("systemDock.settings.modeReplace")} checked={step.mode === "replace"} disabled={!capability.replacement}
          labelMeta={capability.replacement ? <span className="text-muted-foreground text-xs">{t("systemDock.settings.recommended")}</span> : undefined}
          description={capability.replacement ? t("systemDock.settings.modeReplaceDescription") : t(capability.reason === "helper-missing" ? "systemDock.settings.replacementHelperMissing" : "systemDock.settings.replacementDevelopment")}
          onSelect={() => setStep({ kind: "mode", mode: "replace" })} />
        <SettingsChoiceRow label={t("systemDock.settings.modeCoexist")} checked={step.mode === "coexist"} description={t("systemDock.settings.modeCoexistDescription")}
          onSelect={() => setStep({ kind: "mode", mode: "coexist" })} />
      </div>}
      {step.kind === "loading" && !error && <p className="flex min-h-24 items-center justify-center gap-2 text-muted-foreground text-sm" role="status">
        <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />{t("systemDock.settings.reading")}
      </p>}
      {step.kind === "layout" && (step.preview.layoutExists ? <p className="text-muted-foreground text-xs leading-relaxed">{t("systemDock.settings.layoutKept")}</p> : <>
        <PreviewStrip preview={step.preview} selected={step.selected} />
        {step.preview.readFailure && <SettingsAlert tone="warn">{t(readFailureKey(step.preview.readFailure))} {t("systemDock.settings.addLater")}</SettingsAlert>}
        {step.preview.candidates.length > 0 ? <CandidateChecklist candidates={step.preview.candidates} selected={step.selected}
          label={t(step.mode === "replace" ? "systemDock.settings.importReplaceLabel" : "systemDock.settings.importCopyLabel")}
          onChange={(selected) => setStep({ ...step, selected })} />
          : step.mode === "coexist" ? <div className="space-y-2">
            <p className="text-muted-foreground text-xs leading-relaxed">{t("systemDock.settings.coexistImportHint")}</p>
            <SettingsButton variant="outline" onClick={() => void open("coexist", () => dockSettingsStore.importCandidates())}>{t("systemDock.settings.copyFromSystem")}</SettingsButton>
          </div> : !step.preview.readFailure && <p className="text-muted-foreground text-xs">{t("systemDock.settings.noCandidates")} {t("systemDock.settings.addLater")}</p>}
      </>)}
      {step.kind === "impact" && <>
        <ul className="space-y-2 text-xs leading-relaxed">
          {IMPACT_KEYS.map((key) =>
            <li key={key} className="flex gap-2"><Check className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span>{t(key)}</span></li>)}
        </ul>
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg bg-muted/60 px-3 text-sm">
          <input type="checkbox" className="size-4 accent-foreground" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          {t("systemDock.settings.acknowledge")}
        </label>
      </>}
  </StepDialogContent>;
}
