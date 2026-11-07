/**
 * [INPUT]: Depends on React, ui Spinner/Collapsible, shared Settings controls, lucide glyphs and Updates i18n
 * [OUTPUT]: Provides UpdateList, UpdateRow, uniform text UpdateButton, visible status helpers with decorative nested glyphs and collapsed failure details
 * [POS]: Shared presentation of Settings › Updates; app and CLI rows supply state and commands while one grid aligns all actions
 */

import type { ReactNode } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ai-chat/ui/components/ui/collapsible";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton, SettingsList } from "@/components/settings/settings-layout";

export function UpdateList({ children }: { children: ReactNode }) {
  return <SettingsList className="grid grid-cols-[minmax(0,1fr)_fit-content(45%)]">{children}</SettingsList>;
}

export function UpdateRow({ icon, name, current, latest, trailing, failure }: {
  icon: ReactNode;
  name: string;
  current?: string;
  /** Only a newer version is shown; the arrow is the whole message. */
  latest?: string;
  trailing?: ReactNode;
  failure?: { summary: string; detail: ReactNode };
}) {
  const { t } = useAppTranslation();
  return <Collapsible key={failure ? "failed" : "settled"} role="group" aria-label={name}
    className="col-span-2 grid min-h-18 grid-cols-subgrid items-center gap-x-4 gap-y-3 px-4 py-4">
    <div className="flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">{icon}</span>
      <div className="min-w-0">
        <p data-update-name className="break-words font-medium text-sm leading-5">{name}</p>
        {current && <p data-update-version className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 break-all text-xs leading-[18px] text-muted-foreground tabular-nums">
          <span>{current}</span>
          {latest && <><ArrowRight aria-hidden="true" className="size-3 shrink-0" /><span className="text-foreground">{latest}</span></>}
        </p>}
        {failure && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span role="alert" className="text-destructive">{failure.summary}</span>
          <CollapsibleTrigger className="group flex min-h-5 cursor-pointer items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
            <span className="group-data-[state=open]:hidden">{t("settings.updates.showDetails")}</span>
            <span className="hidden group-data-[state=open]:inline">{t("settings.updates.hideDetails")}</span>
            <ChevronDown aria-hidden="true" className="size-3 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </CollapsibleTrigger>
        </div>}
      </div>
    </div>
    <div data-update-action className="flex min-w-28 items-center justify-end text-right">{trailing}</div>
    {failure && <CollapsibleContent className="col-span-2 ml-9 min-w-0 border-t pt-3 text-xs leading-5 text-muted-foreground">
      {failure.detail}
    </CollapsibleContent>}
  </Collapsible>;
}

export function UpToDateMark({ label }: { label: string }) {
  const { t } = useAppTranslation();
  return <span role="status" aria-label={label} className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
    <Check aria-hidden="true" className="size-3.5 shrink-0" />{t("settings.updates.current", { checkedAt: "" })}
  </span>;
}

export const UpdatingMark = ({ label, children, icon }: { label: string; children: ReactNode; icon?: ReactNode }) =>
  <span role="status" aria-label={label} className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground tabular-nums">{icon ?? <Spinner aria-hidden="true" className="size-3.5 shrink-0" />}{children}</span>;

export const UpdateButton = ({ label, children, onClick, disabled }: { label?: string; children: ReactNode; onClick(): void; disabled?: boolean }) =>
  <SettingsButton aria-label={label} variant="outline" className="h-auto min-h-8 w-full min-w-28 whitespace-normal py-1" disabled={disabled} onClick={onClick}>{children}</SettingsButton>;
