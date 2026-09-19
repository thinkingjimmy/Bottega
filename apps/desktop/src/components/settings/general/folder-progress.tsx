/**
 * [INPUT]: Receives transient folder progress and the active translation catalog.
 * [OUTPUT]: Displays an accessible count while opening or saving the selected folder.
 * [POS]: Shared presentation for onboarding and General settings; it owns no IPC or persisted state.
 */
import type { ChatHomeStatus } from "../../../../shared/settings-ipc";
import { useAppTranslation } from "@/components/providers/i18n-provider";
export function FolderProgress({ progress }: { progress: ChatHomeStatus["progress"] }) {
  const { t } = useAppTranslation();
  if (!progress) return null;
  const counts = { completed: progress.completed, total: progress.total };
  const label = progress.phase === "opening" ? t("onboarding.folderProgress.opening", counts) : t("onboarding.folderProgress.saving", counts);
  return <div className="space-y-1.5 text-xs text-muted-foreground" role="status">
    <p>{label}</p>
    <progress className="h-1 w-full accent-primary" max={Math.max(1, progress.total)} value={progress.completed}
      aria-label={label} />
  </div>;
}
