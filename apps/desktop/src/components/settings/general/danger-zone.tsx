/**
 * [INPUT]: Depends on the settings bridge erase request, i18n, the shared confirmation dialog and Settings section/list/row primitives.
 * [OUTPUT]: Provides DangerZone: the "Erase all data on this computer" row and its confirmation, with the option to move the Bottega folder to the Trash as well.
 * [POS]: Last section of General; the main process records the erase and restarts, and the next launch performs it before any store opens.
 */
import { useState } from "react";
import { ConfirmationDialog } from "@ai-chat/ui/components/ui/app-dialog";
import { errorMessage } from "@ai-chat/ui/lib/errors";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { SettingsButton, SettingsList, SettingsRow, SettingsSection } from "../settings-layout";

export function DangerZone({ folder }: { folder: string | null }) {
  const { t } = useAppTranslation();
  const [open, setOpen] = useState(false);
  const [trashFolder, setTrashFolder] = useState(true);
  const [erasing, setErasing] = useState(false);
  const [error, setError] = useState("");

  const erase = async () => {
    setError("");
    setErasing(true);
    // Success never returns: Bottega quits and erases this computer's data on its way back up.
    try { await window.settings?.eraseAllData?.({ trashFolder: trashFolder && folder !== null }); }
    catch (cause) { setError(errorMessage(cause)); setErasing(false); }
  };

  return <SettingsSection title={t("settings.general.dangerZone")}>
    <SettingsList className="ring-destructive/25">
      <SettingsRow
        label={t("settings.general.eraseAll")}
        description={t("settings.general.eraseAllDescription")}
        control={<SettingsButton variant="destructive" onClick={() => { setTrashFolder(true); setError(""); setOpen(true); }}>
          {t("settings.general.eraseAllButton")}
        </SettingsButton>}
      />
    </SettingsList>
    <ConfirmationDialog
      open={open}
      title={t("settings.general.eraseAllTitle")}
      description={<div className="space-y-3">
        <p>{t("settings.general.eraseAllBody")}</p>
        {folder && <label className="flex cursor-pointer items-start gap-3 rounded-lg bg-muted/50 px-3 py-2.5">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-foreground" checked={trashFolder} disabled={erasing}
            onChange={(event) => setTrashFolder(event.target.checked)} />
          <span className="min-w-0 text-sm">
            <span className="block text-foreground">{t("settings.general.eraseAllTrashFolder")}</span>
            <span className="mt-0.5 block font-mono text-muted-foreground text-xs break-all">{folder}</span>
          </span>
        </label>}
        <p className="text-sm">{t("settings.general.eraseAllCloud")}</p>
        {error && <p role="alert" className="text-destructive text-sm">{error}</p>}
      </div>}
      confirmLabel={t("settings.general.eraseAllConfirm")}
      confirmTone="destructive"
      busy={erasing}
      onOpenChange={(next) => { if (!erasing) setOpen(next); }}
      onConfirm={() => void erase()}
    />
  </SettingsSection>;
}
