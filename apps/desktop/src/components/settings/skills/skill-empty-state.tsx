/**
 * [INPUT]: Depends on main-owned candidate source counts, i18n, and acquisition callbacks
 * [OUTPUT]: Provides the Library-empty acquisition state as a settings section and dashed frame, with scan truth, import-all, and local-folder entry
 * [POS]: Empty personal Library body; system/project Skills do not influence this state
 */

import { FolderOpen, LoaderCircle, Sparkles } from "lucide-react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsEmpty, SettingsSection } from "@/components/settings/settings-layout";
import { Button } from "@ai-chat/ui/components/ui/button";
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
  return (
    <SettingsSection
      description={t("settings.skills.description")}
      title={t("settings.skills.libraryTitle")}
    >
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
            <Button disabled={busy} onClick={onChooseFolder} variant="outline">
              <FolderOpen />
              {t("settings.skills.chooseFolder")}
            </Button>
            {count > 0 && (
              <Button disabled={busy} onClick={onImportAll}>
                {t("settings.skills.importPrimary")}
              </Button>
            )}
          </div>
        )}
      </SettingsEmpty>
    </SettingsSection>
  );
}
