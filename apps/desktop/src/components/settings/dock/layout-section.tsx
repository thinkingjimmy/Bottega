/**
 * [INPUT]: Depends on React, the desktop i18n provider, Settings primitives, the shared confirmation dialog, the Dock settings store/session calls, and the candidate checklist.
 * [OUTPUT]: Provides `DockLayoutSection`: item count and how to edit in the Dock itself, "Copy from system Dock…" (read candidates, confirm a subset, append in system order), and "Reset to default layout…" with an explicit replace-your-layout confirmation.
 * [POS]: settings/dock layout maintenance (3.3, DCK-10, DCK-46); nothing is imported or reset without a confirmation, and an import session is released when its dialog closes.
 */

import { useState } from "react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { SettingsAlert, SettingsButton, SettingsList, SettingsRow, SettingsSection } from "../settings-layout";
import { dockSettingsStore, type DockSettingsState } from "@/lib/system-dock-settings-client";
import type { DockSetupPreview } from "../../../../shared/system-dock/ipc";
import { CandidateChecklist, readFailureKey } from "./candidates";

export function DockLayoutSection({ state }: { state: DockSettingsState }) {
  const { t } = useAppTranslation();
  const snapshot = state.snapshot!;
  const [importing, setImporting] = useState<{ preview: DockSetupPreview; selected: Set<string> } | "loading" | null>(null);
  const [importFailed, setImportFailed] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const busy = state.pending !== null;
  const startImport = async () => {
    setImportFailed(false); setImporting("loading");
    try {
      const preview = await dockSettingsStore.importCandidates();
      setImporting({ preview, selected: new Set(preview.candidates.filter((candidate) => candidate.preselected && candidate.status === "ok").map((candidate) => candidate.key)) });
    } catch { setImporting(null); setImportFailed(true); }
  };
  const closeImport = () => {
    if (importing && importing !== "loading") void dockSettingsStore.cancelSetup(importing.preview.sessionId);
    setImporting(null);
  };
  const open = importing !== null && importing !== "loading" ? importing : null;
  return <SettingsSection title={t("systemDock.settings.layoutSectionTitle")} description={t("systemDock.settings.layoutEditHint")}>
    {importFailed && <SettingsAlert>{t("systemDock.settings.previewFailed")}</SettingsAlert>}
    <SettingsList>
      <SettingsRow label={t("systemDock.settings.copyFromSystem")} description={t("systemDock.settings.copyDescription")}
        control={<SettingsButton variant="outline" disabled={busy || importing === "loading"} onClick={() => void startImport()}>
          {importing === "loading" ? t("systemDock.settings.reading") : t("systemDock.settings.copyAction")}</SettingsButton>} />
      {snapshot.layoutInitialized && <SettingsRow label={t("systemDock.settings.reset")} description={t("systemDock.settings.itemCount", { count: snapshot.itemCount })}
        control={<SettingsButton variant="outline" disabled={busy} onClick={() => setConfirmReset(true)}>{t("systemDock.settings.resetAction")}</SettingsButton>} />}
    </SettingsList>
    <ConfirmationDialog open={open !== null} onOpenChange={(next) => { if (!next) closeImport(); }} busy={state.pending === "import"}
      title={t("systemDock.settings.copyTitle")} confirmLabel={t("systemDock.settings.copyConfirm", { count: open?.selected.size ?? 0 })}
      confirmDisabled={!open || open.selected.size === 0} initialFocus="cancel"
      description={open && <div className="space-y-3">
        {open.preview.readFailure && <SettingsAlert tone="warn">{t(readFailureKey(open.preview.readFailure))}</SettingsAlert>}
        {open.preview.candidates.length ? <CandidateChecklist candidates={open.preview.candidates} selected={open.selected} label={t("systemDock.settings.importCopyLabel")}
          onChange={(selected) => setImporting({ ...open, selected })} /> : <p className="text-sm">{t("systemDock.settings.noCandidates")}</p>}
      </div>}
      onConfirm={() => {
        if (!open) return;
        void dockSettingsStore.confirmImport(open.preview.sessionId, [...open.selected]).then((result) => {
          // Confirmed sessions are consumed; only a failed one still needs releasing.
          if (result) setImporting(null); else closeImport();
        });
      }} />
    <ConfirmationDialog open={confirmReset} onOpenChange={setConfirmReset} busy={state.pending === "reset"} initialFocus="cancel"
      title={t("systemDock.settings.resetTitle")} description={t("systemDock.settings.resetBody")}
      confirmLabel={t("systemDock.settings.resetConfirm")} confirmTone="destructive"
      onConfirm={() => void dockSettingsStore.resetLayout().then(() => setConfirmReset(false))} />
  </SettingsSection>;
}
