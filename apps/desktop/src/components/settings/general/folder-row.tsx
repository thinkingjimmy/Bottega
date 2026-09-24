/**
 * [INPUT]: Depends on the settings bridge (reveal, plan and commit a folder move), i18n, the shared confirmation dialog and Settings row/button primitives.
 * [OUTPUT]: Provides FolderRow: the Bottega folder's location with "Show in Finder" and "Move folder", and the confirmation that restarts Bottega to move it.
 * [POS]: General › Bottega folder row; the main process validates and performs the move, this component only asks and confirms.
 */
import { useState } from "react";
import { FolderInput, FolderOpen } from "lucide-react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { Skeleton } from "@ai-chat/ui/components/ui/skeleton";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { useAppTranslation, useSystemFileManagerRevealLabel } from "@/components/providers/i18n-provider";
import type { LibraryMovePlan } from "../../../../shared/settings-ipc";
import { SettingsButton, SettingsRow } from "../settings-layout";

export function FolderRow({ folder, loading, onError }: {
  folder: string | null;
  loading: boolean;
  /** Section-level alert: a failed reveal or a destination the main process refused. */
  onError(message: string): void;
}) {
  const { t } = useAppTranslation();
  const revealLabel = useSystemFileManagerRevealLabel();
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<LibraryMovePlan | null>(null);
  const [moving, setMoving] = useState(false);
  const [moveError, setMoveError] = useState("");

  const choose = async () => {
    onError("");
    setPlanning(true);
    try { setPlan(await window.settings?.planLibraryMove?.() ?? null); }
    catch (cause) { onError(errorMessage(cause)); }
    finally { setPlanning(false); }
  };
  const move = async () => {
    if (!plan) return;
    setMoveError("");
    setMoving(true);
    // Success never returns: Bottega quits and moves the folder on its way back up.
    try { await window.settings?.commitLibraryMove?.(plan.to); }
    catch (cause) { setMoveError(errorMessage(cause)); setMoving(false); }
  };

  return <>
    <SettingsRow
      label={t("settings.general.folder")}
      htmlFor="choose-chat-homes-root"
      description={loading ? <Skeleton className="h-3 w-72" /> :
        <span className="font-mono text-xs break-all">{folder ?? t("settings.general.notSelected")}</span>}
      control={<div className="flex flex-wrap gap-2">
        <SettingsButton id="choose-chat-homes-root" aria-label={revealLabel} variant="outline" disabled={!folder}
          onClick={() => { onError(""); void window.settings?.revealLibrary?.().catch((cause) => onError(errorMessage(cause))); }}>
          <FolderOpen className="size-3.5" />
          {revealLabel}
        </SettingsButton>
        <SettingsButton variant="outline" disabled={!folder || planning} onClick={() => void choose()}>
          <FolderInput className="size-3.5" />
          {t("settings.general.moveFolder")}
        </SettingsButton>
      </div>}
    />
    <ConfirmationDialog
      open={plan !== null}
      title={t("settings.general.moveFolderTitle")}
      description={plan && <div className="space-y-3">
        <p>{t("settings.general.moveFolderBody")}</p>
        <dl className="space-y-2 rounded-lg bg-muted/50 px-3 py-2.5 text-xs">
          <div><dt className="text-muted-foreground">{t("settings.general.moveFolderFrom")}</dt><dd className="font-mono text-foreground break-all">{plan.from}</dd></div>
          <div><dt className="text-muted-foreground">{t("settings.general.moveFolderTo")}</dt><dd className="font-mono text-foreground break-all">{plan.to}</dd></div>
        </dl>
        <p className="text-sm">{t("settings.general.moveFolderRestart")}</p>
        {moveError && <p role="alert" className="text-destructive text-sm">{moveError}</p>}
      </div>}
      confirmLabel={t("settings.general.moveFolderConfirm")}
      initialFocus="confirm"
      busy={moving}
      onOpenChange={(open) => { if (!open) { setPlan(null); setMoveError(""); } }}
      onConfirm={() => void move()}
    />
  </>;
}
