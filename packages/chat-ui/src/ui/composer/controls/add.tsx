/**
 * [INPUT]: Shared menu primitives, locale and host-owned Files, Sketch and Plan actions.
 * [OUTPUT]: ComposerAddMenu presents the same keyboard-accessible menu on native and Web.
 * [POS]: Stateless composer action menu; hosts retain draft and capability authority.
 */
import { useRef } from "react";
import { FileUpIcon, LightbulbIcon, PencilIcon, PlusIcon } from "lucide-react";
import { PromptInputActionMenu, PromptInputActionMenuTrigger, PromptInputActionMenuContent, PromptInputActionMenuItem } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { useComposerTranslation } from "./copy/translation";
type Action = { disabled?: boolean; reason?: string; run(anchor: HTMLButtonElement | null): void };
export function ComposerAddMenu({ locale, disabled, files, sketch, plan, preload }: {
  locale: string; disabled?: boolean; files?: Action; sketch?: Action; plan?: Action & { active: boolean }; preload?(): void;
}) {
  const t = useComposerTranslation(locale), anchor = useRef<HTMLButtonElement>(null);
  return <PromptInputActionMenu onOpenChange={open => { if (open) preload?.(); }}>
    <PromptInputActionMenuTrigger ref={anchor} aria-label={t("chat.composer.add")} className="rounded-full" disabled={disabled}><PlusIcon className="size-4" /></PromptInputActionMenuTrigger>
    <PromptInputActionMenuContent side="top">
      {files && <PromptInputActionMenuItem disabled={files.disabled} title={files.reason} onSelect={() => files.run(anchor.current)}><FileUpIcon className="size-4" />{t("chat.composer.files")}</PromptInputActionMenuItem>}
      {sketch && <PromptInputActionMenuItem disabled={sketch.disabled} title={sketch.reason} onSelect={() => sketch.run(anchor.current)}><PencilIcon className="size-4" />{t("sketch.title")}</PromptInputActionMenuItem>}
      {plan && <PromptInputActionMenuItem disabled={plan.disabled} title={plan.reason} onSelect={() => plan.run(anchor.current)}><LightbulbIcon className="size-4" />{t(plan.active ? "chat.composer.disablePlan" : "chat.composer.surface.plan")}</PromptInputActionMenuItem>}
    </PromptInputActionMenuContent>
  </PromptInputActionMenu>;
}
