/**
 * [INPUT]: Depends on caller-derived allowed-action availability, selection counts, and Library-first batch callbacks
 * [OUTPUT]: Provides a compact floating selection bar whose enable/disable/delete commands expose only applicable intents
 * [POS]: Batch intent surface; main-owned allowedActions gate controls before submission
 */

import { useAppTranslation } from "@/components/providers/i18n-provider";
import { Button } from "@ai-chat/ui/components/ui/button";

export function SkillBatchBar({
  selected,
  busy,
  canEnable,
  canDisable,
  canDelete,
  onEnable,
  onDisable,
  onDelete,
  onDone,
}: {
  selected: number;
  busy: boolean;
  canEnable: boolean;
  canDisable: boolean;
  canDelete: boolean;
  onEnable(): void;
  onDisable(): void;
  onDelete(): void;
  onDone(): void;
}) {
  const { t } = useAppTranslation();
  return (
    <div className="sticky bottom-3 z-20 mt-4 flex items-center gap-2 rounded-lg bg-background/95 p-2 pl-3 shadow-lg ring-1 ring-foreground/10 backdrop-blur">
      <span className="mr-auto text-xs">
        {t("settings.skills.batch.selected", { count: selected })}
      </span>
      <Button disabled={busy || !canEnable} onClick={onEnable} size="lg" variant="outline">
        {t("settings.skills.enable")}
      </Button>
      <Button disabled={busy || !canDisable} onClick={onDisable} size="lg" variant="outline">
        {t("settings.skills.disable")}
      </Button>
      {canDelete && (
        <Button disabled={busy} onClick={onDelete} size="lg" variant="destructive">
          {t("settings.skills.delete")}
        </Button>
      )}
      <Button disabled={busy} onClick={onDone} size="lg" variant="ghost">
        {t("settings.skills.batch.done")}
      </Button>
    </div>
  );
}
