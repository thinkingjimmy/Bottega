/**
 * [INPUT]: Depends on lucide Plan/X icons, Shared Button, Chat composer i18n, and permission-selector trigger geometry
 * [OUTPUT]: Provides localized ChatPlanChip; hover/focus switches to the close icon without transition; an unavailable Plan shows the attention mark
 * [POS]: Temporary Plan intent control in chat/composer; the parent owns separators and alignment with the permission trigger
 */

import { LightbulbIcon, TriangleAlert, XIcon } from "lucide-react";
import { Button } from "@ai-chat/ui/components/ui/button";
import { useComposerTranslation } from "./copy/translation";

export function ChatPlanChip({ onClose, locale, unavailableTitle }: { onClose: () => void; locale: string;
  /** Plan is on but this Agent cannot run it: the chip flags itself; closing it is the way out. */
  unavailableTitle?: string }) {
  const t = useComposerTranslation(locale);
  const Icon = unavailableTitle ? TriangleAlert : LightbulbIcon;
  return (
    <Button
      aria-label={t("chat.composer.plan.closeChip")}
      className={`group/plan h-8 gap-1.5 rounded-full px-1.5 font-normal text-sm transition-none ${unavailableTitle ? "text-foreground" : "text-muted-foreground"}`}
      data-plan-unavailable={unavailableTitle ? true : undefined}
      onClick={onClose}
      size="sm"
      title={unavailableTitle ?? t("chat.composer.plan.closeChip")}
      type="button"
      variant="ghost"
    >
      <Icon className={`size-4 shrink-0 group-hover/plan:hidden group-focus-visible/plan:hidden ${unavailableTitle ? "text-destructive" : ""}`} />
      <XIcon className="hidden size-4 shrink-0 group-hover/plan:block group-focus-visible/plan:block" />
      <span>{t("chat.composer.surface.plan")}</span>
    </Button>
  );
}
