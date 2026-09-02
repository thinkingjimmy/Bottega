/**
 * [INPUT]: Depends on lucide Plan/X icons, Shared Button, Chat composer i18n, and permission-selector trigger geometry
 * [OUTPUT]: Provides localized ChatPlanChip; hover/focus switches to the close icon without transition
 * [POS]: Temporary Plan intent control in chat/composer; the parent owns separators and alignment with the permission trigger
 */

import { LightbulbIcon, XIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useAppTranslation } from "@/components/providers/i18n-provider";

export function ChatPlanChip({ onClose }: { onClose: () => void }) {
  const { t } = useAppTranslation();
  return (
    <Button
      aria-label={t("chat.composer.plan.closeChip")}
      className="group/plan h-8 gap-1.5 rounded-full px-1.5 font-normal text-sm text-muted-foreground transition-none"
      onClick={onClose}
      size="sm"
      title={t("chat.composer.plan.closeChip")}
      type="button"
      variant="ghost"
    >
      <LightbulbIcon className="size-4 shrink-0 group-hover/plan:hidden group-focus-visible/plan:hidden" />
      <XIcon className="hidden size-4 shrink-0 group-hover/plan:block group-focus-visible/plan:block" />
      <span>{t("chat.composer.surface.plan")}</span>
    </Button>
  );
}
