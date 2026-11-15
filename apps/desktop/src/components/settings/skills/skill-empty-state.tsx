/**
 * [INPUT]: Depends on main-owned candidate source counts, i18n, and acquisition callbacks
 * [OUTPUT]: Provides the Library-empty acquisition state as a settings section and dashed frame, with scan truth, import-all, and local-folder entry
 * [POS]: Empty personal Library body; system/project Skills do not influence this state
 */

import { FolderOpen, LoaderCircle, Sparkles } from "lucide-react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton, SettingsEmpty } from "@/components/settings/settings-layout";
import type { ManagedSkillSourceView } from "../../../../shared/ipc/agent/unified-skills-ipc";

export function SkillEmptyState({
  sources,
  scanning,
  busy,
  onImportAll,
  onChooseFolder,
}: {
  sources: readonly ManagedSkillSourceView[];
  scanning: boolean;
  busy: boolean;
  onImportAll(): void;
  onChooseFolder(): void;
}) {
  const { t } = useAppTranslation();
  const count = sources.reduce((sum, source) => sum + source.actionable, 0);
  const hint = scanning
    ? t("settings.skills.emptyScanning")
    : count
      ? t("settings.skills.emptyLead", { count })
      : t("settings.skills.emptyNothingHint");
  /* S14: this empty state is the page's only content — the SettingsEmpty owns the
     heading, so no section chrome wraps it. */
  return (
    <SettingsEmpty
      aria-busy={scanning || undefined}
      hint={hint}
      icon={
        scanning ? (
          <LoaderCircle className="animate-spin motion-reduce:animate-none" />
        ) : (
          <Sparkles />
        )
      }
      title={t("settings.skills.emptyTitle")}
    >
      {!scanning && (
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <SettingsButton onClick={onChooseFolder} variant="outline" disabled={busy}>
            <FolderOpen />
            {t("settings.skills.chooseFolder")}
          </SettingsButton>
          {count > 0 && (
            <SettingsButton disabled={busy} onClick={onImportAll}>
              {t("settings.skills.importPrimary")}
            </SettingsButton>
          )}
        </div>
      )}
    </SettingsEmpty>
  );
}
