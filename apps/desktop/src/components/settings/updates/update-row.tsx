/**
 * [INPUT]: Depends on React, UI class utilities, Spinner and Collapsible, shared Settings controls, lucide glyphs and Updates i18n.
 * [OUTPUT]: Provides UpdateList, UpdateRow with inline version layout when no icon is supplied, UpdateButton, status marks and collapsed failure details.
 * [POS]: Settings › Updates shares one action grid; Provider plugin health uses a compact row inside its own settings list.
 */

import type { ReactNode } from "react";
import { ArrowRight, Check, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@ai-chat/ui/components/ui/collapsible";
import { Spinner } from "@ai-chat/ui/components/ui/spinner";
import { cn } from "@ai-chat/ui/lib/utils";
import { useAppTranslation } from "@/components/providers/preferences/i18n-provider";
import { SettingsButton, SettingsList } from "@/components/settings/settings-layout";

export function UpdateList({ children }: { children: ReactNode }) {
  return <SettingsList className="grid grid-cols-[minmax(0,1fr)_fit-content(45%)]">{children}</SettingsList>;
}

export function UpdateRow({ icon, name, current, currentLabel, latest, trailing, failure }: {
  icon?: ReactNode;
  name: string;
  current?: string;
  currentLabel?: string;
  /** Only a newer version is shown; the arrow is the whole message. */
  latest?: string;
  trailing?: ReactNode;
  failure?: { summary: string; detail: ReactNode; tone?: "quiet" | "danger" };
}) {
  const { t } = useAppTranslation();
  const compact = icon == null;
  return <Collapsible key={failure ? "failed" : "settled"} role="group" aria-label={name}
    className={cn("grid items-center gap-x-4 gap-y-3 px-4", compact
      ? "min-h-11 grid-cols-[minmax(0,1fr)_fit-content(45%)] py-1.5"
      : "col-span-2 min-h-18 grid-cols-subgrid py-4")}>
    <div className="flex min-w-0 items-center gap-3">
      {!compact && <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">{icon}</span>}
      <div className={cn("min-w-0", compact && "flex flex-wrap items-baseline gap-x-2")}>
        <p data-update-name className={compact ? "text-xs text-muted-foreground" : "break-words font-medium text-sm leading-5"}>{name}</p>
        {current && <p data-update-version className={cn("flex flex-wrap items-center gap-x-1.5 gap-y-0.5 tabular-nums", compact
          ? "min-w-0 wrap-anywhere text-sm" : "mt-0.5 break-all text-xs leading-[18px] text-muted-foreground")}>
          <span>{currentLabel ?? current}</span>
          {latest && <><ArrowRight aria-hidden="true" className="size-3 shrink-0" /><span className="text-foreground">{latest}</span></>}
        </p>}
        {failure && <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs", compact && "basis-full")}>
          <span role={failure.tone === "quiet" ? "status" : "alert"} className={failure.tone === "quiet" ? "text-muted-foreground" : "text-destructive"}>{failure.summary}</span>
          <CollapsibleTrigger className="group flex min-h-5 cursor-pointer items-center gap-0.5 rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40">
            <span className="group-data-[state=open]:hidden">{t("settings.updates.showDetails")}</span>
            <span className="hidden group-data-[state=open]:inline">{t("settings.updates.hideDetails")}</span>
            <ChevronDown aria-hidden="true" className="size-3 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none" />
          </CollapsibleTrigger>
        </div>}
      </div>
    </div>
    <div data-update-action className={cn("flex items-center justify-end text-right", compact ? "min-w-0 [&>button]:min-w-0" : "min-w-28")}>{trailing}</div>
    {failure && <CollapsibleContent className={cn("col-span-2 min-w-0 border-t pt-3 text-xs leading-5 text-muted-foreground", !compact && "ml-9")}>
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
