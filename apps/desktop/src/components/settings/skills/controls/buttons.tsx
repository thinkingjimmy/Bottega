/**
 * [INPUT]: Depends on the shared Button, lucide icons, and Skills translations
 * [OUTPUT]: Provides SkillRefreshButton and SkillAddButton with consistent labels, size, and loading feedback
 * [POS]: Shared header actions for global and Project Skills settings
 */

import { Plus, RefreshCw } from "lucide-react";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { Button } from "@ai-chat/ui/components/ui/button";

export function SkillRefreshButton({ busy, onRefresh }: { busy: boolean; onRefresh(): void }) {
  const { t } = useAppTranslation();
  return (
    <Button
      aria-label={t("settings.skills.refresh")}
      className="relative touch-target-44 [--touch-target-inset:-6px]"
      disabled={busy}
      onClick={onRefresh}
      size="icon-lg"
      type="button"
      variant="ghost"
    >
      <RefreshCw aria-hidden="true" className={busy ? "animate-spin motion-reduce:animate-none" : ""} />
    </Button>
  );
}

export function SkillAddButton({ disabled, onAdd }: { disabled: boolean; onAdd(): void }) {
  const { t } = useAppTranslation();
  return (
    <Button disabled={disabled} onClick={onAdd} size="lg" type="button">
      <Plus aria-hidden="true" />
      {t("settings.skills.importTitle")}
    </Button>
  );
}
