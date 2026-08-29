/**
 * [INPUT]: Depends on main-owned candidate source counts, i18n, and acquisition callbacks
 * [OUTPUT]: Provides the Library-empty acquisition state with scan truth, import-all, and local-folder entry
 * [POS]: Empty personal Library body; system/project Skills do not influence this state
 */

import { FolderOpen, LoaderCircle, Sparkles } from "lucide-react";
import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Button } from "@ai-chat/ui/components/ui/button";
import type { ManagedSkillSourceView } from "../../../../shared/unified-skills-ipc";

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
  return (
    <div className="mx-auto max-w-xl py-12 text-center">
      <span className="inline-grid size-11 place-items-center rounded-full bg-muted">
        {scanning ? (
          <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
        ) : (
          <Sparkles className="size-5" />
        )}
      </span>
      <h2 className="mt-4 font-heading font-semibold text-lg">
        {t("settings.skills.emptyTitle")}
      </h2>
      <p className="mx-auto mt-2 max-w-[34em] text-pretty text-muted-foreground text-sm">
        {scanning
          ? t("settings.skills.emptyScanning")
          : count
            ? t("settings.skills.emptyLead", { count })
            : t("settings.skills.emptyNothingHint")}
      </p>
      {!scanning && (
        <div className="mt-6 flex justify-center gap-2">
          <Button disabled={busy} onClick={onChooseFolder} size="lg" variant="outline">
            <FolderOpen />
            {t("settings.skills.chooseFolder")}
          </Button>
          {count > 0 && (
            <Button disabled={busy} onClick={onImportAll} size="lg">
              {t("settings.skills.importPrimary")}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
