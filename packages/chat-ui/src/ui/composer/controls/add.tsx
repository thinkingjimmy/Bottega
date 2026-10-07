/**
 * [INPUT]: Shared menu primitives, locale, host-owned Files/Plan actions and enabled plugin contributions.
 * [OUTPUT]: ComposerAddMenu presents the same keyboard-accessible menu on native and Web, with viewport-bounded readable disabled reasons.
 * [POS]: Stateless composer action menu; hosts retain draft and capability authority.
 */
import { useRef } from "react";
import { FileUpIcon, LightbulbIcon, PencilIcon, PlusIcon, PuzzleIcon } from "lucide-react";
import { PromptInputActionMenu, PromptInputActionMenuTrigger, PromptInputActionMenuContent, PromptInputActionMenuItem } from "@ai-chat/ui/components/ai-elements/prompt-input";
import { useComposerTranslation } from "./copy/translation";
type Action = { disabled?: boolean; reason?: string; run(anchor: HTMLButtonElement | null): void };
export type ComposerPluginAction = Action & Readonly<{ id: string; name: string; icon?: string }>;
export function ComposerAddMenu({ locale, disabled, files, plugins = [], plan, preload }: {
  locale: string; disabled?: boolean; files?: Action; plugins?: readonly ComposerPluginAction[]; plan?: Action & { active: boolean }; preload?(): void;
}) {
  const t = useComposerTranslation(locale), anchor = useRef<HTMLButtonElement>(null);
  return <PromptInputActionMenu onOpenChange={open => { if (open) preload?.(); }}>
    <PromptInputActionMenuTrigger ref={anchor} aria-label={t("chat.composer.add")} className="rounded-full" disabled={disabled}><PlusIcon className="size-4" /></PromptInputActionMenuTrigger>
    <PromptInputActionMenuContent side="top" className="w-auto max-w-[calc(100vw-1rem)]">
      {files && <PromptInputActionMenuItem disabled={files.disabled} title={files.reason} onSelect={() => files.run(anchor.current)}><FileUpIcon className="size-4" />{t("chat.composer.files")}</PromptInputActionMenuItem>}
      {plugins.map(plugin => {
        const Icon = plugin.icon === "pencil" || plugin.icon === "sketch" ? PencilIcon : PuzzleIcon;
        return <PromptInputActionMenuItem key={plugin.id} data-composer-plugin={plugin.id} disabled={plugin.disabled} onSelect={() => plugin.run(anchor.current)}>
          <Icon aria-hidden className="size-4 shrink-0" />
          <span className="flex min-w-0 flex-col"><span>{plugin.name}</span>
            {plugin.disabled && plugin.reason && <span className="w-56 max-w-[calc(100vw-5rem)] whitespace-normal text-xs leading-snug">{plugin.reason}</span>}
          </span>
        </PromptInputActionMenuItem>;
      })}
      {plan && <PromptInputActionMenuItem disabled={plan.disabled} title={plan.reason} onSelect={() => plan.run(anchor.current)}><LightbulbIcon className="size-4" />{t(plan.active ? "chat.composer.disablePlan" : "chat.composer.surface.plan")}</PromptInputActionMenuItem>}
    </PromptInputActionMenuContent>
  </PromptInputActionMenu>;
}
